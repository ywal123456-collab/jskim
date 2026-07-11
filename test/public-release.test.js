'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('./helpers/create-test-workspace');

const ALLOWED_EMAILS = new Set(['ywal123456@gmail.com']);
const ALLOWED_HOST_SNIPPETS = [
  'github.com/ywal123456-collab/jskim',
  'registry.npmjs.org',
  '127.0.0.1',
  'localhost',
];

const SCAN_ROOTS = [
  'bin',
  'scripts',
  'src',
  'README.md',
  'docs',
  'package.json',
  'create-jskim',
  'test',
  'AGENTS.md',
  '.cursor',
];

const DANGEROUS_NAMES = new Set([
  '.env',
  '.npmrc',
  'id_rsa',
  'credentials.json',
  'secrets.json',
]);

const DANGEROUS_EXTS = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.crt',
  '.cer',
]);

describe('public release audit', () => {
  it('危険な秘密ファイル名がソースに無い', () => {
    const hits = [];
    walk(REPO_ROOT, (rel, abs, isFile) => {
      if (!isFile) {
        return;
      }
      const base = path.basename(abs);
      const ext = path.extname(abs).toLowerCase();
      if (
        DANGEROUS_NAMES.has(base) ||
        DANGEROUS_EXTS.has(ext) ||
        /^\.env\./.test(base)
      ) {
        hits.push(rel);
      }
    });
    assert.deepEqual(hits, [], `危険ファイル名: ${hits.join(', ')}`);
  });

  it('許可されていないユーザー絶対パスがソースに無い', () => {
    const hits = [];
    const pattern = /(?:C:[\\/]Users[\\/]|\/Users\/|\/home\/)[^\s"'`]+/g;
    scanTextFiles((rel, text) => {
      const matches = text.match(pattern);
      if (matches) {
        for (const m of matches) {
          hits.push(`${rel}: ${mask(m)}`);
        }
      }
    });
    assert.deepEqual(hits, [], `絶対パス候補: ${hits.join(', ')}`);
  });

  it('許可されていないメールアドレスがソースに無い', () => {
    const hits = [];
    const pattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
    scanTextFiles((rel, text) => {
      const matches = text.match(pattern) || [];
      for (const email of matches) {
        if (!ALLOWED_EMAILS.has(email.toLowerCase())) {
          hits.push(`${rel}: ${mask(email)}`);
        }
      }
    });
    assert.deepEqual(hits, [], `非許可メール: ${hits.join(', ')}`);
  });

  it('公開 repository metadata と一致する', () => {
    const engine = require(path.join(REPO_ROOT, 'package.json'));
    const creator = require(path.join(REPO_ROOT, 'create-jskim/package.json'));
    assert.equal(engine.name, '@ywal123456/jskim');
    assert.equal(Object.hasOwn(engine, 'private'), false);
    assert.equal(engine.publishConfig && engine.publishConfig.access, 'public');
    assert.equal(
      engine.publishConfig && engine.publishConfig.registry,
      'https://registry.npmjs.org'
    );
    assert.equal(creator.name, 'create-jskim');
    assert.equal(creator.jskimEngine.packageName, '@ywal123456/jskim');
    assert.equal(creator.jskimEngine.version, '^0.1.0');
    assert.match(engine.repository.url, /ywal123456-collab\/jskim\.git$/);
    assert.match(engine.homepage, /ywal123456-collab\/jskim/);
    assert.match(engine.bugs.url, /ywal123456-collab\/jskim\/issues$/);
    assert.equal(creator.repository.directory, 'create-jskim');
    for (const snippet of ALLOWED_HOST_SNIPPETS.slice(0, 1)) {
      assert.ok(engine.homepage.includes(snippet));
    }
  });

  it('template に LICENSE を強制していない', () => {
    const templateLicense = path.join(
      REPO_ROOT,
      'create-jskim/template/LICENSE'
    );
    assert.equal(fs.existsSync(templateLicense), false);
  });

  it('ユーザー向け文書に unscoped engine インストール命令が残っていない', () => {
    const docs = [
      'README.md',
      'docs/publishing.md',
      'docs/create-jskim.md',
      'create-jskim/README.md',
    ];
    const forbidden = [
      'npm install --save-dev jskim',
      'npm install jskim@0.1.0',
      'npm view jskim@0.1.0',
      'node_modules/jskim',
    ];
    const hits = [];
    for (const rel of docs) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      for (const needle of forbidden) {
        if (text.includes(needle)) {
          hits.push(`${rel}: ${needle}`);
        }
      }
    }
    assert.deepEqual(hits, [], `旧 unscoped 命令: ${hits.join(', ')}`);
  });
});

function scanTextFiles(visit) {
  for (const root of SCAN_ROOTS) {
    walk(path.join(REPO_ROOT, root), (rel, abs, isFile) => {
      if (!isFile) {
        return;
      }
      if (
        !/\.(js|json|md|mdc|njk|css|txt)$/i.test(abs) &&
        path.basename(abs) !== 'gitignore' &&
        path.basename(abs) !== 'LICENSE'
      ) {
        return;
      }
      visit(rel, fs.readFileSync(abs, 'utf8'));
    });
  }
}

function walk(abs, visit, baseRoot = REPO_ROOT) {
  if (!fs.existsSync(abs)) {
    return;
  }
  const rel = path.relative(baseRoot, abs).split(path.sep).join('/');
  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    visit(rel, abs, true);
    return;
  }
  if (!stat.isDirectory()) {
    return;
  }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === '.git'
    ) {
      continue;
    }
    walk(path.join(abs, entry.name), visit, baseRoot);
  }
}

function mask(value) {
  const text = String(value);
  if (text.length <= 8) {
    return '***';
  }
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}
