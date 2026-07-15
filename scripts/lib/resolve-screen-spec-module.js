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
    '例:',
    `  npm install --save-dev ${COMPANION_PACKAGE_NAME}`,
    '  npx playwright install chromium',
    '',
    'その後:',
    '  npx jskim spec collect <project>',
    '  npx jskim spec build <project>',
    '  または npx jskim spec dev <project>',
  ].join('\n');
}

/**
 * jskim spec dev 用の未インストールメッセージ。
 * @returns {string}
 */
function getMissingScreenSpecDevMessage() {
  return [
    '[JSKim] 画面設計書の開発機能を使用するには',
    `${COMPANION_PACKAGE_NAME} が必要です。`,
    '',
    '例:',
    `  npm install --save-dev ${COMPANION_PACKAGE_NAME}`,
    '  npx playwright install chromium',
    '',
    'その後:',
    '  npx jskim spec dev <project>',
  ].join('\n');
}

/**
 * optional companion module を解決します。
 *
 * @param {object} options
 * @param {string} options.projectRoot
 * @param {string} [options.modulePath]
 * @param {boolean} [options.requireCollect]
 * @param {boolean} [options.requireWatchHelpers]
 * @returns {Promise<object>}
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

  if (
    options.requireCollect &&
    typeof mod.collectScreenSpecProject !== 'function'
  ) {
    throw new Error(
      `[JSKim] ${COMPANION_PACKAGE_NAME} に collectScreenSpecProject がありません。\n` +
        `entry: ${entryPath}\n` +
        'companion を最新の dist に rebuild してください。'
    );
  }

  if (options.requireWatchHelpers) {
    if (typeof mod.classifyScreenSpecWatchPath !== 'function') {
      throw new Error(
        `[JSKim] ${COMPANION_PACKAGE_NAME} に classifyScreenSpecWatchPath がありません。\n` +
          `entry: ${entryPath}\n` +
          'companion を最新の dist に rebuild してください。'
      );
    }
    if (typeof mod.mergeScreenSpecWatchKinds !== 'function') {
      throw new Error(
        `[JSKim] ${COMPANION_PACKAGE_NAME} に mergeScreenSpecWatchKinds がありません。\n` +
          `entry: ${entryPath}\n` +
          'companion を最新の dist に rebuild してください。'
      );
    }
  }

  if (options.requireEditing) {
    if (typeof mod.createFileDescriptionStore !== 'function') {
      throw new Error(
        `[JSKim] ${COMPANION_PACKAGE_NAME} に createFileDescriptionStore がありません。\n` +
          `entry: ${entryPath}\n` +
          'companion を最新の dist に rebuild してください。'
      );
    }
    if (typeof mod.loadScreenSpecProject !== 'function') {
      throw new Error(
        `[JSKim] ${COMPANION_PACKAGE_NAME} に loadScreenSpecProject がありません。\n` +
          `entry: ${entryPath}\n` +
          'companion を最新の dist に rebuild してください。'
      );
    }
  }

  return {
    buildScreenSpecViewer: mod.buildScreenSpecViewer,
    buildScreenSpecViewerAtomic: mod.buildScreenSpecViewerAtomic,
    collectScreenSpecProject: mod.collectScreenSpecProject,
    classifyScreenSpecWatchPath: mod.classifyScreenSpecWatchPath,
    mergeScreenSpecWatchKinds: mod.mergeScreenSpecWatchKinds,
    createFileDescriptionStore: mod.createFileDescriptionStore,
    loadScreenSpecProject: mod.loadScreenSpecProject,
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
  getMissingScreenSpecDevMessage,
  COMPANION_PACKAGE_NAME,
};
