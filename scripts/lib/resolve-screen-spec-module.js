'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');

const COMPANION_PACKAGE_NAME = '@ywal123456/jskim-screen-spec';

/**
 * companion 未インストール時の日本語メッセージ。
 * @returns {string}
 */
function getMissingScreenSpecModuleMessage() {
  return [
    '[JSKim] 画面設計書機能を使用するには',
    `${COMPANION_PACKAGE_NAME} を install してください。`,
    '',
    '現在、この module は開発中です（private prototype）。',
    '公開 npm registry からはまだインストールできません。',
    '',
    '開発リポジトリでは companion を build したうえで、',
    'ローカル package としてプロジェクトへ追加してください。',
  ].join('\n');
}

/**
 * optional companion module を解決します。
 *
 * 優先順位:
 * 1. options.modulePath（test / 明示指定）
 * 2. projectRoot からの Node require.resolve(COMPANION_PACKAGE_NAME)
 *
 * sibling ディレクトリ hardcode は行いません。
 *
 * @param {object} options
 * @param {string} options.projectRoot
 * @param {string} [options.modulePath] 明示 entry（絶対または相対パス）
 * @returns {Promise<{
 *   buildScreenSpecViewer: Function,
 *   packageName: string,
 *   entryPath: string
 * }>}
 */
async function resolveScreenSpecModule(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  let entryPath;

  if (options.modulePath) {
    entryPath = path.resolve(projectRoot, options.modulePath);
  } else {
    entryPath = resolveInstalledEntry(projectRoot);
  }

  let mod;
  try {
    mod = await import(pathToFileURL(entryPath).href);
  } catch (err) {
    // 解決済み entry の読込失敗は「未インストール」にしない
    const message = err && err.message ? err.message : String(err);
    const wrapped = new Error(
      `[JSKim] ${COMPANION_PACKAGE_NAME} の読み込みに失敗しました。\n` +
        `entry: ${entryPath}\n` +
        `原因: ${message}`
    );
    wrapped.cause = err;
    wrapped.code = 'JSKIM_SCREEN_SPEC_LOAD_FAILED';
    throw wrapped;
  }

  if (typeof mod.buildScreenSpecViewer !== 'function') {
    throw new Error(
      `[JSKim] ${COMPANION_PACKAGE_NAME} に buildScreenSpecViewer がありません。\n` +
        `entry: ${entryPath}`
    );
  }

  return {
    buildScreenSpecViewer: mod.buildScreenSpecViewer,
    packageName: COMPANION_PACKAGE_NAME,
    entryPath,
  };
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function resolveInstalledEntry(projectRoot) {
  const requireFromProject = createRequire(
    path.join(projectRoot, 'package.json')
  );
  try {
    return requireFromProject.resolve(COMPANION_PACKAGE_NAME);
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') {
      const missing = new Error(getMissingScreenSpecModuleMessage());
      missing.code = 'JSKIM_SCREEN_SPEC_NOT_FOUND';
      throw missing;
    }
    throw err;
  }
}

module.exports = {
  resolveScreenSpecModule,
  getMissingScreenSpecModuleMessage,
  COMPANION_PACKAGE_NAME,
};
