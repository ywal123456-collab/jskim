'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function resolveNpmCli() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(
      path.dirname(process.execPath),
      '..',
      'lib',
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js'
    ),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('[JSKim test] npm-cli.js が見つかりません。');
}

const NPM_CLI = resolveNpmCli();

/**
 * npm CLI を引数配列で実行します（shell 文字列結合はしません）。
 * @param {string} cwd
 * @param {string[]} args
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runNpm(cwd, args, options = {}) {
  return execFileAsync(process.execPath, [NPM_CLI, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', ...(options.env || {}) },
  });
}

/**
 * npm exec を spawn します。
 * @param {string} cwd
 * @param {string[]} args npm exec 以降の引数（例: ['create-jskim', '--', 'my-project']）
 * @param {object} [options]
 */
function spawnNpmExec(cwd, args, options = {}) {
  return spawn(process.execPath, [NPM_CLI, 'exec', '--', ...args], {
    cwd,
    env: { ...process.env, FORCE_COLOR: '0', ...(options.env || {}) },
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
}

module.exports = {
  NPM_CLI,
  runNpm,
  spawnNpmExec,
  resolveNpmCli,
};
