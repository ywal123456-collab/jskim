'use strict';

const path = require('node:path');
const chokidar = require('chokidar');
const { createSpecTaskQueue } = require('./create-spec-task-queue');
const { runScreenSpecCollect } = require('./run-screen-spec-collect');

const DEFAULT_DEBOUNCE_MS = 100;

/**
 * Screen Spec の collect/build watch orchestration。
 *
 * 既存 project watcher（実装画面 rebuild）の成功後に collect+build を繋ぎ、
 * Description / theme は専用 watcher で build-only にする。
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} options.projectName
 * @param {object} options.project
 * @param {(opts: object) => Promise<object>} options.collectScreenSpecProject
 * @param {(opts: object) => Promise<object>} options.buildViewer
 * @param {() => boolean} [options.broadcastSpecReload]
 * @param {(pathOpts: object) => string} options.classifyPath
 * @param {(kinds: Iterable<string>) => string} options.mergeKinds
 * @param {number} [options.debounceMs]
 * @param {boolean} [options.log=true]
 */
function createSpecDevOrchestrator(options) {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const projectName = options.projectName;
  const project = options.project;
  const collectScreenSpecProject = options.collectScreenSpecProject;
  const buildViewer = options.buildViewer;
  const broadcastSpecReload = options.broadcastSpecReload;
  const classifyPath = options.classifyPath;
  const mergeKinds = options.mergeKinds;
  const debounceMs =
    typeof options.debounceMs === 'number'
      ? options.debounceMs
      : DEFAULT_DEBOUNCE_MS;
  const log = options.log !== false;

  let metadataWatcher = null;
  let closed = false;

  const queue = createSpecTaskQueue({
    debounceMs,
    runTask: async (batch) => {
      await executeBatch(batch);
    },
    onError: (err, batch) => {
      reportFailure(err, batch);
    },
    onBatch: (batch) => {
      if (!log) {
        return;
      }
      if (batch.kind === 'COLLECT_AND_BUILD') {
        console.log('[JSKim] 画面設計書の変更を検知しました。');
        console.log('[JSKim] 収集とbuildを実行します。');
      } else {
        console.log('[JSKim] 説明dataの変更を検知しました。');
        console.log('[JSKim] viewerのみをbuildします。');
      }
      if (batch.paths.length > 0) {
        console.log(`[JSKim] 変更ファイル: ${batch.paths.length} 件`);
        for (const filePath of batch.paths.slice(0, 8)) {
          console.log(`- ${toDisplayPath(filePath, workspaceRoot)}`);
        }
        if (batch.paths.length > 8) {
          console.log(`- ...他 ${batch.paths.length - 8} 件`);
        }
      }
    },
  });

  async function executeBatch(batch) {
    if (closed) {
      return;
    }

    if (batch.kind === 'COLLECT_AND_BUILD') {
      await runScreenSpecCollect({
        project,
        workspaceRoot,
        projectName,
        collectScreenSpecProject,
        log,
      });
      if (log) {
        console.log('[JSKim] 画面設計書viewerをbuildしています。');
      }
      await buildViewer({
        rootDir: workspaceRoot,
        projectName,
        base: '/spec/',
      });
    } else if (batch.kind === 'BUILD_ONLY') {
      if (log) {
        console.log('[JSKim] 画面設計書viewerをbuildしています。');
      }
      await buildViewer({
        rootDir: workspaceRoot,
        projectName,
        base: '/spec/',
      });
    } else {
      return;
    }

    if (closed) {
      return;
    }

    if (typeof broadcastSpecReload === 'function') {
      broadcastSpecReload();
    }
    if (log) {
      console.log('[JSKim] 画面設計書viewerを更新しました。');
    }
  }

  function reportFailure(err, batch) {
    const message = formatSpecError(err);
    console.error('[JSKim] 画面設計書の更新に失敗しました。');
    console.error(`作業: ${batch.kind}`);
    console.error(`プロジェクト: ${projectName}`);
    if (batch.paths && batch.paths.length > 0) {
      console.error('変更ファイル:');
      for (const filePath of batch.paths.slice(0, 12)) {
        console.error(`- ${toDisplayPath(filePath, workspaceRoot)}`);
      }
    }
    if (err && err.code) {
      console.error(`code: ${err.code}`);
    }
    if (err && err.screenId) {
      console.error(`screen: ${err.screenId}`);
    }
    if (err && err.stateId) {
      console.error(`state: ${err.stateId}`);
    }
    if (err && err.actionId) {
      console.error(`action: ${err.actionId}`);
    }
    console.error(message);
    console.error(
      '[JSKim] 直前の正常な画面設計書を継続します。次の変更で再試行します。'
    );
  }

  /**
   * project watcher の build:success 後に呼ぶ。
   * @param {{ events?: Array<{ path?: string, filePath?: string }>, initial?: boolean }} payload
   */
  function handleSourceBuildSuccess(payload = {}) {
    if (closed || payload.initial) {
      return;
    }
    const events = Array.isArray(payload.events) ? payload.events : [];
    const paths = [];
    const kinds = [];
    for (const event of events) {
      const filePath =
        event &&
        (event.absolutePath || event.path || event.filePath || event.file);
      if (!filePath) {
        continue;
      }
      // display path の場合は workspaceRoot 基準に戻す
      const absolute =
        path.isAbsolute(filePath) || /^[a-zA-Z]:[\\/]/.test(filePath)
          ? filePath
          : path.join(workspaceRoot, filePath);
      const kind = classifyPath({
        rootDir: workspaceRoot,
        projectName,
        sourceDir: project.sourceDir,
        filePath: absolute,
      });
      kinds.push(kind);
      if (kind !== 'IGNORE') {
        paths.push(absolute);
      }
    }

    const merged = mergeKinds(kinds);
    if (merged === 'IGNORE' || paths.length === 0) {
      return;
    }
    queue.enqueue(paths, merged);
  }

  /**
   * Description / theme 変更を直接 enqueue。
   * @param {string} filePath
   * @param {string} [eventName]
   */
  function handleMetadataChange(filePath, eventName) {
    if (closed || !filePath) {
      return;
    }
    const kind = classifyPath({
      rootDir: workspaceRoot,
      projectName,
      sourceDir: project.sourceDir,
      filePath,
    });
    if (kind !== 'BUILD_ONLY') {
      return;
    }
    queue.enqueue([filePath], 'BUILD_ONLY');
    void eventName;
  }

  function startMetadataWatching() {
    if (metadataWatcher || closed) {
      return;
    }

    const dataDir = path.join(
      workspaceRoot,
      'spec',
      projectName,
      'src',
      'data'
    );
    const themeDir = path.join(
      workspaceRoot,
      'spec',
      projectName,
      'src',
      'theme'
    );
    const capturesDir = path.join(
      workspaceRoot,
      'spec',
      projectName,
      'src',
      'captures'
    );
    const referencesDir = path.join(
      workspaceRoot,
      'spec',
      projectName,
      'src',
      'references'
    );

    const watchRoots = [dataDir, themeDir, capturesDir, referencesDir];

    metadataWatcher = chokidar.watch(watchRoots, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 50,
        pollInterval: 25,
      },
      ignored: [
        /(^|[/\\])node_modules([/\\]|$)/,
        /(^|[/\\])snapshots([/\\]|$)/,
        /(^|[/\\])resources([/\\]|$)/,
        /(^|[/\\])dist([/\\]|$)/,
        // captures: generation PNG / TEMP / backup のみ無視（meta.json は監視）
        /[/\\]captures[/\\].*[/\\]capture-[0-9a-f]{64}\.png$/i,
        /[/\\]captures[/\\].*\.tmp$/i,
        /[/\\]captures[/\\].*\.bak(?:-|$)/i,
        /[/\\]captures[/\\].*[/\\]\./,
        // references: generation PNG / TEMP / backup のみ無視（meta.json は監視）
        /[/\\]references[/\\].*[/\\]reference-[0-9a-f]{64}\.png$/i,
        /[/\\]references[/\\].*\.tmp$/i,
        /[/\\]references[/\\].*\.bak(?:-|$)/i,
        /[/\\]references[/\\].*[/\\]\./,
      ],
    });

    metadataWatcher.on('all', (eventName, filePath) => {
      if (
        eventName === 'add' ||
        eventName === 'change' ||
        eventName === 'unlink' ||
        eventName === 'addDir' ||
        eventName === 'unlinkDir'
      ) {
        handleMetadataChange(filePath, eventName);
      }
    });

    metadataWatcher.on('error', (err) => {
      const message = err && err.message ? err.message : String(err);
      console.error(`[JSKim] 画面設計書メタデータの監視エラー: ${message}`);
    });
  }

  async function close() {
    if (closed) {
      return;
    }
    closed = true;
    if (metadataWatcher) {
      try {
        await metadataWatcher.close();
      } catch {
        // ignore
      }
      metadataWatcher = null;
    }
    await queue.close();
  }

  return {
    startMetadataWatching,
    handleSourceBuildSuccess,
    handleMetadataChange,
    enqueue: queue.enqueue,
    close,
    getState: queue.getState,
  };
}

function formatSpecError(err) {
  if (err == null) {
    return String(err);
  }
  if (typeof err === 'string') {
    return err;
  }
  if (typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}

function toDisplayPath(abs, workspaceRoot) {
  const rel = path.relative(workspaceRoot, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return String(abs).split(path.sep).join('/');
  }
  return rel.split(path.sep).join('/');
}

module.exports = {
  createSpecDevOrchestrator,
  DEFAULT_DEBOUNCE_MS,
};
