'use strict';

const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  createTestWorkspace,
  REPO_ROOT,
} = require('./helpers/create-test-workspace');
const { runCli } = require('./helpers/run-cli');
const {
  runSpecBuildCommand,
} = require('../scripts/commands/spec-build-command');
const {
  getMissingScreenSpecModuleMessage,
} = require('../scripts/lib/resolve-screen-spec-module');

const BIN = path.join(REPO_ROOT, 'bin/jskim.js');
const COMPANION_DIST = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js'
);

describe('spec build CLI', () => {
  const workspaces = [];

  before(() => {
    if (!fs.existsSync(COMPANION_DIST)) {
      const result = spawnSync('npm', ['run', 'build'], {
        cwd: path.join(REPO_ROOT, 'jskim-screen-spec'),
        encoding: 'utf8',
        shell: true,
      });
      assert.equal(
        result.status,
        0,
        `companion build が必要です:\n${result.stdout}\n${result.stderr}`
      );
    }
  });

  after(async () => {
    for (const ws of workspaces) {
      // eslint-disable-next-line no-await-in-loop
      await ws.cleanup();
    }
  });

  it('companion 未インストール時 jskim spec build は日本語エラーで exit 1', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: BIN,
      cwd: ws.workspaceRoot,
      args: ['spec', 'build', 'sample'],
      timeoutMs: 20000,
    });
    const result = await cli.waitForExit();

    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /@ywal123456\/jskim-screen-spec/);
    assert.match(result.output, /install してください/);
    assert.equal(
      result.output.includes(getMissingScreenSpecModuleMessage().split('\n')[0]),
      true
    );
  });

  it('companion 未インストールでも build は成功する', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: BIN,
      cwd: ws.workspaceRoot,
      args: ['build', 'sample'],
      timeoutMs: 20000,
    });
    const result = await cli.waitForExit();
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /ビルドが完了しました/);
  });

  it('modulePath 注入で runSpecBuildCommand が sample viewer を build できる', async () => {
    assert.ok(fs.existsSync(COMPANION_DIST), 'companion dist が必要');

    const outDirBefore = path.join(REPO_ROOT, 'spec', 'sample', 'dist');
    const hadOutDir = fs.existsSync(outDirBefore);

    const result = await runSpecBuildCommand({
      workspaceRoot: REPO_ROOT,
      projectName: 'sample',
      modulePath: COMPANION_DIST,
    });

    assert.equal(result.projectName, 'sample');
    assert.ok(fs.existsSync(path.join(result.outDir, 'index.html')));
    assert.ok(fs.existsSync(path.join(result.outDir, 'data', 'manifest.json')));

    // リポジトリへ新規追跡させない前提の検証のみ（commit しない）
    if (!hadOutDir) {
      // 生成物はローカル作業ツリーに残ってよいが、テストは存在確認まで
      assert.ok(fs.existsSync(result.outDir));
    }
  });
});
