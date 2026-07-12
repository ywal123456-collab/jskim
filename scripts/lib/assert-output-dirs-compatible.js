'use strict';

const path = require('node:path');

/**
 * --all 用に、resolve済みprojectのoutputDir衝突を検査します。
 *
 * @param {Array<{ name: string, outputDir: string }>} projects
 */
function assertCompatibleOutputDirs(projects) {
  const items = Array.isArray(projects) ? projects : [];

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      const relation = classifyOutputDirRelation(a.outputDir, b.outputDir);
      if (!relation) {
        continue;
      }

      const label =
        relation === 'same'
          ? '同じoutputDir'
          : '入れ子（祖先/子孫）のoutputDir';

      throw new Error(
        `[JSKim] --all でbuildできません: project間のoutputDirが衝突しています。\n` +
          `理由: ${label} のため、clean付きbuildで他projectの成果物を消す恐れがあります。\n\n` +
          `project: ${a.name}\n` +
          `outputDir: ${toPosix(a.outputDir)}\n\n` +
          `project: ${b.name}\n` +
          `outputDir: ${toPosix(b.outputDir)}\n\n` +
          `各projectのoutputDirを重複・入れ子にならないよう変更してください。`
      );
    }
  }
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {'same'|'nested'|null}
 */
function classifyOutputDirRelation(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  if (samePath(a, b)) {
    return 'same';
  }
  if (isStrictAncestor(a, b) || isStrictAncestor(b, a)) {
    return 'nested';
  }
  return null;
}

function samePath(a, b) {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  if (process.platform === 'win32') {
    return na.toLowerCase() === nb.toLowerCase();
  }
  return na === nb;
}

function isStrictAncestor(ancestor, descendant) {
  let a = path.resolve(ancestor);
  let d = path.resolve(descendant);
  if (process.platform === 'win32') {
    a = a.toLowerCase();
    d = d.toLowerCase();
  }
  if (samePath(a, d)) {
    return false;
  }
  const rel = path.relative(a, d);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function toPosix(abs) {
  return path.resolve(abs).split(path.sep).join('/');
}

module.exports = {
  assertCompatibleOutputDirs,
  classifyOutputDirRelation,
  samePath,
};
