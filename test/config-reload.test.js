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

const NUNJUCKS_MODULE = require.resolve('nunjucks');

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
      '以前の正常な設定を継続します',
      { timeoutMs: 15000 }
    );
    assert.match(cli.output, /設定ファイルの再読み込みに失敗しました/);
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

  it('watch: files mode の data / filter / global / files.from 変更を反映する', async () => {
    const ws = await createFilesReloadWorkspace();
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.watch,
      cwd: ws.workspaceRoot,
      args: ['sample'],
      ipc: true,
      timeoutMs: 90000,
    });
    children.push(cli);
    await waitForOutput(() => cli.output, 'プロジェクトを監視しています', {
      timeoutMs: 20000,
    });

    const distIndex = path.join(ws.workspaceRoot, 'dist/sample/index.html');
    const distJs = path.join(ws.workspaceRoot, 'dist/sample/assets/js/main.js');
    await waitFor(() => fs.existsSync(distIndex) && fs.existsSync(distJs), {
      timeoutMs: 10000,
      label: 'files initial build',
    });
    assert.match(fs.readFileSync(distIndex, 'utf8'), /Alpha/);
    assert.match(fs.readFileSync(distJs, 'utf8'), /"name":"Alpha"/);
    assert.equal(fs.readFileSync(distJs, 'utf8').includes('&quot;'), false);

    await reloadFilesConfigAndWait(cli, ws.workspaceRoot, {
      siteName: 'Beta',
      filterLabel: 'F1',
      globalLabel: 'G1',
      from: 'pages',
      distIndex,
      expected: /Beta/,
    });
    assert.match(fs.readFileSync(distJs, 'utf8'), /"name":"Beta"/);

    await reloadFilesConfigAndWait(cli, ws.workspaceRoot, {
      siteName: 'Beta',
      filterLabel: 'F2',
      globalLabel: 'G1',
      from: 'pages',
      distIndex,
      expected: /F2:Beta/,
    });

    await reloadFilesConfigAndWait(cli, ws.workspaceRoot, {
      siteName: 'Beta',
      filterLabel: 'F2',
      globalLabel: 'G2',
      from: 'pages',
      distIndex,
      expected: /G2/,
    });

    const lastGood = fs.readFileSync(distIndex, 'utf8');
    const failBefore = (
      cli.output.match(/設定ファイルの再読み込みに失敗しました/g) || []
    ).length;
    await writeFilesProjectConfig(ws.workspaceRoot, {
      siteName: 'Broken',
      filterLabel: 'BAD',
      globalLabel: 'BAD',
      from: 'pages',
      invalidFilter: true,
    });
    await waitFor(
      () =>
        (cli.output.match(/設定ファイルの再読み込みに失敗しました/g) || [])
          .length > failBefore,
      { timeoutMs: 15000, label: 'invalid filter keeps last good' }
    );
    assert.equal(cli.child.exitCode, null);
    assert.equal(fs.readFileSync(distIndex, 'utf8'), lastGood);

    await reloadFilesConfigAndWait(cli, ws.workspaceRoot, {
      siteName: 'Gamma',
      filterLabel: 'F3',
      globalLabel: 'G3',
      from: 'pages',
      distIndex,
      expected: /F3:Gamma[\s\S]*G3/,
    });

    await fse.outputFile(
      path.join(ws.workspaceRoot, 'src/files/pages-alt/index.html.njk'),
      '<p>ALT_INDEX {{ site.name }} {{ site.name | marker }} {{ currentMarker() }}</p>\n'
    );
    await fse.outputFile(
      path.join(ws.workspaceRoot, 'src/files/pages-alt/request/index.html.njk'),
      '<p>ALT_REQUEST {{ site.name }}</p>\n'
    );
    await reloadFilesConfigAndWait(cli, ws.workspaceRoot, {
      siteName: 'Alt',
      filterLabel: 'FA',
      globalLabel: 'GA',
      from: 'pages-alt',
      distIndex,
      expected: /ALT_INDEX Alt FA:Alt GA/,
    });

    const oldBefore = (cli.output.match(/再ビルドが完了しました/g) || []).length;
    await fsp.writeFile(
      path.join(ws.workspaceRoot, 'src/files/pages/index.html.njk'),
      '<p>OLD_SHOULD_NOT_REBUILD</p>\n',
      'utf8'
    );
    await sleep(600);
    assert.equal(
      (cli.output.match(/再ビルドが完了しました/g) || []).length,
      oldBefore,
      '変更前 files.from は監視しない'
    );
    assert.doesNotMatch(fs.readFileSync(distIndex, 'utf8'), /OLD_SHOULD_NOT_REBUILD/);

    const altBefore = (cli.output.match(/再ビルドが完了しました/g) || []).length;
    await fsp.writeFile(
      path.join(ws.workspaceRoot, 'src/files/pages-alt/index.html.njk'),
      '<p>ALT_CHANGED {{ site.name }}</p>\n',
      'utf8'
    );
    await waitFor(
      () => (cli.output.match(/再ビルドが完了しました/g) || []).length > altBefore,
      { timeoutMs: 15000, label: 'files.from rebuild' }
    );
    assert.match(fs.readFileSync(distIndex, 'utf8'), /ALT_CHANGED Alt/);

    const nestedDist = path.join(
      ws.workspaceRoot,
      'dist/sample/request/index.html'
    );
    const nestedBefore = (cli.output.match(/再ビルドが完了しました/g) || []).length;
    await fsp.writeFile(
      path.join(ws.workspaceRoot, 'src/files/pages-alt/request/index.html.njk'),
      '<p>NESTED_CHANGED {{ site.name }}</p>\n',
      'utf8'
    );
    await waitFor(
      () =>
        (cli.output.match(/再ビルドが完了しました/g) || []).length > nestedBefore,
      { timeoutMs: 15000, label: 'nested files rebuild' }
    );
    assert.match(fs.readFileSync(nestedDist, 'utf8'), /NESTED_CHANGED Alt/);

    const syntaxFailBefore = (
      cli.output.match(/設定ファイルの再読み込みに失敗しました/g) || []
    ).length;
    await fsp.writeFile(
      path.join(ws.workspaceRoot, 'jskim.config.js'),
      'module.exports = {\n',
      'utf8'
    );
    await waitFor(
      () =>
        (cli.output.match(/設定ファイルの再読み込みに失敗しました/g) || [])
          .length > syntaxFailBefore,
      { timeoutMs: 15000, label: 'invalid config survives' }
    );
    assert.equal(cli.child.exitCode, null);

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

