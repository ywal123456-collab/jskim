'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const fse = require('fs-extra');
const { buildProject } = require('../scripts/lib/build-project');
const {
  formatRenderError,
  readNunjucksLocation,
} = require('../scripts/lib/format-diagnostic');
const { createTestWorkspace } = require('./helpers/create-test-workspace');
const { runCli } = require('./helpers/run-cli');
const { waitFor, waitForOutput, sleep } = require('./helpers/wait-for-output');
const { getFreePort } = require('./helpers/get-free-port');
const { openSse } = require('./helpers/http-request');

describe('diagnostics', () => {
  const workspaces = [];
  const children = [];

  after(async () => {
    for (const child of children) {
      // eslint-disable-next-line no-await-in-loop
      await child.forceKill().catch(() => {});
    }
    for (const ws of workspaces) {
      if (typeof ws === 'string') {
        // eslint-disable-next-line no-await-in-loop
        await fse.remove(ws).catch(() => {});
      } else if (ws && typeof ws.cleanup === 'function') {
        // eslint-disable-next-line no-await-in-loop
        await ws.cleanup();
      }
    }
  });

  it('テンプレート構文エラーにソースと Nunjucks 原因を含める', async () => {
    const workspaceRoot = await createMinimalFilesWorkspace({
      'index.html.njk': '{% if %}\n',
    });
    workspaces.push(workspaceRoot);

    await assert.rejects(
      () => buildProject('sample', { workspaceRoot, log: false }),
      (err) => {
        const message = String(err && err.message);
        assert.match(message, /プロジェクト "sample"/);
        assert.match(message, /ソース: src\/site\/pages\/index\.html\.njk/);
        assert.match(message, /テンプレート: pages\/index\.html\.njk/);
        assert.match(message, /原因:/);
        assert.match(message, /Line 1,\s*Column/);
        return true;
      }
    );
  });

  it('lineno / colno がある場合だけ行と列を別表示する', () => {
    const workspaceRoot = path.resolve('diag-root');
    const withLocation = formatRenderError({
      projectName: 'sample',
      sourceFile: path.join(workspaceRoot, 'src', 'pages', 'a.html.njk'),
      templatePath: 'pages/a.html.njk',
      workspaceRoot,
      err: Object.assign(new Error('boom'), { lineno: 12, colno: 4 }),
    });
    assert.match(withLocation, /行: 12/);
    assert.match(withLocation, /列: 4/);
    assert.match(withLocation, /ソース: src\/pages\/a\.html\.njk/);

    const without = formatRenderError({
      projectName: 'sample',
      sourceFile: path.join(workspaceRoot, 'src', 'pages', 'a.html.njk'),
      templatePath: 'pages/a.html.njk',
      workspaceRoot,
      err: new Error('no location'),
    });
    assert.equal(/行:/.test(without), false);
    assert.equal(/列:/.test(without), false);
    assert.deepEqual(readNunjucksLocation(new Error('x')), {});
  });

  it('extends 先欠落エラーに参照テンプレート名を残す', async () => {
    const workspaceRoot = await createMinimalFilesWorkspace({
      'index.html.njk': '{% extends "layouts/missing.njk" %}\n',
    });
    workspaces.push(workspaceRoot);

    await assert.rejects(
      () => buildProject('sample', { workspaceRoot, log: false }),
      (err) => {
        const message = String(err && err.message);
        assert.match(message, /プロジェクト "sample"/);
        assert.match(message, /ソース: src\/site\/pages\/index\.html\.njk/);
        assert.match(message, /layouts\/missing\.njk/);
        assert.match(message, /template not found|テンプレート/);
        return true;
      }
    );
  });

  it('出力衝突に output と複数ソースと files ルールを含める', async () => {
    const workspaceRoot = await createMinimalFilesWorkspace({
      'assets/js/main.js': 'plain\n',
      'assets/js/main.js.njk': 'templated\n',
    });
    workspaces.push(workspaceRoot);

    await assert.rejects(
      () => buildProject('sample', { workspaceRoot, log: false }),
      (err) => {
        const message = String(err && err.message);
        assert.match(message, /出力パスが衝突しています/);
        assert.match(message, /プロジェクト: sample/);
        assert.match(message, /出力: dist\/sample\/assets\/js\/main\.js/);
        assert.match(message, /ソース1:.*main\.js/);
        assert.match(message, /ソース2:.*main\.js\.njk/);
        assert.match(message, /files\[0\]/);
        return true;
      }
    );
  });

  it('path traversal エラーに sourceDir 外であることと対象パスを含める', async () => {
    const workspaceRoot = await createMinimalFilesWorkspace(
      { 'index.html.njk': '<p>ok</p>\n' },
      {
        filesSource: `[{ from: '../outside', to: '' }]`,
      }
    );
    workspaces.push(workspaceRoot);
    await fse.outputFile(path.join(workspaceRoot, 'src/outside/x.txt'), 'x\n');

    await assert.rejects(
      () => buildProject('sample', { workspaceRoot, log: false }),
      (err) => {
        const message = String(err && err.message);
        assert.match(message, /プロジェクト "sample"/);
        assert.match(message, /許可範囲外/);
        assert.match(message, /sourceDir の外への参照/);
        assert.match(message, /files\[0\]\.from/);
        return true;
      }
    );
  });

  it('config validation にプロジェクトと設定キーを含める', async () => {
    const workspaceRoot = await createMinimalFilesWorkspace(
      { 'index.html.njk': '<p>{{ samplePrice | formatPrice }}</p>\n' },
      {
        filterSource: 'formatPrice: "not-a-function",',
      }
    );
    workspaces.push(workspaceRoot);

    await assert.rejects(
      () => buildProject('sample', { workspaceRoot, log: false }),
      (err) => {
        const message = String(err && err.message);
        assert.match(message, /設定値が不正です: nunjucks\.filters\.formatPrice/);
        assert.match(message, /プロジェクト: sample/);
        assert.match(message, /設定キー:/);
        return true;
      }
    );
  });

  it('data.rootPath 予約語衝突に設定キーを含める', async () => {
    const workspaceRoot = await createMinimalFilesWorkspace(
      { 'index.html.njk': '<p>ok</p>\n' },
      {
        dataSource: `{ site: { name: 'X' }, rootPath: './' }`,
      }
    );
    workspaces.push(workspaceRoot);

    await assert.rejects(
      () => buildProject('sample', { workspaceRoot, log: false }),
      (err) => {
        const message = String(err && err.message);
        assert.match(message, /data のキーが予約語と衝突しています: rootPath/);
        assert.match(message, /プロジェクト: sample/);
        assert.match(message, /設定キー: data\.rootPath/);
        return true;
      }
    );
  });

  it('watch の再ビルド失敗後も process を維持し、修正後に復旧する', async () => {
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
    await sleep(300);

    const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');
    await fsp.writeFile(indexPath, '{% if %}\n', 'utf8');

    await waitForOutput(() => cli.output, '再ビルドに失敗しました', {
      timeoutMs: 20000,
    });
    await waitForOutput(() => cli.output, 'ウォッチャーは継続中です', {
      timeoutMs: 5000,
    });
    assert.equal(cli.child.exitCode, null);
    assert.match(cli.output, /プロジェクト: sample|プロジェクト "sample"/);
    assert.match(cli.output, /Nunjucks レンダリングに失敗しました|ソース:/);

    const before = (cli.output.match(/再ビルドが完了しました/g) || []).length;
    await fsp.writeFile(
      indexPath,
      '{% extends "layouts/base.njk" %}{% block content %}RECOVERED{% endblock %}\n',
      'utf8'
    );
    await waitFor(
      () => (cli.output.match(/再ビルドが完了しました/g) || []).length > before,
      { timeoutMs: 20000, label: 'watch recover rebuild' }
    );
    assert.match(
      fs.readFileSync(path.join(ws.workspaceRoot, 'dist/sample/index.html'), 'utf8'),
      /RECOVERED/
    );

    await cli.stop();
  });

  it('dev のビルド失敗では reload せず、修正後に復旧できる', async () => {
    const port = await getFreePort();
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 80 },
          serve: { port },
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
    await sleep(300);

    const sse = await openSse({ port });
    assert.equal(sse.status, 200);
    const reloadBefore = sse.events.length;

    const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');
    await fsp.writeFile(indexPath, '{% if %}\n', 'utf8');
    await waitForOutput(() => cli.output, '再ビルドに失敗しました', {
      timeoutMs: 20000,
    });
    await sleep(400);
    assert.equal(sse.events.length, reloadBefore);
    assert.equal(cli.child.exitCode, null);

    const before = (cli.output.match(/再ビルドが完了しました/g) || []).length;
    await fsp.writeFile(
      indexPath,
      '{% extends "layouts/base.njk" %}{% block content %}DEV_OK{% endblock %}\n',
      'utf8'
    );
    await waitFor(
      () => (cli.output.match(/再ビルドが完了しました/g) || []).length > before,
      { timeoutMs: 20000, label: 'dev recover rebuild' }
    );
    await waitFor(() => sse.events.length > reloadBefore, {
      timeoutMs: 10000,
      label: 'dev recover reload',
    });

    sse.close();
    await cli.stop();
  });
});

