'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  resolveScreenSpecModule,
  getMissingScreenSpecModuleMessage,
  COMPANION_PACKAGE_NAME,
} = require('../scripts/lib/resolve-screen-spec-module');

const REPO_ROOT = path.resolve(__dirname, '..');
const COMPANION_DIST = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js'
);

describe('resolve-screen-spec-module', () => {
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
    assert.ok(fs.existsSync(COMPANION_DIST), 'companion dist/index.js が必要');
  });

  it('module 未インストール時は JSKIM_SCREEN_SPEC_NOT_FOUND と日本語メッセージ', async () => {
    const tempRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-no-spec-')
    );
    try {
      await assert.rejects(
        () => resolveScreenSpecModule({ projectRoot: tempRoot }),
        (err) => {
          assert.equal(err.code, 'JSKIM_SCREEN_SPEC_NOT_FOUND');
          assert.equal(err.message, getMissingScreenSpecModuleMessage());
          assert.match(err.message, new RegExp(COMPANION_PACKAGE_NAME));
          assert.match(err.message, /install してください/);
          return true;
        }
      );
    } finally {
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('modulePath で companion dist を読み込める', async () => {
    const mod = await resolveScreenSpecModule({
      projectRoot: REPO_ROOT,
      modulePath: COMPANION_DIST,
    });
    assert.equal(typeof mod.buildScreenSpecViewer, 'function');
    assert.equal(mod.packageName, COMPANION_PACKAGE_NAME);
    assert.equal(path.normalize(mod.entryPath), path.normalize(COMPANION_DIST));
  });

  it('package 名解決（node_modules 経由）で companion を読み込める', async () => {
    const tempRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-linked-spec-')
    );
    try {
      await fsp.writeFile(
        path.join(tempRoot, 'package.json'),
        JSON.stringify({ name: 'temp-jskim-project', private: true }, null, 2),
        'utf8'
      );
      const scopedDir = path.join(tempRoot, 'node_modules', '@ywal123456');
      await fsp.mkdir(scopedDir, { recursive: true });
      const linkPath = path.join(scopedDir, 'jskim-screen-spec');
      const target = path.join(REPO_ROOT, 'jskim-screen-spec');
      await fsp.symlink(target, linkPath, 'junction');

      const mod = await resolveScreenSpecModule({ projectRoot: tempRoot });
      assert.equal(typeof mod.buildScreenSpecViewer, 'function');
      assert.equal(mod.packageName, COMPANION_PACKAGE_NAME);
      assert.match(mod.entryPath.replace(/\\/g, '/'), /jskim-screen-spec/);
    } finally {
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('壊れた modulePath は LOAD_FAILED であり NOT_FOUND ではない', async () => {
    const tempRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-broken-spec-')
    );
    try {
      const brokenEntry = path.join(tempRoot, 'broken-entry.js');
      await fsp.writeFile(
        brokenEntry,
        [
          "import { createRequire } from 'node:module';",
          "const require = createRequire(import.meta.url);",
          "require('definitely-missing-jskim-dep-xyz');",
        ].join('\n'),
        'utf8'
      );

      await assert.rejects(
        () =>
          resolveScreenSpecModule({
            projectRoot: tempRoot,
            modulePath: brokenEntry,
          }),
        (err) => {
          assert.equal(err.code, 'JSKIM_SCREEN_SPEC_LOAD_FAILED');
          assert.notEqual(err.code, 'JSKIM_SCREEN_SPEC_NOT_FOUND');
          assert.match(err.message, /読み込みに失敗しました/);
          return true;
        }
      );
    } finally {
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
