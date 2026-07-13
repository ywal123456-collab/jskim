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

    const needsCompanion =
      typeof collectScreenSpecProject !== 'function' ||
      typeof buildViewer !== 'function' ||
      typeof classifyPath !== 'function' ||
      typeof mergeKinds !== 'function';

    if (needsCompanion) {
      let companion;
      try {
        companion = await resolveScreenSpecModule({
          projectRoot: workspaceRoot,
          modulePath: options.modulePath,
          requireCollect: true,
          requireWatchHelpers: true,
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
