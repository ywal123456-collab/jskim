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

/**
 * @param {string} src
 * @param {string} dest
 * @param {{ skipDirNames?: Set<string> }} [options]
 */
function copyDirSync(src, dest, options = {}) {
  const skip = options.skipDirNames || new Set();
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skip.has(entry.name) || entry.name.startsWith('.resources.tmp')) {
        continue;
      }
      copyDirSync(path.join(src, entry.name), path.join(dest, entry.name), options);
      continue;
    }
    if (entry.isFile()) {
      fs.copyFileSync(path.join(src, entry.name), path.join(dest, entry.name));
    }
  }
}

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
    assert.ok(
      files.some((f) =>
        f.includes('package/src/editing/exclude-description-item.ts')
      ),
      'Viewer が参照する exclude-description-item を同梱すること'
    );
    assert.equal(
      files.some((f) => f.includes('package/src/editing/validate-description')),
      false,
      'editing 全体を不用意に同梱しない'
    );
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

  it('packed companion + engine だけで jskim spec build sample が成功する', () => {
    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-pack-build-'));
    tempDirs.push(workRoot);
    const packDir = path.join(workRoot, 'packs');
    const consumer = path.join(workRoot, 'consumer');
    fs.mkdirSync(packDir);
    fs.mkdirSync(consumer);

    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const companionPack = spawnSync(
      npm,
      ['pack', '--json', '--pack-destination', packDir],
      {
        cwd: path.join(REPO_ROOT, 'jskim-screen-spec'),
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 120000,
      }
    );
    assert.equal(companionPack.status, 0, companionPack.stderr || companionPack.stdout);
    const companionInfo = JSON.parse(companionPack.stdout.trim());
    const companionMeta = Array.isArray(companionInfo)
      ? companionInfo[0]
      : companionInfo;

    const enginePack = spawnSync(
      npm,
      ['pack', '--json', '--pack-destination', packDir],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 60000,
      }
    );
    assert.equal(enginePack.status, 0, enginePack.stderr || enginePack.stdout);
    const engineInfo = JSON.parse(enginePack.stdout.trim());
    const engineMeta = Array.isArray(engineInfo) ? engineInfo[0] : engineInfo;

    const companionTgz = path.join(packDir, companionMeta.filename);
    const engineTgz = path.join(packDir, engineMeta.filename);
    assert.ok(fs.existsSync(companionTgz));
    assert.ok(fs.existsSync(engineTgz));

    // repository source を偶然 resolve しないよう、consumer は TEMP のみ
    fs.writeFileSync(
      path.join(consumer, 'package.json'),
      JSON.stringify(
        {
          name: 'jskim-pack-boundary-consumer',
          private: true,
          devDependencies: {
            '@ywal123456/jskim': `file:${engineTgz.replace(/\\/g, '/')}`,
            '@ywal123456/jskim-screen-spec': `file:${companionTgz.replace(/\\/g, '/')}`,
          },
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
    fs.copyFileSync(
      path.join(REPO_ROOT, 'jskim.config.js'),
      path.join(consumer, 'jskim.config.js')
    );
    copyDirSync(
      path.join(REPO_ROOT, 'src', 'sample'),
      path.join(consumer, 'src', 'sample')
    );
    copyDirSync(
      path.join(REPO_ROOT, 'spec', 'sample'),
      path.join(consumer, 'spec', 'sample'),
      { skipDirNames: new Set(['dist']) }
    );

    const install = spawnSync(npm, ['install'], {
      cwd: consumer,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      timeout: 180000,
    });
    assert.equal(install.status, 0, install.stderr || install.stdout);

    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const specBuild = spawnSync(npx, ['jskim', 'spec', 'build', 'sample'], {
      cwd: consumer,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      timeout: 180000,
      env: {
        ...process.env,
        // repository の local companion を優先しない
        NODE_PATH: '',
      },
    });
    assert.equal(
      specBuild.status,
      0,
      `packed consumer spec build failed:\n${specBuild.stderr}\n${specBuild.stdout}`
    );
    assert.ok(
      fs.existsSync(path.join(consumer, 'spec', 'sample', 'dist', 'index.html')),
      'Viewer dist/index.html が生成されること'
    );
    const viewerAssets = fs.readdirSync(
      path.join(consumer, 'spec', 'sample', 'dist'),
      { withFileTypes: true }
    );
    assert.ok(
      viewerAssets.some((e) => e.isFile() && /\.(js|css)$/.test(e.name)) ||
        fs.existsSync(path.join(consumer, 'spec', 'sample', 'dist', 'assets')),
      'Viewer production asset が出力されること'
    );
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
