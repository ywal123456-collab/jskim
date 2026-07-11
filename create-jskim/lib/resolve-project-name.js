'use strict';

const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const { normalizePackageName } = require('./normalize-package-name');

const DEFAULT_DIRECTORY_NAME = 'jskim-project';

/**
 * CLI 引数または対話入力からプロジェクトディレクトリ名を解決します。
 * @param {object} options
 * @param {string|undefined} options.directoryArg
 * @param {boolean} [options.allowPrompt=true]
 * @returns {Promise<{ directoryInput: string, isCurrentDirectory: boolean }>}
 */
async function resolveProjectDirectory(options = {}) {
  const allowPrompt = options.allowPrompt !== false;
  let directoryInput = options.directoryArg;

  if (directoryInput == null || String(directoryInput).trim() === '') {
    if (!allowPrompt) {
      throw new Error(
        '[create-jskim] プロジェクトディレクトリを指定してください。\n' +
          '使用方法: create-jskim [project-directory]'
      );
    }

    const rl = readline.createInterface({ input, output });
    try {
      const answer = await rl.question('プロジェクト名: ');
      directoryInput =
        answer == null || String(answer).trim() === ''
          ? DEFAULT_DIRECTORY_NAME
          : String(answer).trim();
    } finally {
      rl.close();
    }
  } else {
    directoryInput = String(directoryInput).trim();
  }

  const isCurrentDirectory =
    directoryInput === '.' || directoryInput === './';

  return {
    directoryInput,
    isCurrentDirectory,
  };
}

/**
 * process.cwd() 基準で絶対パスと package name 用 basename を求めます。
 * @param {string} directoryInput
 * @param {string} [cwd]
 * @returns {{ targetDir: string, basename: string, isCurrentDirectory: boolean }}
 */
function resolveTargetPaths(directoryInput, cwd = process.cwd()) {
  const targetDir = path.resolve(cwd, directoryInput);
  const isCurrentDirectory =
    path.resolve(cwd) === targetDir ||
    directoryInput === '.' ||
    directoryInput === './';
  const basename = path.basename(targetDir);

  return {
    targetDir,
    basename,
    isCurrentDirectory,
  };
}

/**
 * basename から package.json.name を作ります。
 * @param {string} basename
 * @returns {string}
 */
function resolvePackageNameFromBasename(basename) {
  return normalizePackageName(basename);
}

module.exports = {
  DEFAULT_DIRECTORY_NAME,
  resolveProjectDirectory,
  resolveTargetPaths,
  resolvePackageNameFromBasename,
};
