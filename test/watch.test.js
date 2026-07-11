'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createTestWorkspace } = require('./helpers/create-test-workspace');
const { runCli } = require('./helpers/run-cli');
const { waitFor, waitForOutput, sleep } = require('./helpers/wait-for-output');

describe('watch', () => {
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

  it('初回ビルド後に変更を検知して再ビルドする', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.watch,
      cwd: ws.workspaceRoot,
      args: ['sample'],
      ipc: true,
      timeoutMs: 30000,
    });
    children.push(cli);

    await waitForOutput(() => cli.output, 'プロジェクトを監視しています', {
      timeoutMs: 15000,
    });
    assert.match(cli.output, /ビルドが完了しました/);

    const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');
    const distIndex = path.join(ws.workspaceRoot, 'dist/sample/index.html');
    const before = (cli.output.match(/再ビルドが完了しました/g) || []).length;

    let source = await fsp.readFile(indexPath, 'utf8');
    source = source.replace('INDEX_OK', 'INDEX_WATCHED');
    await fsp.writeFile(indexPath, source, 'utf8');

    await waitFor(
      () => (cli.output.match(/再ビルドが完了しました/g) || []).length > before,
      { timeoutMs: 15000, label: 'page rebuild' }
    );
    await waitFor(
      () => fs.readFileSync(distIndex, 'utf8').includes('INDEX_WATCHED'),
      { timeoutMs: 5000, label: 'dist reflects page change' }
    );

    const headerPath = path.join(
      ws.workspaceRoot,
      'src/sample/components/header.njk'
    );
    const beforeHeader = (cli.output.match(/再ビルドが完了しました/g) || [])
      .length;
    await fsp.writeFile(
      headerPath,
      '<header><a href="{{ rootPath }}index.html">HEADER_WATCHED</a></header>\n',
      'utf8'
    );
    await waitFor(
      () =>
        (cli.output.match(/再ビルドが完了しました/g) || []).length >
        beforeHeader,
      { timeoutMs: 15000, label: 'header rebuild' }
    );
    assert.match(fs.readFileSync(distIndex, 'utf8'), /HEADER_WATCHED/);

    const cssPath = path.join(
      ws.workspaceRoot,
      'src/sample/assets/css/style.css'
    );
    const distCss = path.join(
      ws.workspaceRoot,
      'dist/sample/assets/css/style.css'
    );
    const beforeCss = (cli.output.match(/再ビルドが完了しました/g) || [])
      .length;
    await fsp.writeFile(cssPath, '/* WATCH_CSS */\nbody{}\n', 'utf8');
    await waitFor(
      () =>
        (cli.output.match(/再ビルドが完了しました/g) || []).length > beforeCss,
      { timeoutMs: 15000, label: 'css rebuild' }
    );
    assert.match(fs.readFileSync(distCss, 'utf8'), /WATCH_CSS/);

    const tempPage = path.join(
      ws.workspaceRoot,
      'src/sample/pages/temp-watch.njk'
    );
    const distTemp = path.join(
      ws.workspaceRoot,
      'dist/sample/temp-watch.html'
    );
    const beforeAdd = (cli.output.match(/再ビルドが完了しました/g) || [])
      .length;
    await fsp.writeFile(
      tempPage,
      '{% extends "layouts/base.njk" %}{% block content %}TEMP{% endblock %}\n',
      'utf8'
    );
    await waitFor(
      () =>
        (cli.output.match(/再ビルドが完了しました/g) || []).length > beforeAdd,
      { timeoutMs: 15000, label: 'add rebuild' }
    );
    assert.ok(fs.existsSync(distTemp));

    const beforeDel = (cli.output.match(/再ビルドが完了しました/g) || [])
      .length;
    await fsp.unlink(tempPage);
    await waitFor(
      () =>
        (cli.output.match(/再ビルドが完了しました/g) || []).length > beforeDel,
      { timeoutMs: 15000, label: 'delete rebuild' }
    );
    assert.equal(fs.existsSync(distTemp), false);

    const beforeDeb = (cli.output.match(/再ビルドが完了しました/g) || [])
      .length;
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fsp.writeFile(cssPath, `/* DEB_${i} */\n`, 'utf8');
      // eslint-disable-next-line no-await-in-loop
      await sleep(15);
    }
    await sleep(500);
    await waitFor(
      () =>
        (cli.output.match(/再ビルドが完了しました/g) || []).length > beforeDeb,
      { timeoutMs: 15000, label: 'debounce rebuild' }
    );
    const delta =
      (cli.output.match(/再ビルドが完了しました/g) || []).length - beforeDeb;
    assert.ok(delta <= 3, `debounce 後の再ビルドは少数であるべき: ${delta}`);

    const failBefore = (cli.output.match(/再ビルドに失敗しました/g) || [])
      .length;
    await fsp.writeFile(
      indexPath,
      '{% extends "layouts/base.njk" %}{% block content %}{% if %}{% endblock %}\n',
      'utf8'
    );
    await waitFor(
      () =>
        (cli.output.match(/再ビルドに失敗しました/g) || []).length > failBefore,
      { timeoutMs: 15000, label: 'build failure' }
    );
    assert.equal(cli.child.exitCode, null, 'エラー後もプロセスは維持されるべき');

    const recoverBefore = (cli.output.match(/再ビルドが完了しました/g) || [])
      .length;
    await fsp.writeFile(
      indexPath,
      '{% extends "layouts/base.njk" %}{% block content %}<p class="marker">RECOVERED</p>{% endblock %}\n',
      'utf8'
    );
    await waitFor(
      () =>
        (cli.output.match(/再ビルドが完了しました/g) || []).length >
        recoverBefore,
      { timeoutMs: 15000, label: 'recover rebuild' }
    );
    assert.match(fs.readFileSync(distIndex, 'utf8'), /RECOVERED/);

    const exit = await cli.stop();
    assert.match(cli.output, /ウォッチを停止しました/);
    assert.equal(exit.code, 0);
  });
});
