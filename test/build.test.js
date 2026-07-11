'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createTestWorkspace } = require('./helpers/create-test-workspace');
const { runCli } = require('./helpers/run-cli');

describe('build', () => {
  const workspaces = [];

  after(async () => {
    for (const ws of workspaces) {
      // eslint-disable-next-line no-await-in-loop
      await ws.cleanup();
    }
  });

  it('正常にビルドして HTML と assets を生成する', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.build,
      cwd: ws.workspaceRoot,
      args: ['sample'],
      timeoutMs: 15000,
    });
    const result = await cli.waitForExit();

    assert.equal(result.code, 0, 'exit code は 0 であるべき');
    assert.match(result.output, /ビルドが完了しました/);

    const indexHtml = path.join(ws.workspaceRoot, 'dist/sample/index.html');
    const css = path.join(ws.workspaceRoot, 'dist/sample/assets/css/style.css');
    assert.ok(fs.existsSync(indexHtml), 'index.html が生成されるべき');
    assert.ok(fs.existsSync(css), 'style.css がコピーされるべき');

    const html = await fsp.readFile(indexHtml, 'utf8');
    assert.match(html, /JSKim Fixture/);
    assert.match(html, /INDEX_OK/);
    assert.match(html, /fixture footer/);
  });

  it('ネストされたページに正しい rootPath を設定する', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.build,
      cwd: ws.workspaceRoot,
      args: ['sample'],
    });
    const result = await cli.waitForExit();
    assert.equal(result.code, 0);

    const indexHtml = await fsp.readFile(
      path.join(ws.workspaceRoot, 'dist/sample/index.html'),
      'utf8'
    );
    const nestedHtml = await fsp.readFile(
      path.join(ws.workspaceRoot, 'dist/sample/guide/nested.html'),
      'utf8'
    );

    assert.match(indexHtml, /<p id="root-path">\.\/<\/p>/);
    assert.match(nestedHtml, /<p id="root-path">\.\.\/<\/p>/);
  });

  it('プロジェクト名が無い場合は日本語エラーで終了する', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.build,
      cwd: ws.workspaceRoot,
      args: [],
    });
    const result = await cli.waitForExit();

    assert.equal(result.code, 1);
    assert.match(result.output, /プロジェクト名を指定してください/);
    assert.match(result.output, /npm run build -- <project-name>/);
  });

  it('不明なプロジェクト名では利用可能な一覧を表示する', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.build,
      cwd: ws.workspaceRoot,
      args: ['unknown-project'],
    });
    const result = await cli.waitForExit();

    assert.equal(result.code, 1);
    assert.match(result.output, /不明なプロジェクトです: unknown-project/);
    assert.match(result.output, /利用可能なプロジェクト: sample/);
  });

  it('clean により削除されたソースが dist からも消える', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);

    const first = runCli({
      scriptPath: ws.scripts.build,
      cwd: ws.workspaceRoot,
      args: ['sample'],
    });
    assert.equal((await first.waitForExit()).code, 0);

    const nestedDist = path.join(
      ws.workspaceRoot,
      'dist/sample/guide/nested.html'
    );
    assert.ok(fs.existsSync(nestedDist));

    await fsp.unlink(
      path.join(ws.workspaceRoot, 'src/sample/pages/guide/nested.njk')
    );

    const second = runCli({
      scriptPath: ws.scripts.build,
      cwd: ws.workspaceRoot,
      args: ['sample'],
    });
    assert.equal((await second.waitForExit()).code, 0);
    assert.equal(fs.existsSync(nestedDist), false);
  });

  it('危険な outputDir の clean を拒否する', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        projects: {
          sample: {
            sourceDir: 'src/sample',
            outputDir: '.',
          },
        },
      },
    });
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.build,
      cwd: ws.workspaceRoot,
      args: ['sample'],
    });
    const result = await cli.waitForExit();

    assert.equal(result.code, 1);
    assert.match(result.output, /クリーンを拒否しました/);
    assert.ok(
      fs.existsSync(path.join(ws.workspaceRoot, 'jskim.config.js')),
      'ワークスペースの設定ファイルは残るべき'
    );
  });
});
