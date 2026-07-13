'use strict';

const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  createTestWorkspace,
  REPO_ROOT,
} = require('./helpers/create-test-workspace');
const { runCli } = require('./helpers/run-cli');
const {
  runSpecCollectCommand,
} = require('../scripts/commands/spec-collect-command');
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
const SNAPSHOT_ROOT = path.join(
  REPO_ROOT,
  'spec',
  'sample',
  'src',
  'snapshots'
);
const PILOT_SNAPSHOTS = [
  'crud-create/default.html',
  'wizard-input/default.html',
  'wizard-confirm/default.html',
  'wizard-complete/default.html',
];
const PRODUCTION_PROBE = path.join(
  REPO_ROOT,
  'dist',
  'sample',
  'crud',
  'create.html'
);

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

describe('spec collect CLI', () => {
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

  it('companion 未インストール時 jskim spec collect は日本語エラーで exit 1', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: BIN,
      cwd: ws.workspaceRoot,
      args: ['spec', 'collect', 'sample'],
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

  it(
    'modulePath 注入で runSpecCollectCommand が sample snapshot を収集できる',
    { timeout: 180000 },
    async () => {
      assert.ok(fs.existsSync(COMPANION_DIST), 'companion dist が必要');

      const productionShaBefore = fs.existsSync(PRODUCTION_PROBE)
        ? sha256File(PRODUCTION_PROBE)
        : null;

      const result = await runSpecCollectCommand({
        workspaceRoot: REPO_ROOT,
        projectName: 'sample',
        modulePath: COMPANION_DIST,
      });

      assert.equal(result.screens, 4);
      assert.equal(result.states, 4);
      assert.ok(typeof result.updated === 'number');
      assert.ok(typeof result.unchanged === 'number');

      for (const rel of PILOT_SNAPSHOTS) {
        const snapPath = path.join(SNAPSHOT_ROOT, rel);
        assert.ok(fs.existsSync(snapPath), `snapshot が必要: ${rel}`);
        const html = fs.readFileSync(snapPath, 'utf8');
        assert.match(html, /data-jskim-spec-screen=/);
      }

      if (productionShaBefore !== null) {
        assert.equal(
          sha256File(PRODUCTION_PROBE),
          productionShaBefore,
          'production dist/sample は collect 中に変更されない'
        );
      }
    }
  );
});
