'use strict';

const path = require('node:path');
const { EventEmitter } = require('node:events');
const chokidar = require('chokidar');
const { resolveWatchPaths } = require('./resolve-watch-paths');
const { runBuild } = require('./build-project');

const PHASE = {
  idle: 'idle',
  starting: 'starting',
  ready: 'ready',
  closing: 'closing',
  closed: 'closed',
  failed: 'failed',
};

/**
 * プロジェクトのファイル監視と全体再ビルドを担当する共通コアです。
 * watch.js / dev.js の両方から再利用します。
 *
 * イベント:
 * - change({ events })
 * - build:start({ initial, events })
 * - build:success({ initial, result, events })
 * - build:failure({ initial, error, events })
 * - ready({ displayPaths, debounceMs })
 * - error(err) … ready 後の runtime error（caller が listener を持つこと）
 *
 * @param {object} project 解決済みプロジェクト
 * @param {object} [options]
 * @param {boolean} [options.runInitialBuild=true]
 * @param {boolean} [options.logChanges=true]
 * @param {typeof chokidar.watch} [options.watchFactory] test seam（省略時は chokidar.watch）
 * @param {(ctx: object) => Promise<unknown>} [options.executeBuildImpl] test seam（省略時は runBuild）
 * @param {(callback: Function, delayMs: number) => any} [options.scheduleDebouncedBuild] test seam
 * @param {(timer: any) => void} [options.clearDebouncedBuild] test seam
 * @returns {EventEmitter & {
 *   start: Function,
 *   startWatching: Function,
 *   runInitialBuild: Function,
 *   close: Function,
 *   displayPaths: string[]
 * }}
 */
