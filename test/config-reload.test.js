'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const fse = require('fs-extra');
const { createTestWorkspace } = require('./helpers/create-test-workspace');
const { runCli } = require('./helpers/run-cli');
const { waitFor, waitForOutput, sleep } = require('./helpers/wait-for-output');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest, openSse } = require('./helpers/http-request');

describe('config hot reload', { timeout: 120000 }, () => {
  const workspaces = [];
  const children = [];

  after(async () => {
    for (const child of children) {
      // eslint-disable-next-line no-await-in-loop
      await child.forceKill().catch(() => {});
    }
    for (const ws of workspaces) {
      // eslint-disable-next-line no-await-in-loop
      await ws.cleanup();
    }
  });

  it('watch: config 変更で監視対象を更新しフルビルドする', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: { watch: { debounce: 80 } },
      },
    });
    workspaces.push(ws);

    const altRoot = path.join(ws.workspaceRoot, 'src/sample-alt');
    await fse.copy(path.join(ws.workspaceRoot, 'src/sample'), altRoot);

    const cli = runCli({
      scriptPath: ws.scripts.watch,
      cwd: ws.workspaceRoot,
      args: ['sample'],
      ipc: true,
      timeoutMs: 60000,
    });
    children.push(cli);

    await waitForOutput(() => cli.output, 'プロジェクトを監視しています', {
      timeoutMs: 20000,
    });

    await writeProjectConfig(ws.workspaceRoot, {
      sourceDir: 'src/sample-alt',
      outputDir: 'dist/sample',
      debounce: 80,
    });

    await waitForOutput(() => cli.output, '設定を再読み込みしました', {
      timeoutMs: 15000,
    });
    await waitForOutput(() => cli.output, '監視対象を更新しました', {
      timeoutMs: 15000,
    });
    await waitFor(
      () => (cli.output.match(/ビルドが完了しました/g) || []).length >= 2,
      { timeoutMs: 15000, label: 'config reload build' }
    );

    const oldIndex = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');
    const newIndex = path.join(
      ws.workspaceRoot,
      'src/sample-alt/pages/index.njk'
    );
    const distIndex = path.join(ws.workspaceRoot, 'dist/sample/index.html');

    const beforeOld = (cli.output.match(/再ビルドが完了しました/g) || [])
      .length;
    await fsp.writeFile(
      oldIndex,
      '{% extends "layouts/base.njk" %}{% block content %}OLD_PATH{% endblock %}\n',
      'utf8'
    );
    await sleep(600);
    assert.equal(
      (cli.output.match(/再ビルドが完了しました/g) || []).length,
      beforeOld,
      '旧 path の変更はビルドしない'
    );

    const beforeNew = (cli.output.match(/再ビルドが完了しました/g) || [])
      .length;
    let source = await fsp.readFile(newIndex, 'utf8');
    await fsp.writeFile(
      newIndex,
      source.replace('INDEX_OK', 'ALT_WATCHED'),
      'utf8'
    );
    await waitFor(
      () =>
        (cli.output.match(/再ビルドが完了しました/g) || []).length > beforeNew,
      { timeoutMs: 15000, label: 'new path rebuild' }
    );
    assert.match(fs.readFileSync(distIndex, 'utf8'), /ALT_WATCHED/);

    await cli.stop();
    assert.match(cli.output, /ウォッチを停止しました/);
  });

  it('watch: 不正 config では以前の設定を維持し、復旧できる', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: { watch: { debounce: 80 } },
      },
    });
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.watch,
      cwd: ws.workspaceRoot,
      args: ['sample'],
      ipc: true,
      timeoutMs: 60000,
    });
    children.push(cli);
    await waitForOutput(() => cli.output, 'プロジェクトを監視しています', {
      timeoutMs: 20000,
    });

    const configPath = path.join(ws.workspaceRoot, 'jskim.config.js');
    await fsp.writeFile(configPath, 'module.exports = {\n', 'utf8');
    await waitForOutput(
      () => cli.output,
      '設定ファイルの再読み込みに失敗しました',
      { timeoutMs: 15000 }
    );
    assert.match(cli.output, /以前の正常な設定を継続します/);
    assert.equal(cli.child.exitCode, null);

    const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');
    const distIndex = path.join(ws.workspaceRoot, 'dist/sample/index.html');
    const before = (cli.output.match(/再ビルドが完了しました/g) || []).length;
    let source = await fsp.readFile(indexPath, 'utf8');
    await fsp.writeFile(
      indexPath,
      source.replace('INDEX_OK', 'STILL_WATCHING'),
      'utf8'
    );
    await waitFor(
      () => (cli.output.match(/再ビルドが完了しました/g) || []).length > before,
      { timeoutMs: 15000, label: 'keep old watcher' }
    );
    assert.match(fs.readFileSync(distIndex, 'utf8'), /STILL_WATCHING/);

    await writeProjectConfig(ws.workspaceRoot, {
      sourceDir: 'src/sample',
      outputDir: 'dist/sample',
      debounce: 80,
    });
    await waitForOutput(() => cli.output, '設定を再読み込みしました', {
      timeoutMs: 15000,
    });

    await cli.stop();
  });

  it('watch: config unlink/add でも process を維持する', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: { watch: { debounce: 80 } },
      },
    });
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.watch,
      cwd: ws.workspaceRoot,
      args: ['sample'],
      ipc: true,
      timeoutMs: 60000,
    });
    children.push(cli);
    await waitForOutput(() => cli.output, 'プロジェクトを監視しています', {
      timeoutMs: 20000,
    });

    const configPath = path.join(ws.workspaceRoot, 'jskim.config.js');
    const backup = await fsp.readFile(configPath, 'utf8');
    await fsp.unlink(configPath);
    await waitForOutput(
      () => cli.output,
      '設定ファイルが一時的に削除されました',
      { timeoutMs: 15000 }
    );
    assert.equal(cli.child.exitCode, null);

    await fsp.writeFile(configPath, backup, 'utf8');
    await waitForOutput(() => cli.output, '設定を再読み込みしました', {
      timeoutMs: 15000,
    });

    await cli.stop();
  });

  it('dev: 対応設定の変更で build と reload が1回起きる', async () => {
    const port = await getFreePort();
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          serve: { host: '127.0.0.1', port },
          watch: { debounce: 80 },
        },
      },
    });
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.dev,
      cwd: ws.workspaceRoot,
      args: ['sample'],
      ipc: true,
      timeoutMs: 60000,
    });
    children.push(cli);
    await waitForOutput(
      () => cli.output,
      '終了するには Ctrl+C を押してください。',
      { timeoutMs: 25000 }
    );

    const sse = await openSse({ port });
    await sleep(150);
    const eventsBefore = sse.events.length;

    await writeProjectConfig(ws.workspaceRoot, {
      sourceDir: 'src/sample',
      outputDir: 'dist/sample',
      debounce: 120,
      port,
    });

    await waitForOutput(() => cli.output, '設定を再読み込みしました', {
      timeoutMs: 15000,
    });
    await waitFor(() => sse.events.length > eventsBefore, {
      timeoutMs: 15000,
      label: 'config reload sse',
    });
    assert.equal(sse.events.length, eventsBefore + 1);

    const root = await httpRequest({ port, path: '/' });
    assert.equal(root.status, 200);

    sse.close();
    await cli.stop();
  });

  it('dev: 不正 config と restart 必須変更では reload しない', async () => {
    const port = await getFreePort();
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          serve: { host: '127.0.0.1', port },
          watch: { debounce: 80 },
        },
      },
    });
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.dev,
      cwd: ws.workspaceRoot,
      args: ['sample'],
      ipc: true,
      timeoutMs: 60000,
    });
    children.push(cli);
    await waitForOutput(
      () => cli.output,
      '終了するには Ctrl+C を押してください。',
      { timeoutMs: 25000 }
    );

    const sse = await openSse({ port });
    await sleep(150);
    const eventsBefore = sse.events.length;

    const configPath = path.join(ws.workspaceRoot, 'jskim.config.js');
    await fsp.writeFile(configPath, 'module.exports = { projects: {', 'utf8');
    await waitForOutput(
      () => cli.output,
      '設定ファイルの再読み込みに失敗しました',
      { timeoutMs: 15000 }
    );
    await sleep(300);
    assert.equal(sse.events.length, eventsBefore);
    assert.equal(cli.child.exitCode, null);
    assert.equal((await httpRequest({ port, path: '/' })).status, 200);

    await writeProjectConfig(ws.workspaceRoot, {
      sourceDir: 'src/sample',
      outputDir: 'dist/sample-other',
      debounce: 80,
      port,
    });
    await waitForOutput(
      () => cli.output,
      'dev processの再起動が必要です',
      { timeoutMs: 15000 }
    );
    await sleep(300);
    assert.equal(sse.events.length, eventsBefore);
    assert.equal((await httpRequest({ port, path: '/' })).status, 200);

    await writeProjectConfig(ws.workspaceRoot, {
      sourceDir: 'src/sample',
      outputDir: 'dist/sample',
      debounce: 90,
      port,
    });
    await waitForOutput(() => cli.output, '設定を再読み込みしました', {
      timeoutMs: 15000,
    });
    await waitFor(() => sse.events.length > eventsBefore, {
      timeoutMs: 15000,
      label: 'recover reload',
    });
    assert.equal(sse.events.length, eventsBefore + 1);

    sse.close();
    await cli.stop();
  });

  it('build / serve は config を監視しない', async () => {
    const port = await getFreePort();
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          serve: { host: '127.0.0.1', port },
        },
      },
    });
    workspaces.push(ws);

    const build = runCli({
      scriptPath: ws.scripts.build,
      cwd: ws.workspaceRoot,
      args: ['sample'],
      timeoutMs: 20000,
    });
    children.push(build);
    const buildResult = await build.waitForExit();
    assert.equal(buildResult.code, 0);

    const serve = runCli({
      scriptPath: ws.scripts.serve,
      cwd: ws.workspaceRoot,
      args: ['sample'],
      ipc: true,
      timeoutMs: 30000,
    });
    children.push(serve);
    await waitForOutput(
      () => serve.output,
      '終了するには Ctrl+C を押してください。',
      { timeoutMs: 15000 }
    );

    await writeProjectConfig(ws.workspaceRoot, {
      sourceDir: 'src/sample',
      outputDir: 'dist/sample',
      debounce: 80,
      port,
    });
    await sleep(800);
    assert.doesNotMatch(serve.output, /設定を再読み込みしました/);
    assert.equal((await httpRequest({ port, path: '/' })).status, 200);

    await serve.stop();
  });
});

