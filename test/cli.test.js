'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  createTestWorkspace,
  REPO_ROOT,
} = require('./helpers/create-test-workspace');
const { runCli } = require('./helpers/run-cli');

const BIN = path.join(REPO_ROOT, 'bin/jskim.js');
const PKG = require(path.join(REPO_ROOT, 'package.json'));

describe('cli binary', () => {
  const workspaces = [];

  after(async () => {
    for (const ws of workspaces) {
      // eslint-disable-next-line no-await-in-loop
      await ws.cleanup();
    }
  });

  it('--help で日本語ヘルプを表示して exit 0', async () => {
    const cli = runCli({
      scriptPath: BIN,
      cwd: REPO_ROOT,
      args: ['--help'],
    });
    const result = await cli.waitForExit();

    assert.equal(result.code, 0);
    assert.match(result.output, /使用方法:/);
    assert.match(result.output, /build \[<project>\]/);
    assert.match(result.output, /build --all/);
    assert.match(result.output, /watch \[<project>\]/);
    assert.match(result.output, /serve \[<project>\]/);
    assert.match(result.output, /dev \[<project>\]/);
    assert.match(result.output, /projectを省略できるのは/);
  });

  it('-h でもヘルプを表示する', async () => {
    const cli = runCli({
      scriptPath: BIN,
      cwd: REPO_ROOT,
      args: ['-h'],
    });
    const result = await cli.waitForExit();
    assert.equal(result.code, 0);
    assert.match(result.output, /コマンド:/);
  });

  it('--version で package.json の version を表示する', async () => {
    const cli = runCli({
      scriptPath: BIN,
      cwd: REPO_ROOT,
      args: ['--version'],
    });
    const result = await cli.waitForExit();

    assert.equal(result.code, 0);
    assert.equal(result.output.trim(), PKG.version);
  });

  it('-v でも version を表示する', async () => {
    const cli = runCli({
      scriptPath: BIN,
      cwd: REPO_ROOT,
      args: ['-v'],
    });
    const result = await cli.waitForExit();
    assert.equal(result.code, 0);
    assert.equal(result.output.trim(), PKG.version);
  });

  it('コマンド無しではヘルプを表示して exit 0', async () => {
    const cli = runCli({
      scriptPath: BIN,
      cwd: REPO_ROOT,
      args: [],
    });
    const result = await cli.waitForExit();

    assert.equal(result.code, 0);
    assert.match(result.output, /使用方法:/);
    assert.match(result.output, /build \[<project>\]/);
  });

  it('不明なコマンドは日本語エラーで exit 1', async () => {
    const cli = runCli({
      scriptPath: BIN,
      cwd: REPO_ROOT,
      args: ['unknown'],
    });
    const result = await cli.waitForExit();

    assert.equal(result.code, 1);
    assert.match(result.output, /不明なコマンドです: unknown/);
    assert.match(result.output, /使用できるコマンド:/);
  });

  it('projectが1件のとき build は名前省略で成功する', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: BIN,
      cwd: ws.workspaceRoot,
      args: ['build'],
      timeoutMs: 20000,
    });
    const result = await cli.waitForExit();

    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /ビルドが完了しました/);
  });

  it('projectが2件以上のとき build は名前省略でエラーになる', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        projects: {
          sample: {
            sourceDir: 'src/sample',
            outputDir: 'dist/sample',
          },
          docs: {
            sourceDir: 'src/sample',
            outputDir: 'dist/docs',
          },
        },
      },
    });
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: BIN,
      cwd: ws.workspaceRoot,
      args: ['build'],
    });
    const result = await cli.waitForExit();

    assert.equal(result.code, 1);
    assert.match(result.output, /projectを指定してください/);
    assert.match(result.output, /- sample/);
    assert.match(result.output, /- docs/);
  });

  it('一時ワークスペースで build sample が成功する', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);

    const repoDistBefore = fs.existsSync(path.join(REPO_ROOT, 'dist/sample'));

    const cli = runCli({
      scriptPath: BIN,
      cwd: ws.workspaceRoot,
      args: ['build', 'sample'],
      timeoutMs: 20000,
    });
    const result = await cli.waitForExit();

    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /ビルドが完了しました/);

    const indexHtml = path.join(ws.workspaceRoot, 'dist/sample/index.html');
    const css = path.join(ws.workspaceRoot, 'dist/sample/assets/css/style.css');
    assert.ok(fs.existsSync(indexHtml), 'workspace の dist が生成されるべき');
    assert.ok(fs.existsSync(css), 'workspace の assets がコピーされるべき');

    const html = await fsp.readFile(indexHtml, 'utf8');
    assert.match(html, /JSKim Fixture/);
    assert.match(html, /INDEX_OK/);

    // リポジトリ側の dist を使っていないこと（未存在なら生成されていない）
    if (!repoDistBefore) {
      assert.equal(
        fs.existsSync(path.join(REPO_ROOT, 'dist/sample/index.html')),
        false
      );
    }
  });
});
