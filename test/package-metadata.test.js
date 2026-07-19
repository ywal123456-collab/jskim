'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('./helpers/create-test-workspace');

const ENGINE_PKG = require(path.join(REPO_ROOT, 'package.json'));
const CREATE_PKG = require(path.join(REPO_ROOT, 'create-jskim/package.json'));
const COMPANION_PKG = require(path.join(
  REPO_ROOT,
  'jskim-screen-spec/package.json'
));
const ENGINE_LOCK = require(path.join(REPO_ROOT, 'package-lock.json'));
const COMPANION_LOCK = require(path.join(
  REPO_ROOT,
  'jskim-screen-spec/package-lock.json'
));
const ENGINE_LICENSE = path.join(REPO_ROOT, 'LICENSE');
const CREATE_LICENSE = path.join(REPO_ROOT, 'create-jskim/LICENSE');

const EXPECTED = {
  authorName: 'Jeongsub Kim',
  authorEmail: 'ywal123456@gmail.com',
  repoUrl: 'git+https://github.com/ywal123456-collab/jskim.git',
  homepage: 'https://github.com/ywal123456-collab/jskim#readme',
  bugs: 'https://github.com/ywal123456-collab/jskim/issues',
  creatorHomepage:
    'https://github.com/ywal123456-collab/jskim/tree/main/create-jskim#readme',
  engineName: '@ywal123456/jskim',
};

