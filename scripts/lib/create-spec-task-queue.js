'use strict';

/**
 * Screen Spec collect/build 用の debounce + 直列 task queue。
 *
 * 状態: idle → running →（pending があれば再実行）→ idle / closed
 * 同時に 2 つの collect/build を走らせない。
 *
 * @param {object} options
 * @param {number} [options.debounceMs=100]
 * @param {(batch: { kind: string, paths: string[] }) => Promise<void>} options.runTask
 * @param {(error: unknown, batch: { kind: string, paths: string[] }) => void} [options.onError]
 * @param {(batch: { kind: string, paths: string[] }) => void} [options.onBatch]
 */
function createSpecTaskQueue(options = {}) {
  const debounceMs =
    typeof options.debounceMs === 'number' && options.debounceMs >= 0
      ? options.debounceMs
      : 100;
  const runTask = options.runTask;
  const onError = options.onError;
  const onBatch = options.onBatch;

  if (typeof runTask !== 'function') {
    throw new Error('[JSKim] createSpecTaskQueue には runTask が必要です。');
  }

  /** @type {'idle'|'running'|'closed'} */
  let state = 'idle';
  let debounceTimer = null;
  /** @type {{ kind: 'COLLECT_AND_BUILD'|'BUILD_ONLY'|null, paths: string[], pathSet: Set<string> }} */
  let pending = createEmptyPending();
  let closed = false;
  let drainPromise = null;

  function createEmptyPending() {
    return {
      kind: null,
      paths: [],
      pathSet: new Set(),
    };
  }

  /**
   * @param {string[]} paths
   * @param {'COLLECT_AND_BUILD'|'BUILD_ONLY'} kind
   */
  function enqueue(paths, kind) {
    if (closed || state === 'closed') {
      return;
    }
    if (kind !== 'COLLECT_AND_BUILD' && kind !== 'BUILD_ONLY') {
      return;
    }

    const list = Array.isArray(paths) ? paths : [paths];
    for (const p of list) {
      if (!p || typeof p !== 'string') {
        continue;
      }
      const key = normalizePathKey(p);
      if (pending.pathSet.has(key)) {
        continue;
      }
      pending.pathSet.add(key);
      pending.paths.push(p);
    }

    pending.kind = mergeKind(pending.kind, kind);

    if (state === 'running') {
      // 実行中の変更は pending に溜め、完了後に 1 回だけ再実行
      return;
    }

    scheduleFlush();
  }

  function scheduleFlush() {
    if (closed || state !== 'idle') {
      return;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void drain();
    }, debounceMs);
    if (typeof debounceTimer.unref === 'function') {
      debounceTimer.unref();
    }
  }

  async function drain() {
    if (closed || state !== 'idle') {
      return;
    }
    if (!pending.kind || pending.paths.length === 0) {
      return;
    }

    const batch = {
      kind: pending.kind,
      paths: pending.paths.slice(),
    };
    pending = createEmptyPending();

    if (typeof onBatch === 'function') {
      onBatch(batch);
    }

    state = 'running';
    drainPromise = (async () => {
      try {
        await runTask(batch);
      } catch (err) {
        if (typeof onError === 'function') {
          onError(err, batch);
        } else {
          throw err;
        }
      } finally {
        state = closed ? 'closed' : 'idle';
        drainPromise = null;
      }

      if (closed) {
        return;
      }
      if (pending.kind && pending.paths.length > 0) {
        // 実行中に溜まった最新 batch を即座に 1 回実行（追加 debounce なし）
        await drain();
      }
    })();

    await drainPromise;
  }

  async function close() {
    closed = true;
    state = 'closed';
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    pending = createEmptyPending();
    if (drainPromise) {
      try {
        await drainPromise;
      } catch {
        // 終了時は無視
      }
    }
  }

  function getState() {
    if (closed) {
      return 'closed';
    }
    if (state === 'running') {
      return pending.kind ? 'rerunRequested' : 'running';
    }
    return 'idle';
  }

  return {
    enqueue,
    close,
    getState,
    get pendingPathCount() {
      return pending.paths.length;
    },
  };
}

/**
 * @param {'COLLECT_AND_BUILD'|'BUILD_ONLY'|null} current
 * @param {'COLLECT_AND_BUILD'|'BUILD_ONLY'} next
 */
function mergeKind(current, next) {
  if (current === 'COLLECT_AND_BUILD' || next === 'COLLECT_AND_BUILD') {
    return 'COLLECT_AND_BUILD';
  }
  return 'BUILD_ONLY';
}

function normalizePathKey(filePath) {
  const value = String(filePath).replace(/\\/g, '/');
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

module.exports = {
  createSpecTaskQueue,
};
