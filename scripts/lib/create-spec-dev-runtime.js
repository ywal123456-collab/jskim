'use strict';

const { loadConfig } = require('./load-config');
const { selectProjectName } = require('./select-project-name');
const { resolveProject } = require('./resolve-project');
const {
  resolveScreenSpecModule,
  getMissingScreenSpecDevMessage,
} = require('./resolve-screen-spec-module');
const { runScreenSpecCollect } = require('./run-screen-spec-collect');
const { createWatchRuntime } = require('./create-watch-runtime');
const { createSpecDevOrchestrator } = require('./create-spec-dev-orchestrator');
const { createDescriptionEditApi } = require('./create-description-edit-api');
const { createDeviceCaptureApi } = require('./create-device-capture-api');
const { createReferenceImageApi } = require('./create-reference-image-api');

/**
 * jskim spec dev の実行ランタイム（CLI の process.exit は含まない）。
 *
 * @param {object} options
 * @returns {{ start: Function, close: Function, getOrchestrator: Function, getRuntime: Function }}
 */
function createSpecDevRuntime(options = {}) {
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const usageLine =
    options.usageLine ||
    'jskim spec dev [<project>] [--host <host>] [--port <port>] [--open]';

  /** @type {ReturnType<typeof createSpecDevOrchestrator>|null} */
  let orchestrator = null;
  /** @type {ReturnType<typeof createWatchRuntime>|null} */
  let runtime = null;
  let started = false;
  let closed = false;

  async function start() {
    if (started) {
      return;
    }
    started = true;

    const { config } = loadConfig(workspaceRoot);
    const projectName = selectProjectName({
      config,
      projectName: options.projectName,
      commandName: 'spec dev',
      usageLine,
    });

    const project = resolveProject({
      config,
      workspaceRoot,
      projectName,
      commandName: 'spec dev',
      usageLine,
    });

    let collectScreenSpecProject = options.collectFn;
    let buildViewer = options.buildFn;
    let classifyPath = options.classifyPath;
    let mergeKinds = options.mergeKinds;
    let createFileDescriptionStore = options.createFileDescriptionStore;
    let loadScreenSpecProject = options.loadScreenSpecProject;
    let withDescriptionScreenLock = options.withDescriptionScreenLock;
    let collectDeviceCapture = options.collectDeviceCapture;
    let getDeviceCapturePublicInfo = options.getDeviceCapturePublicInfo;
    let putReferenceImage = options.putReferenceImage;
    let deleteReferenceImage = options.deleteReferenceImage;
    let getReferenceImagePublicInfo = options.getReferenceImagePublicInfo;
    let importFigmaReferenceImage = options.importFigmaReferenceImage;
    let reimportFigmaReferenceImage = options.reimportFigmaReferenceImage;

    const needsCompanion =
      typeof collectScreenSpecProject !== 'function' ||
      typeof buildViewer !== 'function' ||
      typeof classifyPath !== 'function' ||
      typeof mergeKinds !== 'function' ||
      typeof createFileDescriptionStore !== 'function' ||
      typeof loadScreenSpecProject !== 'function';

    if (needsCompanion) {
      let companion;
      try {
        companion = await resolveScreenSpecModule({
          projectRoot: workspaceRoot,
          modulePath: options.modulePath,
          requireCollect: true,
          requireWatchHelpers: true,
          requireEditing: true,
          requireDeviceCapture: true,
          requireReferenceImage: true,
        });
      } catch (err) {
        if (err && err.code === 'JSKIM_SCREEN_SPEC_NOT_FOUND') {
          const missing = new Error(getMissingScreenSpecDevMessage());
          missing.code = err.code;
          throw missing;
        }
        throw err;
      }

      collectScreenSpecProject =
        collectScreenSpecProject || companion.collectScreenSpecProject;
      buildViewer =
        buildViewer ||
        companion.buildScreenSpecViewerAtomic ||
        companion.buildScreenSpecViewer;
      classifyPath = classifyPath || companion.classifyScreenSpecWatchPath;
      mergeKinds = mergeKinds || companion.mergeScreenSpecWatchKinds;
      createFileDescriptionStore =
        createFileDescriptionStore || companion.createFileDescriptionStore;
      loadScreenSpecProject =
        loadScreenSpecProject || companion.loadScreenSpecProject;
      withDescriptionScreenLock =
        withDescriptionScreenLock || companion.withDescriptionScreenLock;
      collectDeviceCapture =
        collectDeviceCapture || companion.collectDeviceCapture;
      getDeviceCapturePublicInfo =
        getDeviceCapturePublicInfo || companion.getDeviceCapturePublicInfo;
      putReferenceImage = putReferenceImage || companion.putReferenceImage;
      deleteReferenceImage =
        deleteReferenceImage || companion.deleteReferenceImage;
      getReferenceImagePublicInfo =
        getReferenceImagePublicInfo || companion.getReferenceImagePublicInfo;
      importFigmaReferenceImage =
        importFigmaReferenceImage || companion.importFigmaReferenceImage;
      reimportFigmaReferenceImage =
        reimportFigmaReferenceImage || companion.reimportFigmaReferenceImage;
    }

    // テスト注入で companion を読まない場合のフォールバック（Capture API は 500）
    if (typeof collectDeviceCapture !== 'function') {
      collectDeviceCapture = async () => {
        const err = new Error('Device Capture が利用できません。');
        err.code = 'SPEC_DEVICE_CAPTURE_UNAVAILABLE';
        throw err;
      };
    }
    if (typeof getDeviceCapturePublicInfo !== 'function') {
      getDeviceCapturePublicInfo = () => ({ status: 'missing' });
    }
    if (typeof putReferenceImage !== 'function') {
      putReferenceImage = async () => {
        const err = new Error('参照画像機能が利用できません。');
        err.code = 'SPEC_REFERENCE_IMAGE_UNAVAILABLE';
        throw err;
      };
    }
    if (typeof deleteReferenceImage !== 'function') {
      deleteReferenceImage = async () => {
        const err = new Error('参照画像機能が利用できません。');
        err.code = 'SPEC_REFERENCE_IMAGE_UNAVAILABLE';
        throw err;
      };
    }
    if (typeof getReferenceImagePublicInfo !== 'function') {
      getReferenceImagePublicInfo = () => ({ status: 'missing' });
    }
    if (typeof importFigmaReferenceImage !== 'function') {
      importFigmaReferenceImage = async () => {
        const err = new Error('Figma Import が利用できません。');
        err.code = 'SPEC_FIGMA_INPUT_INVALID';
        throw err;
      };
    }
    if (typeof reimportFigmaReferenceImage !== 'function') {
      reimportFigmaReferenceImage = async () => {
        const err = new Error('Figma Reimport が利用できません。');
        err.code = 'SPEC_FIGMA_INPUT_INVALID';
        throw err;
      };
    }

    if (options.skipInitialCollect !== true) {
      console.log('[JSKim] 画面設計書を収集しています。');
      const collectResult = await runScreenSpecCollect({
        project,
        workspaceRoot,
        projectName,
        collectScreenSpecProject,
        log: false,
      });
      if (collectResult && options.logInitialCollect !== false) {
        console.log(
          `[JSKim] 初期収集完了: screens=${collectResult.screens} states=${collectResult.states}`
        );
      }
    }

    if (options.skipInitialBuild !== true) {
      console.log('[JSKim] 画面設計書viewerをbuildしています。');
      await buildViewer({
        rootDir: workspaceRoot,
        projectName,
        base: '/spec/',
      });
    }

    const descriptionStore = createFileDescriptionStore({
      rootDir: workspaceRoot,
      projectName,
      listScreenIds: () => {
        const loaded = loadScreenSpecProject({
          rootDir: workspaceRoot,
          projectName,
        });
        return loaded.screens.map((s) => s.screenId);
      },
    });

    const host =
      (options.host != null && String(options.host).trim()) ||
      project.serve.host;
    const port =
      options.port != null ? Number(options.port) : Number(project.serve.port);

    const descriptionEditApi = createDescriptionEditApi({
      store: descriptionStore,
      host,
      port,
      withScreenLock:
        typeof withDescriptionScreenLock === 'function'
          ? withDescriptionScreenLock
          : undefined,
    });

    const deviceCaptureApi = createDeviceCaptureApi({
      rootDir: workspaceRoot,
      projectName,
      host,
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      collectDeviceCapture,
      getDeviceCapturePublicInfo,
      loadScreenSpecProject,
      getCollectHooks: options.getDeviceCaptureHooks,
    });

    const referenceImageApi = createReferenceImageApi({
      rootDir: workspaceRoot,
      projectName,
      host,
      port,
      putReferenceImage,
      deleteReferenceImage,
      getReferenceImagePublicInfo,
      importFigmaReferenceImage,
      reimportFigmaReferenceImage,
      loadScreenSpecProject,
      getPutHooks: options.getReferenceImagePutHooks,
      getDeleteHooks: options.getReferenceImageDeleteHooks,
      getFigmaHooks: options.getFigmaHooks,
    });

    runtime = createWatchRuntime({
      mode: 'dev',
      workspaceRoot,
      projectName,
      commandName: 'spec dev',
      usageLine,
      cliOverrides: {
        host: options.host,
        port: options.port,
        open: Boolean(options.open),
      },
      openBrowserFn: options.openBrowserFn,
      initialDevLog:
        options.initialDevLog === undefined ? 'spec-dev' : options.initialDevLog,
      injectSpecLiveReload: options.injectSpecLiveReload !== false,
      injectDescriptionEditing: options.injectDescriptionEditing !== false,
      descriptionEditApi,
      deviceCaptureApi,
      referenceImageApi,
      afterSourceBuildSuccess: (payload) => {
        if (orchestrator) {
          orchestrator.handleSourceBuildSuccess(payload);
        }
      },
      onDevSessionReady: ({ project: readyProject, liveReload }) => {
        orchestrator = createSpecDevOrchestrator({
          workspaceRoot,
          projectName,
          project: readyProject,
          collectScreenSpecProject,
          buildViewer,
          classifyPath,
          mergeKinds,
          debounceMs:
            typeof options.debounceMs === 'number'
              ? options.debounceMs
              : readyProject.watch &&
                  typeof readyProject.watch.debounce === 'number'
                ? readyProject.watch.debounce
                : 100,
          broadcastSpecReload: () => {
            if (liveReload && liveReload.broadcastReload) {
              return liveReload.broadcastReload('spec');
            }
            return false;
          },
          log: options.log !== false,
        });
        if (options.skipMetadataWatch !== true) {
          orchestrator.startMetadataWatching();
        }
        if (typeof options.onReady === 'function') {
          options.onReady({
            project: readyProject,
            liveReload,
            orchestrator,
            descriptionStore,
            descriptionEditApi,
            deviceCaptureApi,
            referenceImageApi,
          });
        }
      },
    });

    await runtime.start();
  }

  async function close() {
    if (closed) {
      return;
    }
    closed = true;
    try {
      if (orchestrator) {
        await orchestrator.close();
      }
    } catch {
      // ignore
    }
    try {
      if (runtime) {
        await runtime.close();
      }
    } catch {
      // ignore
    }
  }

  return {
    start,
    close,
    getOrchestrator() {
      return orchestrator;
    },
    getRuntime() {
      return runtime;
    },
  };
}

module.exports = {
  createSpecDevRuntime,
};
