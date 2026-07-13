'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { REPO_ROOT } = require('./helpers/create-test-workspace');

const FORBIDDEN_TAR_FRAGMENTS = [
  'node_modules/',
  '.git/',
  '.env',
  '.npmrc',
  'coverage/',
  'spec/sample/dist',
  'chromium',
  'chrome-win',
  'playwright/.local-browsers',
];

describe('Screen Spec release pack boundary', () => {
  /** @type {string[]} */
  const tempDirs = [];

  after(async () => {
    for (const dir of tempDirs) {
      // eslint-disable-next-line no-await-in-loop
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('companion package.json は公開 metadata を持つ', () => {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, 'jskim-screen-spec', 'package.json'),
        'utf8'
      )
    );
    assert.equal(Object.hasOwn(pkg, 'private'), false);
    assert.equal(pkg.version, '0.1.0');
    assert.equal(pkg.publishConfig.access, 'public');
    assert.equal(pkg.peerDependencies['@ywal123456/jskim'], '^0.6.0');
    assert.ok(pkg.scripts.prepack);
    assert.ok(!pkg.dependencies || !pkg.dependencies['@ywal123456/jskim']);
  });

  it('engine / creator / companion の version 組み合わせが release 方針と一致する', () => {
    const engine = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
    );
    const creator = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'create-jskim', 'package.json'), 'utf8')
    );
    const companion = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, 'jskim-screen-spec', 'package.json'),
        'utf8'
      )
    );
    assert.equal(engine.version, '0.6.0');
    assert.equal(creator.version, '0.6.0');
    assert.equal(creator.jskimEngine.version, '^0.6.0');
    assert.equal(companion.version, '0.1.0');
    assert.equal(companion.peerDependencies['@ywal123456/jskim'], '^0.6.0');
  });

  it('npm pack（companion）に禁止 path が含まれない', () => {
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-pack-comp-'));
    tempDirs.push(packDir);

    const result = spawnSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['pack', '--json', '--pack-destination', packDir],
      {
        cwd: path.join(REPO_ROOT, 'jskim-screen-spec'),
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 120000,
      }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const parsed = JSON.parse(result.stdout.trim());
    const info = Array.isArray(parsed) ? parsed[0] : parsed;
    assert.equal(info.name, '@ywal123456/jskim-screen-spec');
    assert.equal(info.version, '0.1.0');
    assert.ok(info.filename);

    const tarPath = path.join(packDir, info.filename);
    assert.ok(fs.existsSync(tarPath));

    const list = spawnSync(
      process.platform === 'win32' ? 'tar.exe' : 'tar',
      ['-tzf', tarPath],
      { encoding: 'utf8', shell: false }
    );
    assert.equal(list.status, 0, list.stderr);
    const files = list.stdout.split(/\r?\n/).filter(Boolean);

    assert.ok(files.some((f) => f.includes('package/dist/index.js')));
    assert.ok(files.some((f) => f.includes('package/src/viewer/')));
    assert.ok(files.some((f) => f.includes('package/vite.config.ts')));
    assert.equal(
      files.some((f) => f.includes('package/vitest.config.ts')),
      false,
      'vitest.config.ts は tarball に含めない'
    );
    assert.ok(files.some((f) => f.includes('package/index.html')));
    assert.ok(files.some((f) => f.includes('package/LICENSE')));

    for (const file of files) {
      const normalized = file.replace(/\\/g, '/').toLowerCase();
      for (const frag of FORBIDDEN_TAR_FRAGMENTS) {
        assert.equal(
          normalized.includes(frag.toLowerCase()),
          false,
          `禁止 path: ${file} (${frag})`
        );
      }
      assert.equal(
        /[a-z]:\/users\//i.test(normalized) || normalized.includes('/users/jeongsubi/'),
        false,
        `local absolute path らしきエントリ: ${file}`
      );
    }
  });

  it('npm pack（engine）に Screen Spec CLI があり companion 本体は含まない', () => {
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-pack-eng-'));
    tempDirs.push(packDir);

    const result = spawnSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['pack', '--json', '--pack-destination', packDir],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 60000,
      }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout.trim());
    const info = Array.isArray(parsed) ? parsed[0] : parsed;
    assert.equal(info.name, '@ywal123456/jskim');
    assert.equal(info.version, '0.6.0');

    const tarPath = path.join(packDir, info.filename);
    const list = spawnSync(
      process.platform === 'win32' ? 'tar.exe' : 'tar',
      ['-tzf', tarPath],
      { encoding: 'utf8' }
    );
    assert.equal(list.status, 0, list.stderr);
    const files = list.stdout.split(/\r?\n/).filter(Boolean);
    const joined = files.join('\n');

    assert.match(joined, /package\/bin\/jskim\.js/);
    assert.match(joined, /package\/scripts\/commands\/spec-dev-command\.js/);
    assert.match(joined, /package\/scripts\/lib\/resolve-screen-spec-module\.js/);
    assert.equal(joined.includes('jskim-screen-spec/'), false);
    assert.equal(joined.includes('node_modules/'), false);
  });

  it('npm pack（creator）template に Screen Spec sample があり companion dep は無い', () => {
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-pack-cre-'));
    tempDirs.push(packDir);

    const result = spawnSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['pack', '--json', '--pack-destination', packDir],
      {
        cwd: path.join(REPO_ROOT, 'create-jskim'),
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 60000,
      }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout.trim());
    const info = Array.isArray(parsed) ? parsed[0] : parsed;
    assert.equal(info.name, 'create-jskim');
    assert.equal(info.version, '0.6.0');

    const tarPath = path.join(packDir, info.filename);
    const list = spawnSync(
      process.platform === 'win32' ? 'tar.exe' : 'tar',
      ['-tzf', tarPath],
      { encoding: 'utf8' }
    );
    assert.equal(list.status, 0, list.stderr);
    const files = list.stdout.split(/\r?\n/).filter(Boolean);
    const joined = files.join('\n');

    assert.match(joined, /template\/src\/sample\/pages\/crud\/create\.spec\.json/);
    assert.match(joined, /template\/spec\/sample\/src\/data\//);
    assert.match(joined, /template\/spec\/sample\/src\/resources\//);
    assert.match(joined, /template\/spec\/sample\/src\/theme\//);
    assert.equal(joined.includes('node_modules/'), false);
  });
});