describe('package metadata', () => {
  it('engine package は公開名 @ywal123456/jskim である', () => {
    assert.equal(ENGINE_PKG.name, EXPECTED.engineName);
    assert.equal(Object.hasOwn(ENGINE_PKG, 'private'), false);
    assert.equal(ENGINE_PKG.bin && ENGINE_PKG.bin.jskim, 'bin/jskim.js');
    assert.equal(ENGINE_PKG.version, '0.7.0');
    assert.equal(ENGINE_PKG.publishConfig && ENGINE_PKG.publishConfig.access, 'public');
    assert.equal(
      ENGINE_PKG.publishConfig && ENGINE_PKG.publishConfig.registry,
      'https://registry.npmjs.org'
    );
    assert.ok(Array.isArray(ENGINE_PKG.files));
    assert.ok(ENGINE_PKG.files.includes('bin/'));
    assert.ok(ENGINE_PKG.files.includes('scripts/'));
    assert.ok(ENGINE_PKG.files.includes('docs/'));
    assert.ok(ENGINE_PKG.files.includes('LICENSE'));
    const releasePdfName = `JSKim_User_Guide_v${ENGINE_PKG.version}.pdf`;
    const releasePdf = path.join(REPO_ROOT, 'docs', releasePdfName);
    assert.ok(
      fs.existsSync(releasePdf),
      `release PDF が必要です: docs/${releasePdfName}`
    );
    const guidePdfs = fs
      .readdirSync(path.join(REPO_ROOT, 'docs'))
      .filter((name) => /^JSKim_User_Guide_v.+\.pdf$/.test(name))
      .sort();
    assert.deepEqual(
      guidePdfs,
      [releasePdfName],
      'docs/ の User Guide PDF は現行 version の 1 件だけであるべき'
    );
    const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
    assert.match(
      readme,
      new RegExp(
        `node_modules/@ywal123456/jskim/docs/${releasePdfName.replace(
          /\./g,
          '\\.'
        )}`
      ),
      'README の PDF 経路が現行 release PDF と一致するべき'
    );
  });

  it('creator package は公開名 create-jskim である', () => {
    assert.equal(CREATE_PKG.name, 'create-jskim');
    assert.equal(CREATE_PKG.version, '0.7.0');
    assert.equal(Object.hasOwn(CREATE_PKG, 'private'), false);
    assert.equal(
      CREATE_PKG.bin && CREATE_PKG.bin['create-jskim'],
      'bin/create-jskim.js'
    );
    assert.equal(CREATE_PKG.jskimEngine.packageName, EXPECTED.engineName);
    assert.equal(CREATE_PKG.jskimEngine.version, '^0.7.0');
    assert.ok(CREATE_PKG.files.includes('LICENSE'));
  });

  it('engine の公開 metadata が正しい', () => {
    assert.equal(ENGINE_PKG.license, 'MIT');
    assert.equal(ENGINE_PKG.author.name, EXPECTED.authorName);
    assert.equal(ENGINE_PKG.author.email, EXPECTED.authorEmail);
    assert.equal(ENGINE_PKG.repository.type, 'git');
    assert.equal(ENGINE_PKG.repository.url, EXPECTED.repoUrl);
    assert.equal(ENGINE_PKG.homepage, EXPECTED.homepage);
    assert.equal(ENGINE_PKG.bugs.url, EXPECTED.bugs);
  });

  it('creator の公開 metadata が正しい', () => {
    assert.equal(CREATE_PKG.license, 'MIT');
    assert.equal(CREATE_PKG.author.name, EXPECTED.authorName);
    assert.equal(CREATE_PKG.author.email, EXPECTED.authorEmail);
    assert.equal(CREATE_PKG.repository.type, 'git');
    assert.equal(CREATE_PKG.repository.url, EXPECTED.repoUrl);
    assert.equal(CREATE_PKG.repository.directory, 'create-jskim');
    assert.equal(CREATE_PKG.homepage, EXPECTED.creatorHomepage);
    assert.equal(CREATE_PKG.bugs.url, EXPECTED.bugs);
  });

  it('LICENSE ファイルが MIT 標準文面である', () => {
    assert.ok(fs.existsSync(ENGINE_LICENSE));
    assert.ok(fs.existsSync(CREATE_LICENSE));
    const engineText = fs.readFileSync(ENGINE_LICENSE, 'utf8');
    const creatorText = fs.readFileSync(CREATE_LICENSE, 'utf8');
    assert.match(engineText, /^MIT License/);
    assert.match(engineText, /Copyright \(c\) 2026 Jeongsub Kim/);
    assert.match(engineText, /THE SOFTWARE IS PROVIDED "AS IS"/);
    assert.equal(engineText, creatorText);
  });

  it('release version 契約が package / lockfile で一致する', () => {
    assert.equal(ENGINE_PKG.version, '0.7.0');
    assert.equal(CREATE_PKG.version, ENGINE_PKG.version);
    assert.equal(
      CREATE_PKG.jskimEngine.version,
      `^${ENGINE_PKG.version}`
    );
    assert.equal(COMPANION_PKG.name, '@ywal123456/jskim-screen-spec');
    assert.equal(COMPANION_PKG.version, '0.2.0');
    assert.equal(
      COMPANION_PKG.peerDependencies[EXPECTED.engineName],
      `^${ENGINE_PKG.version}`
    );

    assert.equal(ENGINE_LOCK.version, ENGINE_PKG.version);
    assert.equal(
      ENGINE_LOCK.packages && ENGINE_LOCK.packages['']
        ? ENGINE_LOCK.packages[''].version
        : null,
      ENGINE_PKG.version
    );
    assert.equal(COMPANION_LOCK.version, COMPANION_PKG.version);
    assert.equal(
      COMPANION_LOCK.packages && COMPANION_LOCK.packages['']
        ? COMPANION_LOCK.packages[''].version
        : null,
      COMPANION_PKG.version
    );

    const depSources = [
      ENGINE_PKG.dependencies,
      ENGINE_PKG.devDependencies,
      CREATE_PKG.dependencies,
      CREATE_PKG.devDependencies,
      COMPANION_PKG.dependencies,
      COMPANION_PKG.devDependencies,
      COMPANION_PKG.peerDependencies,
    ];
    for (const deps of depSources) {
      if (!deps) continue;
      for (const [name, spec] of Object.entries(deps)) {
        assert.ok(
          !String(spec).startsWith('file:'),
          `${name} に file: dependency があります`
        );
        assert.ok(
          !/^[A-Za-z]:[\\/]/.test(String(spec)) &&
            !String(spec).startsWith('/') &&
            !String(spec).startsWith('.'),
          `${name} の dependency がローカル path です: ${spec}`
        );
      }
    }
  });

  it('一時 package 名がソースに残っていない', () => {
    // 文字列リテラルを直書きするとこのテスト自身が検出対象になるため分割する
    const forbidden = [`jskim${'-'}local`, `create-jskim${'-'}local`];
    const roots = [
      'package.json',
      'package-lock.json',
      'README.md',
      'AGENTS.md',
      'docs',
      'bin',
      'scripts',
      'create-jskim',
      'test',
      '.cursor',
    ];
    const offenders = [];

    for (const root of roots) {
      collectTextFiles(path.join(REPO_ROOT, root), (rel, text) => {
        for (const name of forbidden) {
          if (text.includes(name)) {
            offenders.push(`${rel} (${name})`);
          }
        }
      });
    }

    assert.deepEqual(
      offenders,
      [],
      `一時名が残っています: ${offenders.join(', ')}`
    );
  });
});

/**
 * @param {string} abs
 * @param {(rel: string, text: string) => void} visit
 */
function collectTextFiles(abs, visit) {
  if (!fs.existsSync(abs)) {
    return;
  }
  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    if (
      /\.(js|json|md|mdc|njk|css)$/i.test(abs) ||
      path.basename(abs) === 'gitignore' ||
      path.basename(abs) === 'LICENSE'
    ) {
      const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
      visit(rel, fs.readFileSync(abs, 'utf8'));
    }
    return;
  }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    collectTextFiles(path.join(abs, entry.name), visit);
  }
}
