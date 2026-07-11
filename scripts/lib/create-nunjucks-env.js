'use strict';

const path = require('node:path');
const fs = require('node:fs');
const nunjucks = require('nunjucks');

/**
 * プロジェクト用の Nunjucks 環境を作成します。
 * loader ルート: sourceDir + templates[]（重複除去）。
 *
 * @param {object} options
 * @param {string} options.sourceDir
 * @param {string[]} options.templates
 * @returns {nunjucks.Environment}
 */
function createNunjucksEnv({ sourceDir, templates }) {
  const roots = [];
  const seen = new Set();

  function addRoot(absPath) {
    const normalized = path.resolve(absPath);
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
      return;
    }
    seen.add(key);
    roots.push(normalized);
  }

  addRoot(sourceDir);

  const templateDirs = Array.isArray(templates) ? templates : [];
  for (const rel of templateDirs) {
    addRoot(path.resolve(sourceDir, rel));
  }

  if (roots.length === 0) {
    throw new Error(
      `[JSKim] 有効な Nunjucks loader パスがありません。\n` +
        `sourceDir: ${sourceDir}`
    );
  }

  const loader = new nunjucks.FileSystemLoader(roots, {
    noCache: true,
  });

  const env = new nunjucks.Environment(loader, {
    autoescape: true,
    noCache: true,
  });

  return env;
}

module.exports = {
  createNunjucksEnv,
};
