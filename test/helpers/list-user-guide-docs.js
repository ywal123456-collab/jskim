'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('./create-test-workspace');

const USER_GUIDE_DIR = path.join(REPO_ROOT, 'docs/user-guide');

/**
 * docs/user-guide 配下の Markdown を再帰収集し、リポジトリ相対 POSIX パスで返す。
 * @param {string} [dirAbs]
 * @param {string} [relPrefix]
 * @returns {string[]}
 */
function collectUserGuideMarkdownFiles(
  dirAbs = USER_GUIDE_DIR,
  relPrefix = 'docs/user-guide'
) {
  if (!fs.existsSync(dirAbs)) {
    return [];
  }

  /** @type {string[]} */
  const files = [];
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    const childAbs = path.join(dirAbs, entry.name);
    const childRel = `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...collectUserGuideMarkdownFiles(childAbs, childRel));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(childRel.split(path.sep).join('/'));
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

module.exports = {
  USER_GUIDE_DIR,
  collectUserGuideMarkdownFiles,
};
