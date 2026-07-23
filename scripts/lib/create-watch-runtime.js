'use strict';

const fs = require('node:fs');
const path = require('node:path');
const chokidar = require('chokidar');
const { loadConfig, CONFIG_FILENAME } = require('./load-config');
const { resolveProject } = require('./resolve-project');
const { selectProjectName } = require('./select-project-name');
const { applyServeCliOverrides } = require('./apply-serve-cli-overrides');
const { createProjectWatcher } = require('./create-project-watcher');
const { createStaticServer } = require('./create-static-server');
const {
  createSpecMount,
} = require('./create-spec-mount');
const { createLiveReload } = require('./create-live-reload');
const {
  injectDescriptionEditingBootstrap,
} = require('./create-description-edit-api');
const {
  injectVersionHistoryBootstrap,
} = require('./create-version-history-api');
const {
  injectFeatureEditingBootstrap,
} = require('./create-feature-api');
const { formatListenError } = require('../commands/serve-errors');
const { classifyReload } = require('./classify-reload');
const {
  buildBrowserOpenUrl,
  openBrowser: defaultOpenBrowser,
} = require('./open-browser');

const DEV_RESTART_KEYS = [
  'outputDir',
  'serve.host',
  'serve.port',
  'dev.liveReload',
];

/**
 * watch / dev 共通の実行ランタイムです。
 * jskim.config.js の hot reload と project watcher 再構成を担当します。
 *
 * @param {object} options
 * @param {'watch'|'dev'} options.mode
 * @param {string} options.workspaceRoot
 * @param {string|undefined} options.projectName
 * @param {string} [options.commandName]
 * @param {string} [options.usageLine]
 * @param {{ host?: string, port?: string|number, open?: boolean }} [options.cliOverrides]
 * @param {'default'|'spec-dev'|false} [options.initialDevLog='default']
 * @param {boolean} [options.injectSpecLiveReload=false]
 * @param {(payload: object) => void} [options.afterSourceBuildSuccess]
 * @param {(ctx: object) => void} [options.onDevSessionReady]
 * @param {(project: object) => void} [options.onProjectCommitted]
 * @param {(payload: { project: object, buildSucceeded: boolean }) => void} [options.onConfigActivationComplete]
 * @param {(project: object, options?: object) => import('node:events').EventEmitter} [options.projectWatcherFactory]
 * @returns {{ start: Function, close: Function, getProjectWatcher: Function }}
 */
