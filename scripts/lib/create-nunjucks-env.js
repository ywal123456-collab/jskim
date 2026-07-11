'use strict';

const path = require('node:path');
const fs = require('node:fs');
const nunjucks = require('nunjucks');

/**
 * プロジェクト用の Nunjucks 環境を作成します。
 * loader ルート: sourceDir + templates[]（重複除去）。
 * filters / globals を登録します。
 *
 * @param {object} options
 * @param {string} options.sourceDir
 * @param {string[]} options.templates
 * @param {object} [options.nunjucks]
 * @returns {nunjucks.Environment}
 */
function createNunjucksEnv({ sourceDir, templates, nunjucks: nunjucksConfig }) {
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

  // HTML 互換のため autoescape は維持する。
  // JSON/JS 出力が必要な filter は SafeString を返すこと。
  const env = new nunjucks.Environment(loader, {
    autoescape: true,
    noCache: true,
  });

  const config =
    nunjucksConfig && typeof nunjucksConfig === 'object' ? nunjucksConfig : {};
  registerFilters(env, config.filters || {});
  registerGlobals(env, config.globals || {});

  return env;
}

function registerFilters(env, filters) {
  for (const [name, fn] of Object.entries(filters)) {
    env.addFilter(name, wrapSyncCallable(fn, `filter:${name}`));
  }
}

function registerGlobals(env, globals) {
  for (const [name, value] of Object.entries(globals)) {
    if (typeof value === 'function') {
      env.addGlobal(name, wrapSyncCallable(value, `global:${name}`));
    } else {
      env.addGlobal(name, value);
    }
  }
}

function wrapSyncCallable(fn, label) {
  return function wrapped(...args) {
    const result = fn.apply(this, args);
    if (result && typeof result.then === 'function') {
      throw new Error(
        `[JSKim] 非同期${label.startsWith('filter') ? 'filter' : 'global'}は現在サポートされていません。\n` +
          `対象: ${label}`
      );
    }
    return result;
  };
}

module.exports = {
  createNunjucksEnv,
};
