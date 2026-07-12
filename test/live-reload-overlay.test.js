'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { createLiveReload } = require('../scripts/lib/create-live-reload');
const { createTestWorkspace } = require('./helpers/create-test-workspace');
const { runCli } = require('./helpers/run-cli');
const { waitFor, waitForOutput, sleep } = require('./helpers/wait-for-output');
const { getFreePort } = require('./helpers/get-free-port');
const { openSse } = require('./helpers/http-request');

describe('live-reload overlay / CSS SSE', () => {
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
      timeoutMs: 60000,
    });
    children.push(cli);

    await waitForOutput(() => cli.output, '終了するには Ctrl+C を押してください。', {
      timeoutMs: 25000,
    });

    return { ws, port, cli };
  }

  it('template 構文エラーで error event を送り reload/css は送らない', async () => {
    const { ws, port, cli } = await startDev();
    const sse = await openSse({ port });
    await sleep(150);

    const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');
    const reloadBefore = sse.count('reload');
    const cssBefore = sse.count('css');
    const errorBefore = sse.count('error');

    await fsp.writeFile(
      indexPath,
      '{% extends "layouts/base.njk" %}{% block content %}{% if %}{% endblock %}\n',
      'utf8'
    );
    await waitForOutput(() => cli.output, '再ビルドに失敗しました', {
      timeoutMs: 20000,
    });
    await waitFor(() => sse.count('error') > errorBefore, {
      timeoutMs: 10000,
      label: 'error event',
    });

    const last = sse.last('error');
    assert.ok(last);
    const payload = JSON.parse(last.data);
    assert.equal(payload.project, 'sample');
    assert.match(payload.message, /\[JSKim\]/);
    assert.ok(payload.message.includes('\n'));
    assert.equal(sse.count('reload'), reloadBefore);
    assert.equal(sse.count('css'), cssBefore);

    sse.close();
    await cli.stop();
  });

  it('include 欠落でも error を送り、複数 client に配信する', async () => {
    const { ws, port, cli } = await startDev();
    const sseA = await openSse({ port });
    const sseB = await openSse({ port });
    await sleep(150);

    const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');
    await fsp.writeFile(
      indexPath,
      '{% extends "layouts/base.njk" %}{% block content %}{% include "missing-part.njk" %}{% endblock %}\n',
      'utf8'
    );
    await waitForOutput(() => cli.output, '再ビルドに失敗しました', {
      timeoutMs: 20000,
    });
    await waitFor(() => sseA.count('error') >= 1 && sseB.count('error') >= 1, {
      timeoutMs: 10000,
      label: 'multi client error',
    });

    const msgA = JSON.parse(sseA.last('error').data).message;
    const msgB = JSON.parse(sseB.last('error').data).message;
    assert.match(msgA, /missing-part|template not found|見つかり|include|Unable/i);
    assert.equal(msgA, msgB);
    assert.equal(sseA.count('reload'), 0);
    assert.equal(sseB.count('css'), 0);

    sseA.close();
    sseB.close();
    await cli.stop();
  });

  it('reconnect で lastError を再送し、復旧後は再送しない', async () => {
    const { ws, port, cli } = await startDev();
    const sse1 = await openSse({ port });
    await sleep(100);

    const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');
    await fsp.writeFile(indexPath, '{% if %}\n', 'utf8');
    await waitFor(() => sse1.count('error') >= 1, {
      timeoutMs: 15000,
      label: 'first error',
    });
    const errMessage = JSON.parse(sse1.last('error').data).message;
    sse1.close();

    const sse2 = await openSse({ port });
    await waitFor(() => sse2.count('error') >= 1, {
      timeoutMs: 10000,
      label: 'replay error',
    });
    assert.equal(JSON.parse(sse2.last('error').data).message, errMessage);

    const beforeRecover = (cli.output.match(/再ビルドが完了しました/g) || [])
      .length;
    await fsp.writeFile(
      indexPath,
      '{% extends "layouts/base.njk" %}{% block content %}<p>OK</p>{% endblock %}\n',
      'utf8'
    );
    await waitFor(
      () =>
        (cli.output.match(/再ビルドが完了しました/g) || []).length >
        beforeRecover,
      { timeoutMs: 20000, label: 'recover build' }
    );
    await waitFor(() => sse2.count('reload') >= 1, {
      timeoutMs: 10000,
      label: 'recover reload',
    });
    sse2.close();

    const sse3 = await openSse({ port });
    await sleep(400);
    assert.equal(sse3.count('error'), 0);
    sse3.close();
    await cli.stop();
  });

  it('CSS-only 成功は css のみ送り、HTML 変更は reload する', async () => {
    const { ws, port, cli } = await startDev();
    const sse = await openSse({ port });
    await sleep(150);

    const cssPath = path.join(
      ws.workspaceRoot,
      'src/sample/assets/css/style.css'
    );
    const before = (cli.output.match(/再ビルドが完了しました/g) || []).length;
    const reloadBefore = sse.count('reload');
    await fsp.writeFile(cssPath, '/* CSS_OK */\nbody{color:red}\n', 'utf8');
    await waitFor(
      () => (cli.output.match(/再ビルドが完了しました/g) || []).length > before,
      { timeoutMs: 15000, label: 'css rebuild' }
    );
    await waitFor(() => sse.count('css') >= 1, {
      timeoutMs: 10000,
      label: 'css event',
    });
    assert.equal(sse.count('reload'), reloadBefore);
    assert.match(
      fs.readFileSync(
        path.join(ws.workspaceRoot, 'dist/sample/assets/css/style.css'),
        'utf8'
      ),
      /CSS_OK/
    );

    const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');
    const htmlBefore = (cli.output.match(/再ビルドが完了しました/g) || [])
      .length;
    const reloadBeforeHtml = sse.count('reload');
    await fsp.writeFile(
      indexPath,
      '{% extends "layouts/base.njk" %}{% block content %}<p>HTML_OK</p>{% endblock %}\n',
      'utf8'
    );
    await waitFor(
      () =>
        (cli.output.match(/再ビルドが完了しました/g) || []).length > htmlBefore,
      { timeoutMs: 15000, label: 'html rebuild' }
    );
    await waitFor(() => sse.count('reload') > reloadBeforeHtml, {
      timeoutMs: 10000,
      label: 'html reload',
    });

    sse.close();
    await cli.stop();
  });

  it('CSS soft reload は clear-error の直後に css を送る', async () => {
    const { ws, port, cli } = await startDev();
    const sse = await openSse({ port });
    await sleep(150);

    const cssPath = path.join(
      ws.workspaceRoot,
      'src/sample/assets/css/style.css'
    );
    const cssBefore = sse.count('css');
    const clearBefore = sse.count('clear-error');
    const mark = (cli.output.match(/再ビルドが完了しました/g) || []).length;
    await fsp.writeFile(cssPath, '/* AFTER */\nbody{}\n', 'utf8');
    await waitFor(
      () => (cli.output.match(/再ビルドが完了しました/g) || []).length > mark,
      { timeoutMs: 15000, label: 'css soft rebuild' }
    );
    await waitFor(() => sse.count('css') > cssBefore, {
      timeoutMs: 10000,
      label: 'css soft event',
    });
    assert.ok(sse.count('clear-error') > clearBefore);

    const lastCssIdx = (() => {
      for (let i = sse.typedEvents.length - 1; i >= 0; i -= 1) {
        if (sse.typedEvents[i].name === 'css') {
          return i;
        }
      }
      return -1;
    })();
    assert.ok(lastCssIdx > 0);
    assert.equal(sse.typedEvents[lastCssIdx - 1].name, 'clear-error');

    sse.close();
    await cli.stop();
  });

  it('error 状態から HTML を直したあと CSS-only なら clear-error → css', async () => {
    const { ws, port, cli } = await startDev();
    const sse = await openSse({ port });
    await sleep(150);

    const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');
    await fsp.writeFile(indexPath, '{% if %}\n', 'utf8');
    await waitFor(() => sse.count('error') >= 1, {
      timeoutMs: 15000,
      label: 'error first',
    });

    const before = (cli.output.match(/再ビルドが完了しました/g) || []).length;
    await fsp.writeFile(
      indexPath,
      '{% extends "layouts/base.njk" %}{% block content %}<p>R</p>{% endblock %}\n',
      'utf8'
    );
    await waitFor(
      () => (cli.output.match(/再ビルドが完了しました/g) || []).length > before,
      { timeoutMs: 20000, label: 'html recover' }
    );
    await waitFor(() => sse.count('reload') >= 1, {
      timeoutMs: 10000,
      label: 'reload after recover',
    });

    const cssPath = path.join(
      ws.workspaceRoot,
      'src/sample/assets/css/style.css'
    );
    const cssBefore = sse.count('css');
    const mark = (cli.output.match(/再ビルドが完了しました/g) || []).length;
    await fsp.writeFile(cssPath, '/* POST_ERR_CSS */\nbody{}\n', 'utf8');
    await waitFor(
      () => (cli.output.match(/再ビルドが完了しました/g) || []).length > mark,
      { timeoutMs: 15000, label: 'css after recover' }
    );
    await waitFor(() => sse.count('css') > cssBefore, {
      timeoutMs: 10000,
      label: 'css soft after recover',
    });

    sse.close();
    await cli.stop();
  });

  it('add/unlink の CSS 変更は full reload にする', async () => {
    const { ws, port, cli } = await startDev();
    const sse = await openSse({ port });
    await sleep(150);

    const newCss = path.join(
      ws.workspaceRoot,
      'src/sample/assets/css/extra.css'
    );
    const before = (cli.output.match(/再ビルドが完了しました/g) || []).length;
    const reloadBefore = sse.count('reload');
    const cssBefore = sse.count('css');
    await fsp.writeFile(newCss, '/* EXTRA */\n', 'utf8');
    await waitFor(
      () => (cli.output.match(/再ビルドが完了しました/g) || []).length > before,
      { timeoutMs: 15000, label: 'css add rebuild' }
    );
    await waitFor(() => sse.count('reload') > reloadBefore, {
      timeoutMs: 10000,
      label: 'css add reload',
    });
    assert.equal(sse.count('css'), cssBefore);

    const unlinkBefore = (cli.output.match(/再ビルドが完了しました/g) || [])
      .length;
    const reloadBeforeUnlink = sse.count('reload');
    await fsp.unlink(newCss);
    await waitFor(
      () =>
        (cli.output.match(/再ビルドが完了しました/g) || []).length >
        unlinkBefore,
      { timeoutMs: 15000, label: 'css unlink rebuild' }
    );
    await waitFor(() => sse.count('reload') > reloadBeforeUnlink, {
      timeoutMs: 10000,
      label: 'css unlink reload',
    });

    sse.close();
    await cli.stop();
  });

  it('files mode の css.njk 構文エラー復旧は clear-error → css', async () => {
    const port = await getFreePort();
    const os = require('node:os');
    const fse = require('fs-extra');
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-css-njk-')
    );
    workspaces.push({
      cleanup: async () => {
        await fse.remove(workspaceRoot).catch(() => {});
      },
    });

    const sourceRoot = path.join(workspaceRoot, 'src/site');
    await fse.outputFile(
      path.join(sourceRoot, 'layouts/base.njk'),
      '<html><head><link rel="stylesheet" href="/assets/css/style.css"></head><body>{% block content %}{% endblock %}</body></html>\n'
    );
    await fse.outputFile(
      path.join(sourceRoot, 'pages/index.html.njk'),
      '{% extends "layouts/base.njk" %}{% block content %}<p>OK</p>{% endblock %}\n'
    );
    await fse.outputFile(
      path.join(sourceRoot, 'pages/assets/css/style.css.njk'),
      'body { color: #111; }\n'
    );
    await fsp.writeFile(
      path.join(workspaceRoot, 'jskim.config.js'),
      `module.exports = {
  defaults: {
    files: [{ from: 'pages', to: '' }],
    templates: ['layouts'],
    build: { clean: true },
    watch: { debounce: 80 },
    serve: { host: '127.0.0.1', port: ${port} },
    dev: { liveReload: true },
  },
  projects: {
    sample: {
      sourceDir: 'src/site',
      outputDir: 'dist/sample',
    },
  },
};
`,
      'utf8'
    );

    const cli = runCli({
      scriptPath: path.join(__dirname, '../scripts/dev.js'),
      cwd: workspaceRoot,
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
    const cssNjk = path.join(sourceRoot, 'pages/assets/css/style.css.njk');
    await fsp.writeFile(cssNjk, '{% if %}\n', 'utf8');
    await waitFor(() => sse.count('error') >= 1, {
      timeoutMs: 20000,
      label: 'css.njk error',
    });
    assert.equal(sse.count('reload'), 0);
    assert.equal(sse.count('css'), 0);

    const seqStart = sse.typedEvents.length;
    const before = (cli.output.match(/再ビルドが完了しました/g) || []).length;
    await fsp.writeFile(cssNjk, 'body { color: #222; }\n', 'utf8');
    await waitFor(
      () => (cli.output.match(/再ビルドが完了しました/g) || []).length > before,
      { timeoutMs: 20000, label: 'css.njk recover' }
    );
    await waitFor(() => sse.count('css') >= 1, {
      timeoutMs: 10000,
      label: 'css after css.njk recover',
    });
    const added = sse.typedEvents.slice(seqStart);
    const clearIdx = added.findIndex((e) => e.name === 'clear-error');
    const cssIdx = added.findIndex((e) => e.name === 'css');
    assert.ok(clearIdx >= 0);
    assert.ok(cssIdx > clearIdx);
    assert.equal(sse.count('reload'), 0);

    sse.close();
    await cli.stop();
  });
});

