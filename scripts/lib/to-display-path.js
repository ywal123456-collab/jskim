'use strict';

const path = require('node:path');

/**
 * ワークスペース相対の表示用パスへ変換します。
 * @param {string} abs
 * @param {string} workspaceRoot
 * @returns {string}
 */
function toDisplayPath(abs, workspaceRoot) {
  if (!abs) {
    return '';
  }
  const resolved = path.resolve(abs);
  if (!workspaceRoot) {
    return resolved.split(path.sep).join('/');
  }
  const rel = path.relative(workspaceRoot, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return resolved.split(path.sep).join('/');
  }
  return rel.split(path.sep).join('/');
}

module.exports = {
  toDisplayPath,
};
