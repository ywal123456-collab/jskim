'use strict';

const path = require('node:path');
const { EventEmitter } = require('node:events');
const chokidar = require('chokidar');
const { resolveWatchPaths } = require('./resolve-watch-paths');
const { runBuild } = require('./build-project');

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
 * - error(err)
 *
 * @param {object} project 解決済みプロジェクト
 * @param {object} [options]
 * @param {boolean} [options.runInitialBuild=true]
 * @param {boolean} [options.logChanges=true]
 * @returns {EventEmitter & { start: Function, close: Function, displayPaths: string[] }}
 */
function createProjectWatcher(project, options = {}) {
  const runInitialBuild = options.runInitialBuild !== false;
  const logChanges = options.logChanges !== false;
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
  let pendingEvents = [];
  let buildPromise = null;

  async function start(startOptions = {}) {
    if (started && chokidarWatcher) {
      return;
    }

    const watchFiles = startOptions.watchFiles !== false;

    if (!started) {
      started = true;
      if (runInitialBuild) {
        await executeBuild({ initial: true, events: [] });
      }
    }

    if (watchFiles) {
      beginWatching();
    }
  }

  function beginWatching() {
    if (chokidarWatcher || stopping) {
      return;
    }

    emitter.emit('ready', { displayPaths, debounceMs });

    chokidarWatcher = chokidar.watch(absolutePaths, {
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

    chokidarWatcher.on('all', (eventName, filePath) => {
      if (
        eventName === 'add' ||
        eventName === 'addDir' ||
        eventName === 'change' ||
        eventName === 'unlink' ||
        eventName === 'unlinkDir'
      ) {
        queueChange(eventName, filePath);
      }
    });

    chokidarWatcher.on('error', (err) => {
      const message = err && err.message ? err.message : String(err);
      console.error(`[JSKim] ウォッチャーエラー: ${message}`);
      emitter.emit('error', err);
    });
  }

  async function startWatching() {
    if (!started && runInitialBuild) {
      started = true;
      await executeBuild({ initial: true, events: [] });
    }
    started = true;
    beginWatching();
  }

  function queueChange(eventName, filePath) {
    if (stopping) {
      return;
    }

    pendingEvents.push({
      event: eventName,
      file: toDisplayPath(filePath, workspaceRoot),
    });

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      triggerBuild();
    }, debounceMs);
  }

  function triggerBuild() {
    if (stopping) {
      return;
    }

    if (building) {
      rebuildPending = true;
      return;
    }

    const events = pendingEvents;
    pendingEvents = [];
    building = true;

    buildPromise = (async () => {
      try {
        await executeBuild({ initial: false, events });
      } finally {
        building = false;
        buildPromise = null;

        if (!stopping && rebuildPending) {
          rebuildPending = false;
          triggerBuild();
        }
      }
    })();
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
      const result = await runBuild(project, {
        logTitle: initial ? 'ビルドが完了しました' : '再ビルドが完了しました',
        includeOutput: initial,
      });
      emitter.emit('build:success', { initial, result, events });
      return result;
    } catch (err) {
      const message = err && err.message ? err.message : String(err);

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
        // 診断付きメッセージは重複ヘッダーを避けるためそのまま出力する
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
    if (stopping) {
      return;
    }
    stopping = true;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (chokidarWatcher) {
      try {
        await chokidarWatcher.close();
      } catch {
        // 終了時の close エラーは無視
      }
      chokidarWatcher = null;
    }

    if (buildPromise) {
      try {
        await buildPromise;
      } catch {
        // 再ビルドエラーは既にログ済み
      }
    }
  }

  emitter.start = start;
  emitter.startWatching = startWatching;
  emitter.close = close;
  emitter.displayPaths = displayPaths;
  emitter.debounceMs = debounceMs;

  return emitter;
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
};
