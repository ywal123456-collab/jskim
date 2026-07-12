'use strict';

const path = require('node:path');
const { getPackageManagerCommands } = require('./detect-package-manager');
const { DEFAULT_DEV_URL } = require('./default-dev-url');

/**
 * 作成完了後の次の手順を表示します。
 * @param {object} options
 * @param {string} options.projectLabel 表示用プロジェクト名
 * @param {string} options.targetDir 絶対パス
 * @param {boolean} options.isCurrentDirectory
 * @param {string} [options.cdTarget] cd に使う相対/入力名
 * @param {string} [options.packageManager] detectPackageManager の結果
 * @param {{ log?: Function }} [options.logger] 既定は console.log
 */
function printNextSteps(options) {
  const {
    projectLabel,
    targetDir,
    isCurrentDirectory,
    cdTarget,
    packageManager,
  } = options;
  const log =
    options.logger && typeof options.logger.log === 'function'
      ? options.logger.log.bind(options.logger)
      : console.log.bind(console);

  const commands = getPackageManagerCommands(packageManager);

  log('JSKimプロジェクトを作成しました。');
  log('');
  log(`プロジェクト: ${projectLabel}`);
  log(`作成先: ${targetDir}`);
  log('');
  log('次のコマンドを実行してください。');
  log('');

  if (!isCurrentDirectory) {
    const cdName = formatCdArgument(cdTarget || projectLabel);
    log(`  cd ${cdName}`);
  }
  log(`  ${commands.install}`);
  log(`  ${commands.dev}`);
  log('');
  log('開発サーバー:');
  log(`  ${DEFAULT_DEV_URL}`);
}

/**
 * cd 表示用のパスを決めます（不要な絶対パスを避けます）。
 * @param {string} directoryInput
 * @param {string} targetDir
 * @param {string} cwd
 * @returns {string}
 */
function formatCdTarget(directoryInput, targetDir, cwd) {
  if (directoryInput === '.' || directoryInput === './') {
    return '.';
  }
  const rel = path.relative(cwd, targetDir);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel.split(path.sep).join('/');
  }
  return directoryInput;
}

/**
 * 人がコピーする cd 引数を整形します。
 * whitespace がある場合のみ double quote で囲みます。
 * @param {string} cdPath
 * @returns {string}
 */
function formatCdArgument(cdPath) {
  const text = String(cdPath == null ? '' : cdPath);
  if (/\s/.test(text)) {
    return `"${text}"`;
  }
  return text;
}

module.exports = {
  printNextSteps,
  formatCdTarget,
  formatCdArgument,
  DEFAULT_DEV_URL,
};
