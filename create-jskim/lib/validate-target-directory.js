'use strict';

const fs = require('node:fs');

/**
 * 対象ディレクトリが作成可能か検証します。
 * - 未存在 → 作成予定として許可
 * - 存在かつ空 → 許可
 * - 存在かつ非空 → エラー（隠しファイルも非空扱い）
 *
 * @param {string} targetDir
 * @returns {{ exists: boolean, isEmpty: boolean }}
 */
function validateTargetDirectory(targetDir) {
  if (!fs.existsSync(targetDir)) {
    return { exists: false, isEmpty: true };
  }

  const stat = fs.statSync(targetDir);
  if (!stat.isDirectory()) {
    throw new Error(
      '[create-jskim] 対象パスはディレクトリではありません。\n' +
        `対象: ${targetDir}`
    );
  }

  const entries = fs.readdirSync(targetDir);
  if (entries.length > 0) {
    throw new Error(
      '[create-jskim] ディレクトリが空ではありません。\n' +
        `対象: ${targetDir}\n` +
        '空のディレクトリを指定してください。'
    );
  }

  return { exists: true, isEmpty: true };
}

module.exports = {
  validateTargetDirectory,
};
