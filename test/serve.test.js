'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createTestWorkspace } = require('./helpers/create-test-workspace');
const { runCli } = require('./helpers/run-cli');
const { waitForOutput } = require('./helpers/wait-for-output');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest } = require('./helpers/http-request');

describe('serve', () => {
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

  async function prepareBuiltWorkspace(extraOverrides = {}) {
    const port = await getFreePort();
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          serve: { host: '127.0.0.1', port },
          ...extraOverrides.defaults,
        },
        projects: extraOverrides.projects,
      },
    });
    workspaces.push(ws);

    const build = runCli({
      scriptPath: ws.scripts.build,
      cwd: ws.workspaceRoot,
      args: ['sample'],
    });
    const buildResult = await build.waitForExit();
    assert.equal(buildResult.code, 0);

    return { ws, port };
  }

  it('静的ファイルを正しく提供し live reload を有効にしない', async () => {
    const { ws, port } = await prepareBuiltWorkspace();

    const cli = runCli({
      scriptPath: ws.scripts.serve,
      cwd: ws.workspaceRoot,
      args: ['sample'],
      ipc: true,
      timeoutMs: 20000,
    });
    children.push(cli);
    await waitForOutput(() => cli.output, '静的サーバーを起動しました');

    const root = await httpRequest({ port, path: '/' });
    const index = await httpRequest({ port, path: '/index.html' });
    const asset = await httpRequest({ port, path: '/assets/css/style.css' });
    const query = await httpRequest({ port, path: '/index.html?test=1' });
    const head = await httpRequest({ port, method: 'HEAD', path: '/' });
    const missing = await httpRequest({ port, path: '/missing.html' });
    const assetsDir = await httpRequest({ port, path: '/assets/' });
    const post = await httpRequest({ port, method: 'POST', path: '/' });
    const sse = await httpRequest({ port, path: '/_jskim/live-reload' });
    const trav1 = await httpRequest({ port, path: '/../jskim.config.js' });
    const trav2 = await httpRequest({
      port,
      path: '/%2e%2e/jskim.config.js',
    });
    const trav3 = await httpRequest({
      port,
      path: '/assets/../../jskim.config.js',
    });

    const disk = await fsp.readFile(
      path.join(ws.workspaceRoot, 'dist/sample/index.html')
    );

    assert.equal(root.status, 200);
    assert.match(String(root.headers['content-type']), /text\/html/);
    assert.equal(root.headers['cache-control'], 'no-store');
    assert.ok(root.body.equals(disk), 'serve 応答は dist 原本と同一であるべき');
    assert.equal(root.body.toString('utf8').includes('EventSource'), false);

    assert.equal(index.status, 200);
    assert.equal(asset.status, 200);
    assert.match(String(asset.headers['content-type']), /text\/css/);
    assert.equal(query.status, 200);

    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.match(String(head.headers['content-type']), /text\/html/);

    assert.equal(missing.status, 404);
    assert.match(missing.body.toString('utf8'), /ファイルが見つかりません/);

    assert.equal(assetsDir.status, 404);
    assert.equal(assetsDir.body.toString('utf8').includes('Index of'), false);

    assert.equal(post.status, 405);
    assert.match(String(post.headers.allow || ''), /GET/);
    assert.match(post.body.toString('utf8'), /このHTTPメソッドは使用できません/);

    assert.equal(sse.status, 404);

    const configText = await fsp.readFile(
      path.join(ws.workspaceRoot, 'jskim.config.js'),
      'utf8'
    );
    assert.equal(trav1.status, 404);
    assert.equal(trav2.status, 404);
    assert.equal(trav3.status, 404);
    assert.equal(trav1.body.toString('utf8').includes(configText.slice(0, 20)), false);
    assert.equal(trav2.body.toString('utf8').includes('module.exports'), false);

    const exit = await cli.stop();
    assert.match(cli.output, /静的サーバーを停止しました/);
    assert.equal(exit.code, 0);
  });

  it('outputDir が無い場合はビルド案内を出して終了する', async () => {
    const port = await getFreePort();
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          serve: { host: '127.0.0.1', port },
        },
      },
    });
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.serve,
      cwd: ws.workspaceRoot,
      args: ['sample'],
    });
    const result = await cli.waitForExit();
    assert.equal(result.code, 1);
    assert.match(result.output, /ビルド出力が見つかりません/);
    assert.match(result.output, /jskim build sample/);
  });

  it('不正な serve.port は設定エラーになる', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          serve: { host: '127.0.0.1', port: -1 },
        },
      },
    });
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.serve,
      cwd: ws.workspaceRoot,
      args: ['sample'],
    });
    const result = await cli.waitForExit();
    assert.equal(result.code, 1);
    assert.match(result.output, /設定値が不正です: serve.port/);
  });

  it('ポート衝突時は日本語エラーで終了する', async () => {
    const { ws, port } = await prepareBuiltWorkspace();

    const first = runCli({
      scriptPath: ws.scripts.serve,
      cwd: ws.workspaceRoot,
      args: ['sample'],
      ipc: true,
      timeoutMs: 20000,
    });
    children.push(first);
    await waitForOutput(() => first.output, '静的サーバーを起動しました');

    const second = runCli({
      scriptPath: ws.scripts.serve,
      cwd: ws.workspaceRoot,
      args: ['sample'],
      ipc: true,
      timeoutMs: 15000,
    });
    children.push(second);
    const secondExit = await second.waitForExit();
    assert.equal(secondExit.code, 1);
    assert.match(secondExit.output, /すでに使用されています/);
    assert.match(secondExit.output, /ホスト:/);
    assert.match(secondExit.output, /ポート:/);
    assert.match(secondExit.output, /jskim serve sample --port/);
    assert.match(secondExit.output, /serve\.port/);
    assert.equal(first.child.exitCode, null);

    const stillOk = await httpRequest({ port, path: '/' });
    assert.equal(stillOk.status, 200);

    await first.stop();
  });
});