function createProjectWatcher(project, options = {}) {
  const runInitialBuild = options.runInitialBuild !== false;
  const logChanges = options.logChanges !== false;
  const watchFactory =
    typeof options.watchFactory === 'function'
      ? options.watchFactory
      : (paths, watchOptions) => chokidar.watch(paths, watchOptions);
  const executeBuildImpl =
    typeof options.executeBuildImpl === 'function'
      ? options.executeBuildImpl
      : null;
  const scheduleDebouncedBuild =
    typeof options.scheduleDebouncedBuild === 'function'
      ? options.scheduleDebouncedBuild
      : (callback, delayMs) => setTimeout(callback, delayMs);
  const clearDebouncedBuild =
    typeof options.clearDebouncedBuild === 'function'
      ? options.clearDebouncedBuild
      : (timer) => clearTimeout(timer);
  const workspaceRoot = project.workspaceRoot;
  const debounceMs = project.watch.debounce;

  const { absolutePaths, displayPaths } = resolveWatchPaths(project);
  const emitter = new EventEmitter();

  let chokidarWatcher = null;
  let debounceTimer = null;
  let building = false;
  let rebuildPending = false;
  let stopping = false;
  let started = false;
  let initialBuildDone = false;
  /** @type {Promise<unknown> | null} */
  let initialBuildShared = null;
  let pendingEvents = [];
  let buildPromise = null;
  /** @type {unknown} */
  let lastBuildResult = null;
  /** @type {Array<{ resolve: Function, reject: Function, settled: boolean }>} */
  let drainWaiters = [];
  let phase = PHASE.idle;
  /** @type {null | { promise: Promise<void>, resolve: Function, reject: Function, settled: boolean }} */
  let readiness = null;
  let onAllHandler = null;
  let onReadyHandler = null;
  let onErrorHandler = null;

  async function start(startOptions = {}) {
    if (phase === PHASE.closing || phase === PHASE.closed) {
      throw createClosedBeforeReadyError();
    }
    if (started && chokidarWatcher && phase === PHASE.ready) {
      return;
    }

    const watchFiles = startOptions.watchFiles !== false;

    // 通常 startup: initial build → watch（既存契約）。queue 経由で直列化する。
    if (!initialBuildDone && runInitialBuild) {
      await runInitialBuildNow();
    }
    started = true;

    if (watchFiles) {
      await beginWatching();
    }
  }

  /**
   * chokidar ready まで待つ単一 startup gate。
   * ignoreInitial:true のため ready 前の write は取りこぼされる。
   */
  async function beginWatching() {
    if (stopping || phase === PHASE.closing || phase === PHASE.closed) {
      throw createClosedBeforeReadyError();
    }
    if (chokidarWatcher && phase === PHASE.ready) {
      return;
    }
    if (phase === PHASE.starting && readiness) {
      await readiness.promise;
      return;
    }

    phase = PHASE.starting;
    readiness = createReadinessDeferred();

    chokidarWatcher = watchFactory(absolutePaths, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 50,
        pollInterval: 25,
      },
      ignored: [
        /(^|[/\\])node_modules([/\\]|$)/,
        /(^|[/\\])dist([/\\]|$)/,
      ],
    });

    onAllHandler = (eventName, filePath) => {
      if (
        eventName === 'add' ||
        eventName === 'addDir' ||
        eventName === 'change' ||
        eventName === 'unlink' ||
        eventName === 'unlinkDir'
      ) {
        queueChange(eventName, filePath);
      }
    };

    onReadyHandler = () => {
      if (phase !== PHASE.starting || !readiness || readiness.settled) {
        return;
      }
      detachStartupListeners();
      phase = PHASE.ready;
      readiness.resolve();
      emitter.emit('ready', { displayPaths, debounceMs });
    };

    onErrorHandler = (err) => {
      if (phase === PHASE.starting) {
        settleStartupFailure(err);
        return;
      }
      if (phase === PHASE.ready) {
        // runtime consumer（create-watch-runtime 等）へ単一伝達
        emitter.emit('error', err);
      }
      // closing / closed / failed: late error は無視
    };

    chokidarWatcher.on('all', onAllHandler);
    chokidarWatcher.on('ready', onReadyHandler);
    chokidarWatcher.on('error', onErrorHandler);

    try {
      await readiness.promise;
    } catch (err) {
      if (readiness && readiness.cleanupPromise) {
        await readiness.cleanupPromise.catch(() => {});
      }
      throw err;
    }
  }

  /**
   * chokidar 監視だけを開始する（initial build は行わない）。
   * config reload replacement は ready 確定後に runInitialBuild() を呼ぶ。
   */
  async function startWatching() {
    if (phase === PHASE.closing || phase === PHASE.closed) {
      throw createClosedBeforeReadyError();
    }
    started = true;
    await beginWatching();
  }

  /**
   * activation 用 initial build。
   * initial 本体に加え、その間に観察された pending follow-up chain が
   * queue drain するまで待ち、最終 build 結果を返す。
   */
  function runInitialBuildNow() {
    if (phase === PHASE.closing || phase === PHASE.closed) {
      return Promise.reject(createClosedBeforeReadyError());
    }
    if (initialBuildDone) {
      return Promise.resolve(null);
    }
    if (initialBuildShared) {
      return initialBuildShared;
    }
    started = true;
    initialBuildShared = (async () => {
      await requestBuild({
        initial: true,
        events: [],
        awaitCompletion: true,
      });
      const finalResult = await waitForBuildQueueDrain();
      initialBuildDone = true;
      return finalResult;
    })().then(
      (result) => {
        initialBuildShared = null;
        return result;
      },
      (err) => {
        initialBuildShared = null;
        throw err;
      }
    );
    return initialBuildShared;
  }

  function isQueueDrained() {
    return (
      !building &&
      buildPromise == null &&
      !rebuildPending &&
      pendingEvents.length === 0 &&
      debounceTimer == null
    );
  }

  function waitForBuildQueueDrain() {
    if (stopping || phase === PHASE.closing || phase === PHASE.closed) {
      return Promise.reject(createClosedBeforeReadyError());
    }
    if (isQueueDrained()) {
      return Promise.resolve(lastBuildResult);
    }
    return new Promise((resolve, reject) => {
      drainWaiters.push({ resolve, reject, settled: false });
    });
  }

  function settleDrainWaiters(kind, value) {
    if (drainWaiters.length === 0) {
      return;
    }
    const waiters = drainWaiters;
    drainWaiters = [];
    for (const waiter of waiters) {
      if (waiter.settled) {
        continue;
      }
      waiter.settled = true;
      if (kind === 'resolve') {
        waiter.resolve(value);
      } else {
        waiter.reject(value);
      }
    }
  }

  function notifyDrainWaitersIfIdle() {
    if (!isQueueDrained()) {
      return;
    }
    settleDrainWaiters('resolve', lastBuildResult);
  }

  /**
   * 単一の authoritative build queue。
   * executeBuild の同時実行は常に 1 以下。
   *
   * @param {{ initial: boolean, events?: object[], awaitCompletion?: boolean }} options
   */
  function requestBuild(options) {
    const initial = Boolean(options.initial);
    const awaitCompletion = Boolean(options.awaitCompletion);
    const events = Array.isArray(options.events) ? options.events : [];

    if (stopping || phase === PHASE.closing || phase === PHASE.closed) {
      if (awaitCompletion) {
        return Promise.resolve(null);
      }
      return undefined;
    }

    // change rebuild は ready 後のみ。initial は start / activation からも呼ばれる。
    if (!initial && phase !== PHASE.ready) {
      if (awaitCompletion) {
        return Promise.resolve(null);
      }
      return undefined;
    }

    if (building) {
      rebuildPending = true;
      if (awaitCompletion && buildPromise) {
        return buildPromise.then(() => null);
      }
      return undefined;
    }

    const buildEvents = initial ? events : pendingEvents.slice();
    if (!initial) {
      pendingEvents = [];
      // follow-up 開始時に debounce 予約を消す（二重 rebuild 防止）
      if (debounceTimer) {
        clearDebouncedBuild(debounceTimer);
        debounceTimer = null;
      }
    }

    building = true;
    const thisBuild = (async () => {
      try {
        return await executeBuild({ initial, events: buildEvents });
      } finally {
        building = false;
        buildPromise = null;

        if (!stopping && phase === PHASE.ready && rebuildPending) {
          rebuildPending = false;
          void requestBuild({ initial: false, awaitCompletion: false });
        } else {
          notifyDrainWaitersIfIdle();
        }
      }
    })();

    buildPromise = thisBuild;

    if (awaitCompletion) {
      return thisBuild;
    }
    return undefined;
  }

  function settleStartupFailure(err) {
    if (phase !== PHASE.starting || !readiness || readiness.settled) {
      return;
    }
    detachStartupListeners();
    phase = PHASE.failed;
    readiness.cleanupPromise = closeChokidarInstance();
    readiness.reject(err);
  }

  function detachStartupListeners() {
    if (!chokidarWatcher) {
      return;
    }
    if (onReadyHandler) {
      chokidarWatcher.off('ready', onReadyHandler);
      onReadyHandler = null;
    }
    // error / all は ready 後も維持（runtime error・変更検知）
  }

  function detachAllListeners(target) {
    const watcher = target || chokidarWatcher;
    if (!watcher) {
      return;
    }
    if (onAllHandler) {
      watcher.off('all', onAllHandler);
      onAllHandler = null;
    }
    if (onReadyHandler) {
      watcher.off('ready', onReadyHandler);
      onReadyHandler = null;
    }
    if (onErrorHandler) {
      watcher.off('error', onErrorHandler);
      onErrorHandler = null;
    }
  }

  async function closeChokidarInstance() {
    const watcher = chokidarWatcher;
    chokidarWatcher = null;
    if (!watcher) {
      return;
    }
    // reference を null にした後も captured watcher から detach する
    detachAllListeners(watcher);
    try {
      await watcher.close();
    } catch {
      // 終了時の close エラーは無視
    }
  }

  function queueChange(eventName, filePath) {
    if (stopping || phase !== PHASE.ready) {
      return;
    }

    const absolutePath = path.resolve(filePath);
    // event 観察時点で非 drain（debounce 未発火でも waiter を先に通さない）
    pendingEvents.push({
      event: eventName,
      file: toDisplayPath(absolutePath, workspaceRoot),
      absolutePath,
    });
    if (building) {
      rebuildPending = true;
    }

    if (debounceTimer) {
      clearDebouncedBuild(debounceTimer);
    }

    debounceTimer = scheduleDebouncedBuild(() => {
      debounceTimer = null;
      if (pendingEvents.length === 0 && !rebuildPending && !building) {
        notifyDrainWaitersIfIdle();
        return;
      }
      triggerBuild();
    }, debounceMs);
  }

  function triggerBuild() {
    void requestBuild({ initial: false, awaitCompletion: false });
  }

  async function executeBuild({ initial, events }) {
    if (!initial) {
      if (logChanges) {
        logChangeSummary(events);
      }
      emitter.emit('change', { events });
    }

    emitter.emit('build:start', { initial, events });

    try {
      const result = executeBuildImpl
        ? await executeBuildImpl({
            initial,
            events,
            project,
            runBuild,
          })
        : await runBuild(project, {
            logTitle: initial ? 'ビルドが完了しました' : '再ビルドが完了しました',
            includeOutput: initial,
          });
      lastBuildResult = result;
      emitter.emit('build:success', { initial, result, events });
      return result;
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      lastBuildResult = null;

      if (initial) {
        console.error(message);
        console.error(
          `[JSKim] プロジェクト "${project.name}" の初回ビルドに失敗しました。ウォッチャーは開始します。`
        );
      } else {
        console.error(`[JSKim] 再ビルドに失敗しました`);
        console.error(`プロジェクト: ${project.name}`);
        const representative = events[events.length - 1] || null;
        if (representative) {
          console.error(`イベント: ${representative.event}`);
          console.error(`ファイル: ${representative.file}`);
        }
        if (events.length > 1) {
          console.error(`変更数: ${events.length} ファイル`);
        }
        if (String(message).startsWith('[JSKim]')) {
          console.error(message);
        } else {
          console.error(`原因: ${message}`);
        }
        console.error(
          `[JSKim] ウォッチャーは継続中です。修正して保存すると再試行します。`
        );
      }

      emitter.emit('build:failure', { initial, error: err, events });
      return null;
    }
  }

  async function close() {
    if (phase === PHASE.closing || phase === PHASE.closed) {
      return;
    }

    const wasStarting = phase === PHASE.starting;
    phase = PHASE.closing;
    stopping = true;

    if (debounceTimer) {
      clearDebouncedBuild(debounceTimer);
      debounceTimer = null;
    }
    rebuildPending = false;
    pendingEvents = [];

    if (wasStarting && readiness && !readiness.settled) {
      readiness.cleanupPromise = null;
      readiness.reject(createClosedBeforeReadyError());
    }

    settleDrainWaiters('reject', createClosedBeforeReadyError());

    await closeChokidarInstance();

    if (buildPromise) {
      try {
        await buildPromise;
      } catch {
        // 再ビルドエラーは既にログ済み
      }
    }

    phase = PHASE.closed;
    readiness = null;
  }

  emitter.start = start;
  emitter.startWatching = startWatching;
  emitter.runInitialBuild = runInitialBuildNow;
  emitter.close = close;
  emitter.displayPaths = displayPaths;
  emitter.debounceMs = debounceMs;

  return emitter;
}

