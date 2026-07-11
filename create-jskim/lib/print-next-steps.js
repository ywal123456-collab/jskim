'use strict';

const path = require('node:path');

/**
 * 作成完了後の次の手順を表示します。
 * @param {object} options
 * @param {string} options.projectLabel 表示用プロジェクト名
 * @param {string} options.targetDir 絶対パス
 * @param {boolean} options.isCurrentDirectory
 * @param {string} [options.cdTarget] cd に使う相対/入力名
 */
function printNextSteps(options) {
  const {
    projectLabel,
    targetDir,
    isCurrentDirectory,
    cdTarget,
  } = options;

  console.log('JSKimプロジェクトを作成しました。');
  console.log('プロジェクト:');
  console.log(`  ${projectLabel}`);
  console.log('作成先:');
  console.log(`  ${targetDir}`);
  console.log('次の手順:');

  if (isCurrentDirectory) {
    console.log('  npm install');
    console.log('  npm run dev');
  } else {
    const cdName = cdTarget || projectLabel;
    console.log(`  cd ${cdName}`);
    console.log('  npm install');
    console.log('  npm run dev');
  }
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

module.exports = {
  printNextSteps,
  formatCdTarget,
};