describe('createLiveReload lastError / event order', () => {
  it('config error 中は source css/reload を送らず、復旧 reload で消える', async () => {
    const live = createLiveReload({ projectName: 'sample', enabled: true });
    live.broadcastConfigError('config broken');
    assert.equal(live.hasConfigError(), true);
    assert.equal(live.lastErrorMessage, 'config broken');

    assert.equal(live.notifySourceBuildSuccess('css'), false);
    assert.equal(live.notifySourceBuildSuccess('reload'), false);
    assert.equal(live.hasConfigError(), true);
    assert.equal(live.lastErrorMessage, 'config broken');

    live.clearConfigError();
    live.broadcastBuildError('build broken');
    assert.equal(live.hasConfigError(), false);
    assert.equal(live.lastErrorMessage, 'build broken');
    assert.equal(live.notifySourceBuildSuccess('css'), true);
    assert.equal(live.lastErrorMessage, null);

    live.broadcastConfigError('config again');
    live.broadcastBuildError('ignored while config');
    assert.equal(live.lastErrorMessage, 'config again');
    assert.equal(live.buildErrorMessage, 'ignored while config');
    assert.equal(live.notifySourceBuildSuccess('reload'), false);

    live.close();
  });

  it('reconnect replay と css 成功時の clear-error → css 順を守る', async () => {
    const live = createLiveReload({ projectName: 'sample', enabled: true });

    const server = http.createServer((req, res) => {
      const handled = live.handleRequest(req, res, {
        pathname: '/_jskim/live-reload',
      });
      if (!handled) {
        res.statusCode = 404;
        res.end();
      }
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();

    function collect() {
      return new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/_jskim/live-reload',
            headers: { Accept: 'text/event-stream' },
          },
          (res) => {
            let buffer = '';
            const local = [];
            res.on('data', (chunk) => {
              buffer += chunk.toString('utf8');
              const parts = buffer.split('\n\n');
              buffer = parts.pop() || '';
              for (const part of parts) {
                if (part.includes('event:')) {
                  local.push(part);
                }
              }
            });
            resolve({
              local,
              close() {
                req.destroy();
                res.destroy();
              },
            });
          }
        );
        req.on('error', reject);
        req.end();
      });
    }

    const c1 = await collect();
    await sleep(50);
    live.broadcastError('diag\nline2');
    await waitFor(() => c1.local.some((f) => f.includes('event: error')), {
      timeoutMs: 3000,
      label: 'error to c1',
    });
    const errorFrame = c1.local.find((f) => f.includes('event: error'));
    const dataLine = errorFrame
      .split('\n')
      .find((line) => line.startsWith('data:'));
    const payload = JSON.parse(dataLine.slice('data:'.length).trim());
    assert.deepEqual(Object.keys(payload).sort(), ['message', 'project']);
    assert.equal(payload.project, 'sample');
    assert.equal(payload.message.includes(':\\'), false);
    assert.equal(payload.message.includes('/Users/'), false);
    c1.close();

    const c2 = await collect();
    await waitFor(() => c2.local.some((f) => f.includes('event: error')), {
      timeoutMs: 3000,
      label: 'replay to c2',
    });
    assert.match(c2.local.join('\n'), /diag/);

    const beforeCss = c2.local.length;
    live.broadcastCssReload();
    await waitFor(() => c2.local.length >= beforeCss + 2, {
      timeoutMs: 3000,
      label: 'clear-error and css',
    });
    const added = c2.local.slice(beforeCss);
    assert.match(added[0], /event: clear-error/);
    assert.match(added[1], /event: css/);
    assert.equal(live.lastErrorMessage, null);

    c2.close();
    live.broadcastError('again');
    const c3 = await collect();
    await waitFor(() => c3.local.some((f) => f.includes('event: error')), {
      timeoutMs: 3000,
      label: 'error again',
    });
    const beforeReload = c3.local.length;
    live.broadcastReload();
    await waitFor(() => c3.local.length > beforeReload, {
      timeoutMs: 3000,
      label: 'reload after clear',
    });
    assert.equal(live.lastErrorMessage, null);
    assert.match(c3.local[c3.local.length - 1], /event: reload/);
    c3.close();

    const c4 = await collect();
    await sleep(200);
    assert.equal(
      c4.local.filter((f) => f.includes('event: error')).length,
      0
    );
    c4.close();

    live.close();
    assert.equal(live.clientCount, 0);
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });
});
