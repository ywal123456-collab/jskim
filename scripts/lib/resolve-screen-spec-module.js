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
    '  または npx jskim spec version init <project>',
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
 * @param {boolean} [options.requireVersion]
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
    const wrapped = new Error(
      `[JSKim] ${COMPANION_PACKAGE_NAME} の読み込みに失敗しました。`
    );
    wrapped.cause = err;
    wrapped.code = 'JSKIM_SCREEN_SPEC_LOAD_FAILED';
    throw wrapped;
  }

  if (typeof mod.buildScreenSpecViewer !== 'function') {
    throw new Error(
      `[JSKim] ${COMPANION_PACKAGE_NAME} に buildScreenSpecViewer がありません。`
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

  if (options.requireDeviceCapture) {
    if (typeof mod.collectDeviceCapture !== 'function') {
      throw new Error(
        `[JSKim] ${COMPANION_PACKAGE_NAME} に collectDeviceCapture がありません。\n` +
          `entry: ${entryPath}\n` +
          'companion を最新の dist に rebuild してください。'
      );
    }
    if (typeof mod.getDeviceCapturePublicInfo !== 'function') {
      throw new Error(
        `[JSKim] ${COMPANION_PACKAGE_NAME} に getDeviceCapturePublicInfo がありません。\n` +
          `entry: ${entryPath}\n` +
          'companion を最新の dist に rebuild してください。'
      );
    }
  }

  if (options.requireReferenceImage) {
    if (typeof mod.putReferenceImage !== 'function') {
      throw new Error(
        `[JSKim] ${COMPANION_PACKAGE_NAME} に putReferenceImage がありません。\n` +
          `entry: ${entryPath}\n` +
          'companion を最新の dist に rebuild してください。'
      );
    }
    if (typeof mod.deleteReferenceImage !== 'function') {
      throw new Error(
        `[JSKim] ${COMPANION_PACKAGE_NAME} に deleteReferenceImage がありません。\n` +
          `entry: ${entryPath}\n` +
          'companion を最新の dist に rebuild してください。'
      );
    }
    if (typeof mod.getReferenceImagePublicInfo !== 'function') {
      throw new Error(
        `[JSKim] ${COMPANION_PACKAGE_NAME} に getReferenceImagePublicInfo がありません。\n` +
          `entry: ${entryPath}\n` +
          'companion を最新の dist に rebuild してください。'
      );
    }
    if (typeof mod.importFigmaReferenceImage !== 'function') {
      throw new Error(
        `[JSKim] ${COMPANION_PACKAGE_NAME} に importFigmaReferenceImage がありません。\n` +
          `entry: ${entryPath}\n` +
          'companion を最新の dist に rebuild してください。'
      );
    }
    if (typeof mod.reimportFigmaReferenceImage !== 'function') {
      throw new Error(
        `[JSKim] ${COMPANION_PACKAGE_NAME} に reimportFigmaReferenceImage がありません。\n` +
          `entry: ${entryPath}\n` +
          'companion を最新の dist に rebuild してください。'
      );
    }
  }

  if (options.requireVersion) {
    assertVersionApis(mod);
  }

  return {
    buildScreenSpecViewer: mod.buildScreenSpecViewer,
    buildScreenSpecViewerAtomic: mod.buildScreenSpecViewerAtomic,
    collectScreenSpecProject: mod.collectScreenSpecProject,
    classifyScreenSpecWatchPath: mod.classifyScreenSpecWatchPath,
    mergeScreenSpecWatchKinds: mod.mergeScreenSpecWatchKinds,
    createFileDescriptionStore: mod.createFileDescriptionStore,
    loadScreenSpecProject: mod.loadScreenSpecProject,
    withDescriptionScreenLock: mod.withDescriptionScreenLock,
    bindDescriptionScreenLock: mod.bindDescriptionScreenLock,
    collectDeviceCapture: mod.collectDeviceCapture,
    getDeviceCapturePublicInfo: mod.getDeviceCapturePublicInfo,
    getDeviceCaptureStatus: mod.getDeviceCaptureStatus,
    putReferenceImage: mod.putReferenceImage,
    deleteReferenceImage: mod.deleteReferenceImage,
    getReferenceImagePublicInfo: mod.getReferenceImagePublicInfo,
    getReferenceImageStatus: mod.getReferenceImageStatus,
    importFigmaReferenceImage: mod.importFigmaReferenceImage,
    reimportFigmaReferenceImage: mod.reimportFigmaReferenceImage,
    initVersionRepository: mod.initVersionRepository,
    persistVersionAuthorConfig: mod.persistVersionAuthorConfig,
    getVersionStatus: mod.getVersionStatus,
    stageProject: mod.stageProject,
    stageScreen: mod.stageScreen,
    stageFeature: mod.stageFeature,
    commitVersion: mod.commitVersion,
    getVersionLog: mod.getVersionLog,
    listVersionBranches: mod.listVersionBranches,
    createVersionBranch: mod.createVersionBranch,
    deleteVersionBranch: mod.deleteVersionBranch,
    listVersionTags: mod.listVersionTags,
    createVersionTag: mod.createVersionTag,
    checkoutVersion: mod.checkoutVersion,
    revertVersionCommit: mod.revertVersionCommit,
    mergeVersion: mod.mergeVersion,
    inspectMergeVersion: mod.inspectMergeVersion,
    continueMergeVersion: mod.continueMergeVersion,
    abortMergeVersion: mod.abortMergeVersion,
    fsckVersionRepository: mod.fsckVersionRepository,
    inspectVersionRecovery: mod.inspectVersionRecovery,
    recoverVersionRepository: mod.recoverVersionRepository,
    getBrowserVersionStatus: mod.getBrowserVersionStatus,
    listBrowserVersionRevisions: mod.listBrowserVersionRevisions,
    getBrowserVersionRevisionDetail: mod.getBrowserVersionRevisionDetail,
    getBrowserVersionRevisionDiff: mod.getBrowserVersionRevisionDiff,
    listBrowserVersionFeatures: mod.listBrowserVersionFeatures,
    listBrowserVersionBranches: mod.listBrowserVersionBranches,
    listBrowserVersionTags: mod.listBrowserVersionTags,
    getScreenFeatureWorkingState: mod.getScreenFeatureWorkingState,
    createScreenFeature: mod.createScreenFeature,
    updateScreenFeature: mod.updateScreenFeature,
    deleteScreenFeature: mod.deleteScreenFeature,
    reorderScreenFeatures: mod.reorderScreenFeatures,
    moveScreenToFeature: mod.moveScreenToFeature,
    reorderFeatureScreens: mod.reorderFeatureScreens,
    moveFeatureDirection: mod.moveFeatureDirection,
    moveScreenFeatureDirection: mod.moveScreenFeatureDirection,
    packageName: COMPANION_PACKAGE_NAME,
    entryPath,
  };
}

const VERSION_API_NAMES = [
  'initVersionRepository',
  'persistVersionAuthorConfig',
  'getVersionStatus',
  'stageProject',
  'stageScreen',
  'stageFeature',
  'commitVersion',
  'getVersionLog',
  'listVersionBranches',
  'createVersionBranch',
  'deleteVersionBranch',
  'listVersionTags',
  'createVersionTag',
  'checkoutVersion',
  'revertVersionCommit',
  'mergeVersion',
  'inspectMergeVersion',
  'continueMergeVersion',
  'abortMergeVersion',
  'fsckVersionRepository',
  'inspectVersionRecovery',
  'recoverVersionRepository',
  'getBrowserVersionStatus',
  'listBrowserVersionRevisions',
  'getBrowserVersionRevisionDetail',
  'getBrowserVersionRevisionDiff',
  'listBrowserVersionFeatures',
  'listBrowserVersionBranches',
  'listBrowserVersionTags',
];

/**
 * @param {object} mod
 */
function assertVersionApis(mod) {
  const missing = VERSION_API_NAMES.filter(
    (name) => typeof mod[name] !== 'function'
  );
  if (missing.length > 0) {
    const err = new Error(
      `[JSKim] ${COMPANION_PACKAGE_NAME} が必要です。\n` +
        'インストールされている companion は版管理APIに対応していません。\n' +
        'companion を最新版へ更新し、必要なら rebuild してください。'
    );
    err.code = 'JSKIM_SCREEN_SPEC_VERSION_UNSUPPORTED';
    throw err;
  }
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
