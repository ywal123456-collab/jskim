'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  printNextSteps,
  formatCdTarget,
  formatCdArgument,
  DEFAULT_DEV_URL,
} = require('../create-jskim/lib/print-next-steps');
const {
  DEFAULT_DEV_HOST,
  DEFAULT_DEV_PORT,
} = require('../create-jskim/lib/default-dev-url');
const { REPO_ROOT } = require('./helpers/create-test-workspace');

describe('print-next-steps', () => {
  function capture(options) {
    const lines = [];
    printNextSteps({
      ...options,
      logger: {
        log(...args) {
          lines.push(args.join(' '));
        },
      },
    });
    return lines.join('\n');
  }

  it('npm 案内に npm コマンドだけを出し URL を表示する', () => {
    const out = capture({
      projectLabel: 'sample-project',
      targetDir: 'C:/tmp/sample-project',
      isCurrentDirectory: false,
      cdTarget: 'sample-project',
      packageManager: 'npm',
    });
    assert.match(out, /JSKimプロジェクトを作成しました/);
    assert.match(out, /プロジェクト: sample-project/);
    assert.match(out, /作成先: C:\/tmp\/sample-project/);
    assert.match(out, /次のコマンドを実行してください/);
    assert.deepEqual(commandLines(out), [
      'cd sample-project',
      'npm install',
      'npm run dev',
    ]);
    assert.match(out, /開発サーバー:/);
    assert.match(out, new RegExp(DEFAULT_DEV_URL.replace(/\./g, '\\.')));
  });

  it('pnpm / yarn / unknown のコマンドを切り替える', () => {
    const pnpm = capture({
      projectLabel: 'p',
      targetDir: '/tmp/p',
      isCurrentDirectory: false,
      cdTarget: 'p',
      packageManager: 'pnpm',
    });
    const pnpmLines = commandLines(pnpm);
    assert.deepEqual(pnpmLines, ['cd p', 'pnpm install', 'pnpm dev']);

    const yarn = capture({
      projectLabel: 'y',
      targetDir: '/tmp/y',
      isCurrentDirectory: false,
      cdTarget: 'y',
      packageManager: 'yarn',
    });
    assert.deepEqual(commandLines(yarn), [
      'cd y',
      'yarn install',
      'yarn dev',
    ]);

    const unknown = capture({
      projectLabel: 'u',
      targetDir: '/tmp/u',
      isCurrentDirectory: false,
      cdTarget: 'u',
      packageManager: 'unknown',
    });
    assert.deepEqual(commandLines(unknown), [
      'cd u',
      'npm install',
      'npm run dev',
    ]);
  });

  it('カレントディレクトリでは cd を省略する', () => {
    const out = capture({
      projectLabel: 'work',
      targetDir: '/tmp/work',
      isCurrentDirectory: true,
      packageManager: 'npm',
    });
    assert.doesNotMatch(out, /^ {2}cd /m);
    assert.match(out, /npm install/);
  });

  it('whitespace がある cd path は double quote する', () => {
    assert.equal(formatCdArgument('My Project'), '"My Project"');
    assert.equal(formatCdArgument('apps/My Project'), '"apps/My Project"');
    assert.equal(formatCdArgument('apps/sample'), 'apps/sample');

    const out = capture({
      projectLabel: 'my-project',
      targetDir: '/tmp/My Project',
      isCurrentDirectory: false,
      cdTarget: 'My Project',
      packageManager: 'npm',
    });
    assert.match(out, /cd "My Project"/);
  });

  it('formatCdTarget は nested 相対パスを維持する', () => {
    const cwd = path.resolve('/work');
    const target = path.resolve('/work/apps/sample');
    assert.equal(formatCdTarget('apps/sample', target, cwd), 'apps/sample');
    assert.equal(formatCdTarget('.', cwd, cwd), '.');
  });

  it('DEFAULT_DEV_URL は template serve.host / serve.port と一致する', () => {
    const templateConfig = require(
      path.join(REPO_ROOT, 'create-jskim/template/jskim.config.js')
    );
    const serve = templateConfig.defaults.serve;
    assert.equal(serve.host, DEFAULT_DEV_HOST);
    assert.equal(serve.port, DEFAULT_DEV_PORT);
    assert.equal(
      DEFAULT_DEV_URL,
      `http://${serve.host}:${serve.port}/`
    );
  });
});

/**
 * 完了案内のインデント付きコマンド行だけを取り出す。
 * @param {string} text
 * @returns {string[]}
 */
function commandLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => /^ {2}\S/.test(line))
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.startsWith('cd ') ||
        line.endsWith(' install') ||
        line.endsWith(' dev') ||
        line === 'npm run dev' ||
        line === 'pnpm dev' ||
        line === 'yarn dev'
    );
}