function createReadinessDeferred() {
  /** @type {(value?: void) => void} */
  let resolveFn = () => {};
  /** @type {(err: Error) => void} */
  let rejectFn = () => {};
  let settled = false;
  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  // reject 後の unhandled rejection を避ける（caller が await する前提だが保険）
  promise.catch(() => {});
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve() {
      if (settled) {
        return false;
      }
      settled = true;
      resolveFn();
      return true;
    },
    reject(err) {
      if (settled) {
        return false;
      }
      settled = true;
      rejectFn(err);
      return true;
    },
  };
}

function createClosedBeforeReadyError() {
  const err = new Error('監視開始前にwatcherが終了しました。');
  err.code = 'JSKIM_WATCHER_CLOSED_BEFORE_READY';
  return err;
}

function logChangeSummary(events) {
  if (!events || events.length === 0) {
    console.log('[JSKim] 変更を検知しました');
    return;
  }

  const last = events[events.length - 1];
  console.log('[JSKim] 変更を検知しました');
  console.log(`イベント: ${last.event}`);
  console.log(`ファイル: ${last.file}`);
  if (events.length > 1) {
    console.log(`まとめた変更: ${events.length}`);
  }
}

function toDisplayPath(filePath, workspaceRoot) {
  const abs = path.resolve(filePath);
  const rel = path.relative(workspaceRoot, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return abs.split(path.sep).join('/');
  }
  return rel.split(path.sep).join('/');
}

module.exports = {
  createProjectWatcher,
  JSKIM_WATCHER_CLOSED_BEFORE_READY: 'JSKIM_WATCHER_CLOSED_BEFORE_READY',
};