async function createMinimalFilesWorkspace(pages, options = {}) {
  const workspaceRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'jskim-diagnostics-')
  );
  const sourceRoot = path.join(workspaceRoot, 'src/site');

  await fse.outputFile(
    path.join(sourceRoot, 'layouts/base.njk'),
    '<html><body>{% block content %}{% endblock %}</body></html>\n'
  );

  for (const [relativePath, content] of Object.entries(pages)) {
    // eslint-disable-next-line no-await-in-loop
    await fse.outputFile(path.join(sourceRoot, 'pages', relativePath), content);
  }

  const filterSource =
    options.filterSource ||
    `formatPrice(value) {
          return String(value);
        },`;
  const dataSource =
    options.dataSource ||
    `{
        site: { name: 'Diag' },
        samplePrice: 1,
      }`;
  const filesSource = options.filesSource || `[{ from: 'pages', to: '' }]`;

  await fsp.writeFile(
    path.join(workspaceRoot, 'jskim.config.js'),
    `module.exports = {
  defaults: {
    files: ${filesSource},
    templates: ['layouts'],
    data: ${dataSource},
    nunjucks: {
      filters: {
        ${filterSource}
      },
      globals: {},
    },
    build: { clean: true },
    watch: { debounce: 80 },
    serve: { host: '127.0.0.1', port: 3000 },
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

  return workspaceRoot;
}