/**
 * @param {string} workspaceRoot
 * @param {{ sourceDir: string, outputDir: string, debounce?: number, port?: number, liveReload?: boolean }} values
 */
async function writeProjectConfig(workspaceRoot, values) {
  const configPath = path.join(workspaceRoot, 'jskim.config.js');
  const debounce = values.debounce != null ? values.debounce : 80;
  const port = values.port != null ? values.port : 3000;
  const liveReload = values.liveReload !== false;
  const body = `module.exports = {
  defaults: {
    render: [
      {
        from: 'pages',
        to: '',
        include: ['**/*.njk'],
        extension: '.html',
      },
    ],
    templates: ['layouts', 'components'],
    copy: [
      {
        from: 'assets',
        to: 'assets',
      },
    ],
    build: {
      clean: true,
    },
    watch: {
      debounce: ${debounce},
    },
    serve: {
      host: '127.0.0.1',
      port: ${port},
    },
    dev: {
      liveReload: ${liveReload},
    },
  },
  projects: {
    sample: {
      sourceDir: ${JSON.stringify(values.sourceDir)},
      outputDir: ${JSON.stringify(values.outputDir)},
    },
  },
};
`;
  // eslint-disable-next-line import/no-dynamic-require, global-require
  delete require.cache[require.resolve(configPath)];
  await fsp.writeFile(configPath, body, 'utf8');
}
