'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createTestWorkspace } = require('./helpers/create-test-workspace');
const { runCli } = require('./helpers/run-cli');
const { waitForOutput, waitFor } = require('./helpers/wait-for-output');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest } = require('./helpers/http-request');
const {
  applyServeCliOverrides,
} = require('../scripts/lib/apply-serve-cli-overrides');
const { createWatchRuntime } = require('../scripts/lib/create-watch-runtime');
const { buildProject } = require('../scripts/lib/build-project');

describe('CLI host/port/open', { timeout: 120000 }, () => {
  const workspaces = [];
  const children = [];
  const runtimes = [];

  after(async () => {
    for (const child of children) {
      // eslint-disable-next-line no-await-in-loop
      await child.forceKill().catch(() => {});
    }
    for (const runtime of runtimes) {
      // eslint-disable-next-line no-await-in-loop
      await runtime.close().catch(() => {});
    }
    for (const ws of workspaces) {
      // eslint-disable-next-line no-await-in-loop
      await ws.cleanup();
    }
  });

  it('applyServeCliOverrides は元オブジェクトを変更しない', () => {
    const project = {
      name: 'sample',
      serve: { host: '127.0.0.1', port: 3000 },
    };
    const next = applyServeCliOverrides(project, {
      host: '0.0.0.0',
      port: '4000',
    });
    assert.equal(project.serve.host, '127.0.0.1');
    assert.equal(project.serve.port, 3000);
    assert.equal(next.serve.host, '0.0.0.0');
    assert.equal(next.serve.port, 4000);
    assert.notEqual(next, project);
    assert.notEqual(next.serve, project.serve);
  });

  it('不正な --port は失敗する', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);

    for (const port of ['0', '-1', '65536', 'abc', '3000.5']) {
      const cli = runCli({
        scriptPath: ws.scripts.bin,
        cwd: ws.workspaceRoot,
        args: ['serve', 'sample', '--port', port],
      });
      // eslint-disable-next-line no-await-in-loop
      const result = await cli.waitForExit();
      assert.equal(result.code, 1, port);
      assert.match(result.output, /CLI --port|serve\.port/, port);
    }
  });

  it('serve --port で config より CLI が優先される', async () => {
    const configPort = await getFreePort();
    const cliPort = await getFreePort();
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          serve: { host: '127.0.0.1', port: configPort },
        },
      },
    });
    workspaces.push(ws);

    const build = runCli({
      scriptPath: ws.scripts.bin,
      cwd: ws.workspaceRoot,
      args: ['build', 'sample'],
      timeoutMs: 20000,
    });
    assert.equal((await build.waitForExit()).code, 0);

    const cli = runCli({
      scriptPath: ws.scripts.bin,
      cwd: ws.workspaceRoot,
      args: ['serve', 'sample', '--port', String(cliPort)],
      ipc: true,
      timeoutMs: 20000,
    });
    children.push(cli);
    await waitFor(
      () => cli.output.includes(`:${cliPort}/`),
      {
        timeoutMs: 20000,
        label: 'serve url with cli port',
      }
    );
    assert.match(cli.output, /静的サーバーを起動しました/);

    const ok = await httpRequest({ port: cliPort, path: '/' });
    assert.equal(ok.status, 200);
    await cli.stop();
  });

  it('dev --port は config reload 後も override を維持する', async () => {
    const port = await getFreePort();
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          serve: { host: '127.0.0.1', port: 1 },
          watch: { debounce: 80 },
        },
      },
    });
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.bin,
      cwd: ws.workspaceRoot,
      args: ['dev', 'sample', '--port', String(port)],
      ipc: true,
      timeoutMs: 60000,
    });
    children.push(cli);
    await waitFor(
      () => cli.output.includes(`http://127.0.0.1:${port}/`),
      {
        timeoutMs: 30000,
        label: 'dev url with cli port',
      }
    );
    assert.match(cli.output, /開発サーバーを起動しました/);

    await writeDevConfig(ws.workspaceRoot, {
      port: port + 1 > 65535 ? Math.max(1, port - 1) : port + 1,
      debounce: 80,
    });
    await waitForOutput(() => cli.output, '設定を再読み込みしました', {
      timeoutMs: 15000,
    });
    assert.equal(cli.output.includes('再起動が必要です'), false);

    const still = await httpRequest({ port, path: '/' });
    assert.equal(still.status, 200);
    await cli.stop();
  });

  it('CLI port 無しで config port 変更すると再起動警告', async () => {
    const port = await getFreePort();
    const nextPort = await getFreePort();
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
      scriptPath: ws.scripts.bin,
      cwd: ws.workspaceRoot,
      args: ['dev', 'sample'],
      ipc: true,
      timeoutMs: 60000,
    });
    children.push(cli);
    await waitForOutput(() => cli.output, '開発サーバーを起動しました', {
      timeoutMs: 30000,
    });

    await writeDevConfig(ws.workspaceRoot, {
      port: nextPort,
      debounce: 80,
    });
    await waitForOutput(() => cli.output, '再起動が必要です', {
      timeoutMs: 15000,
    });
    assert.match(cli.output, /serve\.port/);

    const still = await httpRequest({ port, path: '/' });
    assert.equal(still.status, 200);
    await cli.stop();
  });

  it('open は listen 成功後に1回だけ呼ばれ、失敗は warning', async () => {
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

    await buildProject('sample', {
      workspaceRoot: ws.workspaceRoot,
      commandName: 'dev',
    });

    const openCalls = [];
    const logs = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = (...args) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };
    console.warn = (...args) => {
      logs.push(args.join(' '));
      originalWarn(...args);
    };

    const runtime = createWatchRuntime({
      mode: 'dev',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      commandName: 'dev',
      cliOverrides: { open: true },
      openBrowserFn(url) {
        openCalls.push(url);
        return {
          ok: false,
          error: new Error('mock open failure'),
          command: 'mock',
          args: [url],
        };
      },
    });
    runtimes.push(runtime);

    try {
      await runtime.start();
      assert.equal(openCalls.length, 1);
      assert.equal(openCalls[0], `http://127.0.0.1:${port}/`);
      assert.ok(
        logs.some((line) => line.includes('browserを開けませんでした'))
      );
      assert.ok(logs.some((line) => line.includes(openCalls[0])));

      // config reload（実質変更なし）でも open は増えない
      await writeDevConfig(ws.workspaceRoot, {
        port,
        debounce: 80,
      });
      await waitForOutput(
        () => logs.join('\n'),
        '監視対象を更新しました',
        { timeoutMs: 15000 }
      );
      assert.equal(openCalls.length, 1);

      const page = await httpRequest({ port, path: '/' });
      assert.equal(page.status, 200);
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      await runtime.close();
    }
  });

  it('listen 失敗時は browser open を試みない', async () => {
    const busy = await getFreePort();
    const blocker = require('node:http').createServer();
    await new Promise((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(busy, '127.0.0.1', resolve);
    });

    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          serve: { host: '127.0.0.1', port: busy },
          watch: { debounce: 80 },
        },
      },
    });
    workspaces.push(ws);

    const openCalls = [];
    const runtime = createWatchRuntime({
      mode: 'dev',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      commandName: 'dev',
      cliOverrides: { open: true },
      openBrowserFn(url) {
        openCalls.push(url);
        return { ok: true, command: 'mock', args: [url] };
      },
    });
    runtimes.push(runtime);

    try {
      await assert.rejects(() => runtime.start(), /すでに使用されています/);
      assert.equal(openCalls.length, 0);
    } finally {
      await runtime.close().catch(() => {});
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  it('option 前後の --port が同等に動く', async () => {
    const port = await getFreePort();
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          serve: { host: '127.0.0.1', port: 1 },
        },
      },
    });
    workspaces.push(ws);

    const build = runCli({
      scriptPath: ws.scripts.bin,
      cwd: ws.workspaceRoot,
      args: ['build'],
      timeoutMs: 20000,
    });
    assert.equal((await build.waitForExit()).code, 0);

    const cli = runCli({
      scriptPath: ws.scripts.serve,
      cwd: ws.workspaceRoot,
      args: ['--port', String(port), 'sample'],
      ipc: true,
      timeoutMs: 20000,
    });
    children.push(cli);
    await waitForOutput(() => cli.output, '静的サーバーを起動しました');
    const ok = await httpRequest({ port, path: '/' });
    assert.equal(ok.status, 200);
    await cli.stop();
  });
});

async function writeDevConfig(workspaceRoot, values) {
  const configPath = path.join(workspaceRoot, 'jskim.config.js');
  const debounce = values.debounce != null ? values.debounce : 80;
  const port = values.port;
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
    copy: [{ from: 'assets', to: 'assets' }],
    build: { clean: true },
    watch: { debounce: ${debounce} },
    serve: { host: '127.0.0.1', port: ${port} },
    dev: { liveReload: true },
  },
  projects: {
    sample: {
      sourceDir: 'src/sample',
      outputDir: 'dist/sample',
    },
  },
};
`;
  delete require.cache[require.resolve(configPath)];
  await fsp.writeFile(configPath, body, 'utf8');
}