async function createFilesReloadWorkspace() {
  const ws = await createTestWorkspace();
  const sourceRoot = path.join(ws.workspaceRoot, 'src/files');

  await fse.outputFile(
    path.join(sourceRoot, 'pages/index.html.njk'),
    [
      '<!doctype html>',
      '<title>{{ site.name }}</title>',
      '<p id="site">{{ site.name }}</p>',
      '<p id="filter">{{ site.name | marker }}</p>',
      '<p id="global">{{ currentMarker() }}</p>',
      '<script src="{{ rootPath }}assets/js/main.js"></script>',
      '',
    ].join('\n')
  );
  await fse.outputFile(
    path.join(sourceRoot, 'pages/assets/js/main.js.njk'),
    'const site = {{ site | toJson }};\nconsole.info(site.name);\n'
  );
  await fse.outputFile(
    path.join(sourceRoot, 'pages/request/index.html.njk'),
    '<p>REQUEST {{ site.name }} {{ currentMarker() }}</p>\n'
  );

  await writeFilesProjectConfig(ws.workspaceRoot, {
    siteName: 'Alpha',
    filterLabel: 'F1',
    globalLabel: 'G1',
    from: 'pages',
  });

  return ws;
}

async function reloadFilesConfigAndWait(cli, workspaceRoot, values) {
  const before = (cli.output.match(/設定を再読み込みしました/g) || []).length;
  await writeFilesProjectConfig(workspaceRoot, values);
  await waitFor(
    () => (cli.output.match(/設定を再読み込みしました/g) || []).length > before,
    { timeoutMs: 15000, label: 'files config reload' }
  );
  await waitFor(
    () => {
      try {
        return values.expected.test(fs.readFileSync(values.distIndex, 'utf8'));
      } catch {
        return false;
      }
    },
    { timeoutMs: 15000, label: 'files config output' }
  );
}

async function writeFilesProjectConfig(workspaceRoot, values) {
  const filterBody = values.invalidFilter
    ? 'marker: "not function",'
    : `marker(value) {
          return ${JSON.stringify(values.filterLabel)} + ':' + value;
        },`;

  const body = `module.exports = {
  defaults: {
    files: [{ from: ${JSON.stringify(values.from)}, to: '' }],
    render: [],
    copy: [],
    templates: [],
    data: {
      site: {
        name: ${JSON.stringify(values.siteName)},
      },
    },
    nunjucks: {
      filters: {
        ${filterBody}
        toJson(value) {
          const nunjucks = require(${JSON.stringify(NUNJUCKS_MODULE)});
          return new nunjucks.runtime.SafeString(JSON.stringify(value));
        },
      },
      globals: {
        currentMarker() {
          return ${JSON.stringify(values.globalLabel)};
        },
      },
    },
    build: { clean: true },
    watch: { debounce: 80 },
    serve: { host: '127.0.0.1', port: 3000 },
    dev: { liveReload: true },
  },
  projects: {
    sample: {
      sourceDir: 'src/files',
      outputDir: 'dist/sample',
    },
  },
};
`;
  await fsp.writeFile(path.join(workspaceRoot, 'jskim.config.js'), body, 'utf8');
}
