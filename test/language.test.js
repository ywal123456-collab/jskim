'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('./helpers/create-test-workspace');

const KOREAN = /[가-힣]/;
const TARGETS = [
  'bin',
  'scripts',
  'jskim.config.js',
  'README.md',
  'AGENTS.md',
  'docs',
  '.cursor',
  'src/sample',
  'create-jskim',
  'test/cli.test.js',
  'test/package.test.js',
  'test/create-jskim.test.js',
  'test/create-package.test.js',
  'test/package-metadata.test.js',
  'test/public-release.test.js',
];

function collectFiles(rootPath, files = []) {
  const abs = path.join(REPO_ROOT, rootPath);
  if (!fs.existsSync(abs)) {
    return files;
  }

  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    files.push(abs);
    return files;
  }

  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const child = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      collectFiles(child, files);
    } else if (/\.(js|md|mdc|njk|css)$/i.test(entry.name)) {
      files.push(path.join(REPO_ROOT, child));
    }
  }
  return files;
}

describe('language', () => {
  it('人が読むソースに韓国語が残っていない', () => {
    const files = TARGETS.flatMap((target) => collectFiles(target));
    const offenders = [];

    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      if (KOREAN.test(text)) {
        offenders.push(path.relative(REPO_ROOT, file).split(path.sep).join('/'));
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `韓国語が残っています: ${offenders.join(', ')}`
    );
  });
});