function createWatchRuntime(options) {
  const mode = options.mode;
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const commandName = options.commandName || mode;
  const usageLine =
    options.usageLine || `jskim ${commandName} [<project>]`;
  const openBrowserFn = options.openBrowserFn || defaultOpenBrowser;
  const projectWatcherFactory =
    typeof options.projectWatcherFactory === 'function'
      ? options.projectWatcherFactory
      : (project, watcherOptions) =>
          createProjectWatcher(project, watcherOptions);
  const cliOverrides = {
    host: options.cliOverrides && options.cliOverrides.host,
    port: options.cliOverrides && options.cliOverrides.port,
    open: Boolean(options.cliOverrides && options.cliOverrides.open),
  };
  const initialDevLog =
    options.initialDevLog === undefined ? 'default' : options.initialDevLog;
  const injectSpecLiveReload = Boolean(options.injectSpecLiveReload);
  const afterSourceBuildSuccess =
    typeof options.afterSourceBuildSuccess === 'function'
      ? options.afterSourceBuildSuccess
      : null;
  const onDevSessionReady =
    typeof options.onDevSessionReady === 'function'
      ? options.onDevSessionReady
      : null;
  const onProjectCommitted =
    typeof options.onProjectCommitted === 'function'
      ? options.onProjectCommitted
      : null;
  const onConfigActivationComplete =
    typeof options.onConfigActivationComplete === 'function'
      ? options.onConfigActivationComplete
      : null;
  const descriptionEditApi =
    options.descriptionEditApi &&
    typeof options.descriptionEditApi.handleRequest === 'function'
      ? options.descriptionEditApi
      : null;
  const descriptionTreeApi =
    options.descriptionTreeApi &&
    typeof options.descriptionTreeApi.handleRequest === 'function'
      ? options.descriptionTreeApi
      : null;
  const deviceCaptureApi =
    options.deviceCaptureApi &&
    typeof options.deviceCaptureApi.handleRequest === 'function'
      ? options.deviceCaptureApi
      : null;
  const referenceImageApi =
    options.referenceImageApi &&
    typeof options.referenceImageApi.handleRequest === 'function'
      ? options.referenceImageApi
      : null;
  const versionHistoryApi =
    options.versionHistoryApi &&
    typeof options.versionHistoryApi.handleRequest === 'function'
      ? options.versionHistoryApi
      : null;
  const featureEditApi =
    options.featureEditApi &&
    typeof options.featureEditApi.handleRequest === 'function'
      ? options.featureEditApi
      : null;
  const injectDescriptionEditing = Boolean(options.injectDescriptionEditing);
  const injectVersionHistory = Boolean(options.injectVersionHistory);
  const injectFeatureEditing = Boolean(options.injectFeatureEditing);

  /** @type {string|undefined} */
  let selectedProjectName = options.projectName;
  let currentProject = null;
  let configPath = null;
  let projectWatcher = null;
  let configWatcher = null;
  let liveReload = null;
  let staticServer = null;
  let liveReloadEnabled = false;
  let browserOpened = false;

  const RUNTIME_PHASE = {
    starting: 'starting',
    ready: 'ready',
    stopping: 'stopping',
    closed: 'closed',
  };

  let stopping = false;
  let started = false;
  /** @type {'starting'|'ready'|'stopping'|'closed'} */
  let runtimePhase = RUNTIME_PHASE.starting;
  let configDebounceTimer = null;
  let configReloadPromise = null;
  let pendingConfigReload = false;
  let sourceBuilding = false;
  let replacementGeneration = 0;
  /** @type {{ generation: number, cancelled: boolean, candidateWatcher: object|null, rollbackWatcher: object|null }|null} */
  let replacementContext = null;

  function withCliOverrides(project) {
    return applyServeCliOverrides(project, {
      host: cliOverrides.host,
      port: cliOverrides.port,
    });
  }

  function resolveCurrentProject() {
    const loaded = loadConfig(workspaceRoot);
    const name = selectProjectName({
      config: loaded.config,
      projectName: selectedProjectName,
      commandName,
      usageLine,
    });
    selectedProjectName = name;
    const project = withCliOverrides(
      resolveProject({
        config: loaded.config,
        workspaceRoot,
        projectName: name,
        commandName,
        usageLine,
      })
    );
    return {
      project,
      configPath: loaded.configPath,
    };
  }

  function markRuntimeReady() {
    if (runtimePhase !== RUNTIME_PHASE.starting) {
      return;
    }
    runtimePhase = RUNTIME_PHASE.ready;
    if (pendingConfigReload) {
      pendingConfigReload = false;
      requestConfigReload();
    }
  }

  function beginReplacementContext() {
    replacementGeneration += 1;
    const ctx = {
      generation: replacementGeneration,
      cancelled: false,
      candidateWatcher: null,
      rollbackWatcher: null,
    };
    replacementContext = ctx;
    return ctx;
  }

  function clearReplacementContext(ctx) {
    if (replacementContext === ctx) {
      replacementContext = null;
    }
  }

  function isReplacementActive(ctx) {
    return Boolean(
      ctx &&
        !ctx.cancelled &&
        !stopping &&
        runtimePhase === RUNTIME_PHASE.ready &&
        replacementContext === ctx &&
        ctx.generation === replacementGeneration
    );
  }

  function createCancelledReplacementError() {
    const err = new Error('設定の再読み込みが中断されました。');
    err.code = 'JSKIM_CONFIG_RELOAD_CANCELLED';
    return err;
  }

  function commitAuthoritativeWatcher(project, watcher) {
    projectWatcher = watcher;
    currentProject = project;
    if (onProjectCommitted) {
      onProjectCommitted(project);
    }
  }

  async function start() {
    if (started) {
      return;
    }
    started = true;
    runtimePhase = RUNTIME_PHASE.starting;

    const resolved = resolveCurrentProject();
    currentProject = resolved.project;
    configPath = resolved.configPath;

    // config 監視は early に開始するが、replacement は runtime ready 後のみ。
    // そうしないと initial Project Watcher startup と競合しうる。
    beginConfigWatching();

    try {
      if (mode === 'dev') {
        await startDevSession(currentProject, { initial: true });
      } else {
        await startWatchSession(currentProject, { initial: true });
      }
    } catch (err) {
      throw err;
    }

    markRuntimeReady();
  }

  async function startWatchSession(project, { initial }) {
    projectWatcher = createAndWireProjectWatcher(project);

    if (initial) {
      projectWatcher.on('ready', ({ displayPaths, debounceMs }) => {
        console.log(`[JSKim] プロジェクトを監視しています: ${project.name}`);
        console.log('パス:');
        for (const display of displayPaths) {
          console.log(`- ${display}`);
        }
        console.log('');
        console.log(`Debounce: ${debounceMs}ms`);
        console.log('終了するには Ctrl+C を押してください。');
      });
    }

    await projectWatcher.start();
  }

  async function startDevSession(project, { initial }) {
    liveReloadEnabled = project.dev.liveReload;
    const host = project.serve.host.trim();
    const port = project.serve.port;
    const outputDisplay = toDisplayPath(project.outputDir, workspaceRoot);
    const browserUrl = buildBrowserOpenUrl({ host, port });

    liveReload = createLiveReload({
      projectName: project.name,
      enabled: liveReloadEnabled,
    });

    const specMount = createSpecMount({
      workspaceRoot,
      projectName: project.name,
      transformHtml: (html) => {
        let next = html;
        if (liveReloadEnabled && injectSpecLiveReload && liveReload) {
          next = liveReload.injectHtml(next);
        }
        if (injectDescriptionEditing) {
          next = injectDescriptionEditingBootstrap(next);
        }
        if (injectVersionHistory) {
          next = injectVersionHistoryBootstrap(next);
        }
        if (injectFeatureEditing) {
          next = injectFeatureEditingBootstrap(next);
        }
        return next;
      },
    });

    staticServer = createStaticServer({
      rootDir: project.outputDir,
      host,
      port,
      projectName: project.name,
      handleInternalRequest: async (req, res, meta) => {
        if (await liveReload.handleRequest(req, res, meta)) {
          return true;
        }
        if (
          descriptionEditApi &&
          (await descriptionEditApi.handleRequest(req, res, meta))
        ) {
          return true;
        }
        if (
          descriptionTreeApi &&
          (await descriptionTreeApi.handleRequest(req, res, meta))
        ) {
          return true;
        }
        if (
          deviceCaptureApi &&
          (await deviceCaptureApi.handleRequest(req, res, meta))
        ) {
          return true;
        }
        if (
          referenceImageApi &&
          (await referenceImageApi.handleRequest(req, res, meta))
        ) {
          return true;
        }
        if (
          featureEditApi &&
          (await featureEditApi.handleRequest(req, res, meta))
        ) {
          return true;
        }
        if (
          versionHistoryApi &&
          (await versionHistoryApi.handleRequest(req, res, meta))
        ) {
          return true;
        }
        return specMount.handleRequest(req, res, meta);
      },
      transformHtml: liveReloadEnabled
        ? (html) => liveReload.injectHtml(html)
        : undefined,
    });

    projectWatcher = createAndWireProjectWatcher(project);

    await projectWatcher.start({ watchFiles: false });

    try {
      await staticServer.start();
    } catch (err) {
      const formatted = formatListenError(err, {
        projectName: project.name,
        host,
        port,
        kind: '開発',
        commandName: 'dev',
      });
      await cleanupDevComponents();
      throw formatted;
    }

    await projectWatcher.startWatching();

    if (typeof onDevSessionReady === 'function') {
      onDevSessionReady({
        project,
        liveReload,
        staticServer,
        browserUrl,
      });
    }

    if (initial && initialDevLog === 'spec-dev') {
      console.log('[JSKim] 画面設計書の開発serverを開始しました。');
      console.log(`project: ${project.name}`);
      console.log(`application: ${browserUrl}`);
      console.log(
        `screen spec: ${browserUrl.replace(/\/$/, '')}/spec/`
      );
      console.log(
        `ライブリロード: ${liveReloadEnabled ? '有効' : '無効'}`
      );
      console.log('終了するには Ctrl+C を押してください。');
      maybeOpenBrowser(browserUrl);
    } else if (initial && initialDevLog !== false) {
      console.log('[JSKim] 開発サーバーを起動しました。');
      console.log(`プロジェクト: ${project.name}`);
      console.log(`ルート: ${outputDisplay}`);
      console.log(`URL: ${browserUrl}`);
      console.log(
        `画面設計書: ${browserUrl.replace(/\/$/, '')}/spec/ （jskim spec build 済みの場合）`
      );
      console.log(
        `ライブリロード: ${liveReloadEnabled ? '有効' : '無効'}`
      );
      console.log('終了するには Ctrl+C を押してください。');
      maybeOpenBrowser(browserUrl);
    }
  }

  function maybeOpenBrowser(url) {
    if (!cliOverrides.open || browserOpened || stopping) {
      return;
    }
    browserOpened = true;
    const result = openBrowserFn(url);
    if (!result.ok) {
      const message =
        result.error && result.error.message
          ? result.error.message
          : String(result.error || 'unknown');
      console.warn(
        `[JSKim] browserを開けませんでした。手動で次のURLを開いてください: ${url}\n` +
          `原因: ${message}`
      );
    }
  }

  function wireSourceBuildTracking(watcher) {
    watcher.on('build:start', () => {
      sourceBuilding = true;
    });
    watcher.on('build:success', () => {
      sourceBuilding = false;
      maybeRunPendingConfigReload();
    });
    watcher.on('build:failure', () => {
      sourceBuilding = false;
      maybeRunPendingConfigReload();
    });
  }

  /**
   * ready 後の project watcher runtime error を表示する。
   * EventEmitter 'error' は listener 必須のため、no-op ではなくログ consumer を接続する。
   */
  function wireWatcherRuntimeErrors(watcher) {
    const onError = (err) => {
      const message = err && err.message ? err.message : String(err);
      console.error(`[JSKim] ウォッチャーエラー: ${message}`);
    };
    watcher.on('error', onError);
    return () => {
      watcher.off('error', onError);
    };
  }

  /**
   * candidate / rollback で同じ production wiring を共有する。
   */
  function createAndWireProjectWatcher(project, hooks = {}) {
    const watcher = projectWatcherFactory(project, {
      runInitialBuild: true,
      logChanges: true,
    });

    wireSourceBuildTracking(watcher);
    wireWatcherRuntimeErrors(watcher);
    if (mode === 'dev') {
      wireDevSourceReload(watcher);
      wireSpecDevHooks(watcher);
    }

    if (
      typeof hooks.onInitialBuildSuccess === 'function' ||
      typeof hooks.onInitialBuildFailure === 'function'
    ) {
      watcher.on('build:success', ({ initial }) => {
        if (initial && hooks.onInitialBuildSuccess) {
          hooks.onInitialBuildSuccess();
        }
      });
      watcher.on('build:failure', ({ initial, error }) => {
        if (initial && hooks.onInitialBuildFailure) {
          hooks.onInitialBuildFailure(error);
        }
      });
    }

    return watcher;
  }

  async function safeCloseProjectWatcher(watcher) {
    if (!watcher) {
      return;
    }
    try {
      await watcher.close();
    } catch {
      // reload / rollback 時の close エラーは無視
    }
  }

  function wireDevSourceReload(watcher) {
    watcher.on('build:success', ({ initial, events }) => {
      if (initial || !liveReloadEnabled || !liveReload) {
        return;
      }
      // 未解決の config error がある間は source 成功で overlay/reload しない
      if (liveReload.hasConfigError()) {
        return;
      }
      const kind = classifyReload({
        events,
        sourceDir: currentProject && currentProject.sourceDir,
        templates: currentProject && currentProject.templates,
      });
      // 実装画面向け。/spec/ タブは target=app でスキップ（client 側）
      liveReload.notifySourceBuildSuccess(kind, 'app');
    });

    watcher.on('build:failure', ({ error }) => {
      if (!liveReloadEnabled || !liveReload) {
        return;
      }
      // Error.message は完成済みの診断文字列を再利用する
      liveReload.broadcastBuildError(error);
    });
  }

  function wireSpecDevHooks(watcher) {
    if (!afterSourceBuildSuccess) {
      return;
    }
    watcher.on('build:success', (payload) => {
      try {
        afterSourceBuildSuccess(payload);
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        console.error(`[JSKim] Screen Spec orchestration エラー: ${message}`);
      }
    });
  }

  function beginConfigWatching() {
    if (configWatcher || stopping) {
      return;
    }

    configWatcher = chokidar.watch(configPath, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 50,
        pollInterval: 25,
      },
    });

    configWatcher.on('all', (eventName) => {
      if (
        eventName === 'add' ||
        eventName === 'change' ||
        eventName === 'unlink'
      ) {
        queueConfigReload(eventName);
      }
    });

    configWatcher.on('error', (err) => {
      const message = err && err.message ? err.message : String(err);
      console.error(`[JSKim] 設定ファイルの監視エラー: ${message}`);
    });
  }

  function queueConfigReload(eventName) {
    if (stopping) {
      return;
    }

    if (eventName === 'unlink') {
      console.log(
        `[JSKim] 設定ファイルが一時的に削除されました。以前の正常な設定を継続します。`
      );
    } else {
      console.log('[JSKim] 設定ファイルの変更を検出しました。');
    }

    if (configDebounceTimer) {
      clearTimeout(configDebounceTimer);
    }

    const debounceMs =
      currentProject && currentProject.watch
        ? currentProject.watch.debounce
        : 150;

    configDebounceTimer = setTimeout(() => {
      configDebounceTimer = null;
      requestConfigReload();
    }, debounceMs);
  }

  function requestConfigReload() {
    if (stopping || runtimePhase === RUNTIME_PHASE.stopping || runtimePhase === RUNTIME_PHASE.closed) {
      return;
    }

    // initial runtime ready 前は transaction を始めず pending のみ保持する
    if (runtimePhase !== RUNTIME_PHASE.ready) {
      pendingConfigReload = true;
      return;
    }

    if (configReloadPromise || sourceBuilding) {
      pendingConfigReload = true;
      return;
    }

    configReloadPromise = (async () => {
      try {
        await performConfigReload();
      } finally {
        configReloadPromise = null;
        if (
          !stopping &&
          runtimePhase === RUNTIME_PHASE.ready &&
          pendingConfigReload
        ) {
          pendingConfigReload = false;
          requestConfigReload();
        }
      }
    })();
  }

  function maybeRunPendingConfigReload() {
    if (
      !stopping &&
      runtimePhase === RUNTIME_PHASE.ready &&
      pendingConfigReload &&
      !configReloadPromise
    ) {
      pendingConfigReload = false;
      requestConfigReload();
    }
  }

  async function performConfigReload() {
    if (stopping || runtimePhase !== RUNTIME_PHASE.ready) {
      return;
    }

    if (!fs.existsSync(configPath)) {
      // unlink 後まだ復元されていない
      return;
    }

    let candidate;
    try {
      const loaded = loadConfig(workspaceRoot);
      const name = selectProjectName({
        config: loaded.config,
        projectName: selectedProjectName,
        commandName,
        usageLine,
      });
      selectedProjectName = name;
      candidate = withCliOverrides(
        resolveProject({
          config: loaded.config,
          workspaceRoot,
          projectName: name,
          commandName,
          usageLine,
        })
      );
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      console.error('[JSKim] 設定ファイルの再読み込みに失敗しました。');
      console.error(message);
      console.error('[JSKim] 以前の正常な設定を継続します。');
      if (mode === 'dev' && liveReloadEnabled && liveReload) {
        liveReload.broadcastConfigError(message);
      }
      return;
    }

    // candidate は validation 済み。以降の失敗は build error として扱う
    if (mode === 'dev' && liveReloadEnabled && liveReload) {
      liveReload.clearConfigError();
    }

    if (mode === 'dev') {
      const restartKeys = getRestartRequiredChanges(currentProject, candidate);
      if (restartKeys.length > 0) {
        console.warn(
          '[JSKim] 次の設定変更を反映するにはdev processの再起動が必要です:'
        );
        for (const key of restartKeys) {
          console.warn(`- ${key}`);
        }
        console.warn('[JSKim] 以前の正常な設定を継続します。');
        return;
      }
    }

    console.log('[JSKim] 設定を再読み込みしました。');

    let buildSucceeded = false;
    try {
      // runInitialBuild は queue drain 後の最終結果を返す
      const activationResult = await replaceProjectWatcher(candidate);
      buildSucceeded = activationResult != null;
    } catch (err) {
      const code = err && err.code;
      const message = err && err.message ? err.message : String(err);
      if (code === 'JSKIM_CONFIG_RELOAD_CANCELLED') {
        return;
      }
      if (code === 'JSKIM_CONFIG_WATCHER_ROLLED_BACK') {
        console.error('[JSKim] 設定の再読み込み後に監視の更新に失敗しました。');
        if (err.candidateError) {
          const candidateMessage =
            err.candidateError.message || String(err.candidateError);
          console.error(candidateMessage);
        }
        console.error(`[JSKim] ${message}`);
        if (err.rollbackBuildSucceeded === false) {
          console.error(
            '[JSKim] 以前の設定での監視は継続していますが、再ビルドに失敗しました。'
          );
        }
        if (mode === 'dev' && liveReloadEnabled && liveReload) {
          liveReload.broadcastConfigError(message);
        }
        return;
      }
      if (code === 'JSKIM_CONFIG_WATCHER_UNAVAILABLE') {
        console.error(`[JSKim] ${message}`);
        if (err.candidateError) {
          console.error(
            `新しい設定: ${err.candidateError.message || String(err.candidateError)}`
          );
        }
        if (err.rollbackError) {
          console.error(
            `以前の監視: ${err.rollbackError.message || String(err.rollbackError)}`
          );
        }
        console.error(
          '[JSKim] 設定ファイルを修正するか、devサーバーを再起動してください。'
        );
        if (mode === 'dev' && liveReloadEnabled && liveReload) {
          liveReload.broadcastConfigError(message);
        }
        return;
      }
      console.error('[JSKim] 設定の再読み込み後に監視の更新に失敗しました。');
      console.error(message);
      console.error('[JSKim] 以前の正常な設定を継続します。');
      if (mode === 'dev' && liveReloadEnabled && liveReload) {
        liveReload.broadcastConfigError(message);
      }
      return;
    }

    if (onConfigActivationComplete) {
      onConfigActivationComplete({
        project: currentProject,
        buildSucceeded,
      });
    }

    if (!buildSucceeded) {
      console.error(
        '[JSKim] 設定の再読み込み後にbuildが失敗しました。監視は新しい設定で継続します。'
      );
      return;
    }

    // activation final success のみ完了 signal
    console.log('[JSKim] 監視対象を更新しました。');
    if (mode === 'watch' && projectWatcher) {
      console.log('パス:');
      for (const display of projectWatcher.displayPaths) {
        console.log(`- ${display}`);
      }
      console.log(`Debounce: ${projectWatcher.debounceMs}ms`);
    }

    if (mode === 'dev' && liveReloadEnabled && liveReload) {
      liveReload.broadcastReload();
    }
  }

  /**
   * Project watcher を transactional に置換する。
   *
   * 順序:
   * 1. old close
   * 2. candidate startWatching（ready まで。build なし）
   * 3. ready 成功後に authoritative state を同期 commit
   * 4. candidate runInitialBuild
   *
   * ready 前の candidate build / output write は行わない。
   * local candidate/rollback は replacementContext が所有する。
   */
  async function replaceProjectWatcher(project, hooks = {}) {
    const ctx = beginReplacementContext();
    const oldProject = currentProject;
    const previousWatcher = projectWatcher;

    try {
      if (previousWatcher) {
        await safeCloseProjectWatcher(previousWatcher);
        if (!isReplacementActive(ctx)) {
          throw createCancelledReplacementError();
        }
        if (projectWatcher === previousWatcher) {
          projectWatcher = null;
        }
      }

      const candidateWatcher = createAndWireProjectWatcher(project, hooks);
      ctx.candidateWatcher = candidateWatcher;
      try {
        await candidateWatcher.startWatching();
      } catch (candidateError) {
        await safeCloseProjectWatcher(candidateWatcher);
        ctx.candidateWatcher = null;
        if (!isReplacementActive(ctx)) {
          throw createCancelledReplacementError();
        }

        if (!oldProject) {
          projectWatcher = null;
          const unavailable = new Error(
            '新しい設定の適用と以前の監視状態の復旧に失敗しました。'
          );
          unavailable.code = 'JSKIM_CONFIG_WATCHER_UNAVAILABLE';
          unavailable.candidateError = candidateError;
          unavailable.rollbackError = null;
          throw unavailable;
        }

        const rollbackWatcher = createAndWireProjectWatcher(oldProject);
        ctx.rollbackWatcher = rollbackWatcher;
        try {
          await rollbackWatcher.startWatching();
        } catch (rollbackError) {
          await safeCloseProjectWatcher(rollbackWatcher);
          ctx.rollbackWatcher = null;
          if (!isReplacementActive(ctx)) {
            throw createCancelledReplacementError();
          }
          projectWatcher = null;
          const unavailable = new Error(
            '新しい設定の適用と以前の監視状態の復旧に失敗しました。'
          );
          unavailable.code = 'JSKIM_CONFIG_WATCHER_UNAVAILABLE';
          unavailable.candidateError = candidateError;
          unavailable.rollbackError = rollbackError;
          throw unavailable;
        }

        if (!isReplacementActive(ctx)) {
          await safeCloseProjectWatcher(rollbackWatcher);
          ctx.rollbackWatcher = null;
          throw createCancelledReplacementError();
        }

        // rollback ready 後: old authoritative state を確定してから drain まで build
        commitAuthoritativeWatcher(oldProject, rollbackWatcher);
        ctx.rollbackWatcher = null;

        const rollbackResult = await rollbackWatcher.runInitialBuild();
        if (!isReplacementActive(ctx)) {
          throw createCancelledReplacementError();
        }

        const rollbackBuildSucceeded = rollbackResult != null;
        const rolledBack = new Error(
          rollbackBuildSucceeded
            ? '新しい設定の適用に失敗したため、以前の設定に戻しました。'
            : '新しい設定の適用に失敗し、以前の設定での再ビルドにも失敗しました。'
        );
        rolledBack.code = 'JSKIM_CONFIG_WATCHER_ROLLED_BACK';
        rolledBack.candidateError = candidateError;
        rolledBack.rollbackBuildSucceeded = rollbackBuildSucceeded;
        rolledBack.watcherAvailable = true;
        throw rolledBack;
      }

      if (!isReplacementActive(ctx)) {
        await safeCloseProjectWatcher(candidateWatcher);
        ctx.candidateWatcher = null;
        throw createCancelledReplacementError();
      }

      // candidate ready 後・initial build 前に state を同期 commit
      commitAuthoritativeWatcher(project, candidateWatcher);
      ctx.candidateWatcher = null;

      const activationResult = await candidateWatcher.runInitialBuild();
      if (!isReplacementActive(ctx)) {
        throw createCancelledReplacementError();
      }
      return activationResult;
    } finally {
      clearReplacementContext(ctx);
    }
  }

  async function cleanupDevComponents() {
    if (projectWatcher) {
      try {
        await projectWatcher.close();
      } catch {
        // ignore
      }
      projectWatcher = null;
    }
    if (liveReload) {
      try {
        liveReload.close();
      } catch {
        // ignore
      }
      liveReload = null;
    }
    if (staticServer) {
      try {
        await staticServer.stop();
      } catch {
        // ignore
      }
      staticServer = null;
    }
  }

  async function close() {
    if (stopping) {
      return;
    }
    stopping = true;
    runtimePhase = RUNTIME_PHASE.stopping;
    pendingConfigReload = false;

    if (configDebounceTimer) {
      clearTimeout(configDebounceTimer);
      configDebounceTimer = null;
    }

    // close 中に replace 側が context を clear しても触れるようローカルに固定する
    const inFlightReplacement = replacementContext;
    if (inFlightReplacement) {
      inFlightReplacement.cancelled = true;
      // in-flight local watcher を先に閉じ、startup Promise を settle させる
      await safeCloseProjectWatcher(inFlightReplacement.candidateWatcher);
      inFlightReplacement.candidateWatcher = null;
      await safeCloseProjectWatcher(inFlightReplacement.rollbackWatcher);
      inFlightReplacement.rollbackWatcher = null;
    }

    if (configWatcher) {
      try {
        await configWatcher.close();
      } catch {
        // ignore
      }
      configWatcher = null;
    }

    if (configReloadPromise) {
      try {
        await configReloadPromise;
      } catch {
        // ignore
      }
    }

    if (mode === 'dev') {
      await cleanupDevComponents();
    } else if (projectWatcher) {
      try {
        await projectWatcher.close();
      } catch {
        // ignore
      }
      projectWatcher = null;
    }

    runtimePhase = RUNTIME_PHASE.closed;
  }

  return {
    start,
    close,
    getProjectWatcher() {
      return projectWatcher;
    },
    get project() {
      return currentProject;
    },
    get configFileName() {
      return CONFIG_FILENAME;
    },
  };
}

/**
 * @param {object} previous
 * @param {object} next
 * @returns {string[]}
 */
function getRestartRequiredChanges(previous, next) {
  const changes = [];
  if (previous.outputDir !== next.outputDir) {
    changes.push('outputDir');
  }
  if (previous.serve.host !== next.serve.host) {
    changes.push('serve.host');
  }
  if (previous.serve.port !== next.serve.port) {
    changes.push('serve.port');
  }
  if (previous.dev.liveReload !== next.dev.liveReload) {
    changes.push('dev.liveReload');
  }
  return changes;
}

function toDisplayPath(abs, workspaceRoot) {
  const resolved = path.resolve(abs);
  const rel = path.relative(workspaceRoot, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return resolved.split(path.sep).join('/');
  }
  return rel.split(path.sep).join('/');
}

module.exports = {
  createWatchRuntime,
  getRestartRequiredChanges,
  DEV_RESTART_KEYS,
};
