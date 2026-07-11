'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createTestWorkspace } = require('./helpers/create-test-workspace');
const { runCli } = require('./helpers/run-cli');
const { waitFor, waitForOutput, sleep } = require('./helpers/wait-for-output');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest, openSse } = require('./helpers/http-request');

describe('dev', () => {
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

  async function startDev(extraDefaults = {}) {
    const port = await getFreePort();
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          serve: { host: '127.0.0.1', port },
          watch: { debounce: 100 },
          ...extraDefaults,
        },
      },
    });
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.dev,
      cwd: ws.workspaceRoot,
      args: ['sample'],
      ipc: true,
      timeoutMs: 45000,
    });
    children.push(cli);

    await waitForOutput(() => cli.output, '終了するには Ctrl+C を押してください。', {
      timeoutMs: 20000,
    });

    return { ws, port, cli };
  }

  it('初回ビルド後に HTML 注入と SSE を提供する', async () => {
    const { ws, port, cli } = await startDev();

    const root = await httpRequest({ port, path: '/' });
    const disk = await fsp.readFile(
      path.join(ws.workspaceRoot, 'dist/sample/index.html'),
      'utf8'
    );
    const html = root.body.toString('utf8');

    assert.equal(root.status, 200);
    assert.match(html, /INDEX_OK/);
    assert.match(html, /EventSource/);
    assert.match(html, /\/_jskim\/live-reload/);
    assert.equal(disk.includes('EventSource'), false);
    assert.equal(disk.includes('/_jskim/live-reload'), false);

    const css = await httpRequest({ port, path: '/assets/css/style.css' });
    assert.equal(css.status, 200);
    assert.equal(css.body.toString('utf8').includes('EventSource'), false);

    const head = await httpRequest({ port, method: 'HEAD', path: '/' });
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(
      Number(head.headers['content-length']),
      Number(root.headers['content-length'])
    );

    const sse = await openSse({ port });
    assert.equal(sse.status, 200);
    assert.match(String(sse.headers['content-type']), /text\/event-stream/);
    sse.close();

    await cli.stop();
    assert.match(cli.output, /開発サーバーを停止しました/);
  });

  it('成功した再ビルドでのみ reload を送り、失敗時は送らない', async () => {
    const { ws, port, cli } = await startDev();
    const sse = await openSse({ port });
    await sleep(150);

    const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');
    const distIndex = path.join(ws.workspaceRoot, 'dist/sample/index.html');

    const beforeRebuild = (cli.output.match(/再ビルドが完了しました/g) || [])
      .length;
    const beforeEvents = sse.events.length;
    let source = await fsp.readFile(indexPath, 'utf8');
    await fsp.writeFile(
      indexPath,
      source.replace('INDEX_OK', 'DEV_RELOAD_OK'),
      'utf8'
    );

    await waitFor(
      () =>
        (cli.output.match(/再ビルドが完了しました/g) || []).length >
        beforeRebuild,
      { timeoutMs: 15000, label: 'dev page rebuild' }
    );
    await waitFor(() => sse.events.length > beforeEvents, {
      timeoutMs: 10000,
      label: 'reload event',
    });
    assert.equal(sse.events.length, beforeEvents + 1);
    assert.match(fs.readFileSync(distIndex, 'utf8'), /DEV_RELOAD_OK/);

    const failBefore = (cli.output.match(/再ビルドに失敗しました/g) || [])
      .length;
    const eventsBeforeFail = sse.events.length;
    await fsp.writeFile(
      indexPath,
      '{% extends "layouts/base.njk" %}{% block content %}{% if %}{% endblock %}\n',
      'utf8'
    );
    await waitFor(
      () =>
        (cli.output.match(/再ビルドに失敗しました/g) || []).length > failBefore,
      { timeoutMs: 15000, label: 'dev fail' }
    );
    await sleep(300);
    assert.equal(sse.events.length, eventsBeforeFail);
    assert.equal(cli.child.exitCode, null);

    const recoverBefore = (cli.output.match(/再ビルドが完了しました/g) || [])
      .length;
    const eventsBeforeRecover = sse.events.length;
    await fsp.writeFile(
      indexPath,
      '{% extends "layouts/base.njk" %}{% block content %}<p class="marker">RECOVER_OK</p>{% endblock %}\n',
      'utf8'
    );
    await waitFor(
      () =>
        (cli.output.match(/再ビルドが完了しました/g) || []).length >
        recoverBefore,
      { timeoutMs: 15000, label: 'dev recover' }
    );
    await waitFor(() => sse.events.length > eventsBeforeRecover, {
      timeoutMs: 10000,
      label: 'recover reload',
    });
    assert.equal(sse.events.length, eventsBeforeRecover + 1);

    const cssPath = path.join(
      ws.workspaceRoot,
      'src/sample/assets/css/style.css'
    );
    const beforeDeb = (cli.output.match(/再ビルドが完了しました/g) || [])
      .length;
    const eventsBeforeDeb = sse.events.length;
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fsp.writeFile(cssPath, `/* D_${i} */\n`, 'utf8');
      // eslint-disable-next-line no-await-in-loop
      await sleep(15);
    }
    await sleep(500);
    await waitFor(
      () =>
        (cli.output.match(/再ビルドが完了しました/g) || []).length > beforeDeb,
      { timeoutMs: 15000, label: 'debounce rebuild' }
    );
    await sleep(300);
    const rebuildDelta =
      (cli.output.match(/再ビルドが完了しました/g) || []).length - beforeDeb;
    const reloadDelta = sse.events.length - eventsBeforeDeb;
    assert.ok(rebuildDelta <= 3);
    assert.ok(reloadDelta >= 1 && reloadDelta <= 3);

    sse.close();
    await cli.stop();
  });

  it('liveReload=false では注入と SSE を無効化する', async () => {
    const { ws, port, cli } = await startDev({
      dev: { liveReload: false },
    });

    assert.match(cli.output, /ライブリロード: 無効/);

    const root = await httpRequest({ port, path: '/' });
    assert.equal(root.body.toString('utf8').includes('EventSource'), false);

    const sse = await httpRequest({ port, path: '/_jskim/live-reload' });
    assert.equal(sse.status, 404);

    const cssPath = path.join(
      ws.workspaceRoot,
      'src/sample/assets/css/style.css'
    );
    const before = (cli.output.match(/再ビルドが完了しました/g) || []).length;
    await fsp.writeFile(cssPath, '/* LR_OFF */\n', 'utf8');
    await waitFor(
      () => (cli.output.match(/再ビルドが完了しました/g) || []).length > before,
      { timeoutMs: 15000, label: 'rebuild without liveReload' }
    );
    assert.match(
      fs.readFileSync(
        path.join(ws.workspaceRoot, 'dist/sample/assets/css/style.css'),
        'utf8'
      ),
      /LR_OFF/
    );

    await cli.stop();
  });

  it('ポート衝突時は cleanup して exit code 1 になる', async () => {
    const { port, cli: first } = await startDev();

    const ws2 = await createTestWorkspace({
      configOverrides: {
        defaults: {
          serve: { host: '127.0.0.1', port },
          watch: { debounce: 100 },
        },
      },
    });
    workspaces.push(ws2);

    const second = runCli({
      scriptPath: ws2.scripts.dev,
      cwd: ws2.workspaceRoot,
      args: ['sample'],
      ipc: true,
      timeoutMs: 30000,
    });
    children.push(second);

    const secondExit = await second.waitForExit();
    assert.equal(secondExit.code, 1);
    assert.match(secondExit.output, /すでに使用されています/);
    assert.equal(first.child.exitCode, null);

    const stillOk = await httpRequest({ port, path: '/' });
    assert.equal(stillOk.status, 200);

    await first.stop();
  });
});
