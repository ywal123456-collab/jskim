'use strict';

const path = require('node:path');

/**
 * ワークスペース相対の表示用パスへ変換します。
 * @param {string} abs
 * @param {string} workspaceRoot
 * @returns {string}
 */
function toDisplayPath(abs, workspaceRoot) {
  const rel = path.relative(workspaceRoot, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return abs.split(path.sep).join('/');
  }
  return rel.split(path.sep).join('/');
}

module.exports = {
  toDisplayPath,
};
