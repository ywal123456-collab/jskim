'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function collectDepNames(pkg) {
  return new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ]);
}

describe('スクリーン仕様 companion package', () => {
  it('jskim-screen-spec パッケージが存在し name / version / publish 設定が正しい', () => {
    const pkgPath = path.join(REPO_ROOT, 'jskim-screen-spec', 'package.json');
    assert.ok(fs.existsSync(pkgPath), 'jskim-screen-spec/package.json が必要です');
    const pkg = readJson(pkgPath);
    assert.equal(pkg.name, '@ywal123456/jskim-screen-spec');
    assert.equal(pkg.version, '0.2.0');
    assert.equal(Object.hasOwn(pkg, 'private'), false);
    assert.equal(pkg.publishConfig && pkg.publishConfig.access, 'public');
    assert.equal(pkg.peerDependencies['@ywal123456/jskim'], '^0.7.0');
    assert.ok(Array.isArray(pkg.files));
    assert.ok(pkg.files.includes('dist'));
    assert.ok(pkg.files.includes('src/viewer'));
    assert.ok(pkg.files.includes('vite.config.ts'));
    assert.ok(pkg.files.includes('index.html'));
    assert.ok(pkg.scripts && pkg.scripts.prepack);
  });

  it('companion exports / main は dist を指す', () => {
    const pkg = readJson(
      path.join(REPO_ROOT, 'jskim-screen-spec', 'package.json')
    );
    assert.equal(pkg.main, './dist/index.js');
    assert.equal(pkg.exports['.'].import, './dist/index.js');
    assert.equal(pkg.exports['.'].default, './dist/index.js');
    assert.equal(pkg.exports['.'].types, './dist/index.d.ts');
  });

  it('root package.json に vue / vite / playwright 依存がない', () => {
    const pkg = readJson(path.join(REPO_ROOT, 'package.json'));
    const names = collectDepNames(pkg);
    assert.equal(names.has('vue'), false);
    assert.equal(names.has('vite'), false);
    assert.equal(names.has('@vitejs/plugin-vue'), false);
    assert.equal(names.has('vue-router'), false);
    assert.equal(names.has('@vue/test-utils'), false);
    assert.equal(names.has('vitest'), false);
    assert.equal(names.has('jsdom'), false);
    // PDF 用の playwright-core は許可。フル playwright は companion 側のみ。
    assert.equal(names.has('playwright'), false);
    assert.equal(names.has('playwright-core'), true);
  });

  it('create-jskim package.json に vue / vite / playwright 依存がない', () => {
    const pkg = readJson(path.join(REPO_ROOT, 'create-jskim', 'package.json'));
    const names = collectDepNames(pkg);
    assert.equal(names.has('vue'), false);
    assert.equal(names.has('vite'), false);
    assert.equal(names.has('@vitejs/plugin-vue'), false);
    assert.equal(names.has('vue-router'), false);
    assert.equal(names.has('playwright'), false);
    assert.equal(names.has('playwright-core'), false);
  });

  it('root files 配列に jskim-screen-spec や spec/*/dist を含めない', () => {
    const pkg = readJson(path.join(REPO_ROOT, 'package.json'));
    const files = pkg.files || [];
    assert.ok(Array.isArray(files));
    for (const entry of files) {
      assert.equal(
        entry.includes('jskim-screen-spec'),
        false,
        `files に jskim-screen-spec を含めない: ${entry}`,
      );
      assert.equal(
        /spec[/\\].*dist/.test(entry) || entry.includes('spec/*/dist'),
        false,
        `files に spec/*/dist を含めない: ${entry}`,
      );
    }
  });

  it('root files の scripts/ に integration 実装が含まれる想定である', () => {
    const pkg = readJson(path.join(REPO_ROOT, 'package.json'));
    const files = pkg.files || [];
    assert.ok(
      files.some((entry) => entry === 'scripts/' || entry === 'scripts'),
      'scripts/ が package files に含まれるべき'
    );
    assert.ok(
      fs.existsSync(
        path.join(REPO_ROOT, 'scripts/lib/resolve-screen-spec-module.js')
      )
    );
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, 'scripts/lib/create-spec-mount.js'))
    );
    assert.ok(
      fs.existsSync(
        path.join(REPO_ROOT, 'scripts/commands/spec-build-command.js')
      )
    );
  });
});
