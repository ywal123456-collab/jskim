'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createTestWorkspace } = require('./helpers/create-test-workspace');
const { loadConfig } = require('../scripts/lib/load-config');
const { resolveProject } = require('../scripts/lib/resolve-project');
const {
  createProjectWatcher,
  JSKIM_WATCHER_CLOSED_BEFORE_READY,
} = require('../scripts/lib/create-project-watcher');
const { waitFor } = require('./helpers/wait-for-output');

/**
 * 手動で ready/error/close を制御する chokidar 代替。
 */
function createControllableWatchFactory() {
  /** @type {(import('node:events').EventEmitter & { close: Function }) | null} */
  let current = null;
  let closeCount = 0;
  let listenerCounts = () => ({ ready: 0, error: 0, all: 0 });

  function watchFactory() {
    const watcher = new EventEmitter();
    watcher.close = async () => {
      closeCount += 1;
      watcher.removeAllListeners();
    };
    current = watcher;
    listenerCounts = () => ({
      ready: watcher.listenerCount('ready'),
      error: watcher.listenerCount('error'),
      all: watcher.listenerCount('all'),
    });
    return watcher;
  }

  return {
    watchFactory,
    emitReady() {
      assert.ok(current, 'watcher not created');
      current.emit('ready');
    },
    emitError(err) {
      assert.ok(current, 'watcher not created');
      current.emit('error', err);
    },
    getWatcher() {
      return current;
    },
    closeCount() {
      return closeCount;
    },
    listenerCounts() {
      return listenerCounts();
    },
  };
}

function createMinimalProject(workspaceRoot) {
  const { config } = loadConfig(workspaceRoot);
  return resolveProject({
    config,
    workspaceRoot,
    projectName: 'sample',
    commandName: 'watch',
    usageLine: 'node scripts/watch.js <project>',
  });
}

describe('project watcher ready', { timeout: 60000 }, () => {
  const workspaces = [];
  const watchers = [];

  after(async () => {
    for (const watcher of watchers) {
      // eslint-disable-next-line no-await-in-loop
      await watcher.close().catch(() => {});
    }
    for (const ws of workspaces) {
      // eslint-disable-next-line no-await-in-loop
      await ws.cleanup();
    }
  });

  it('ready 正常 → start resolve', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);
    const fake = createControllableWatchFactory();
    const watcher = createProjectWatcher(createMinimalProject(ws.workspaceRoot), {
      runInitialBuild: false,
      logChanges: false,
      watchFactory: fake.watchFactory,
    });
    watchers.push(watcher);

    let readyCount = 0;
    watcher.on('ready', () => {
      readyCount += 1;
    });

    const startPromise = watcher.start();
    await waitFor(() => fake.getWatcher() != null, {
      timeoutMs: 2000,
      label: 'fake watcher created',
    });
    fake.emitReady();
    await startPromise;
    assert.equal(readyCount, 1);
  });

  it('start() 完了直後の source 変更を ignoreInitial で取りこぼさない', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: { watch: { debounce: 40 } },
      },
    });
    workspaces.push(ws);

    const watcher = createProjectWatcher(createMinimalProject(ws.workspaceRoot), {
      runInitialBuild: true,
      logChanges: false,
    });
    watchers.push(watcher);

    let rebuildSuccess = 0;
    watcher.on('build:success', ({ initial }) => {
      if (!initial) {
        rebuildSuccess += 1;
      }
    });

    await watcher.start();

    const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');
    const distIndex = path.join(ws.workspaceRoot, 'dist/sample/index.html');
    let source = await fsp.readFile(indexPath, 'utf8');
    source = source.includes('INDEX_OK')
      ? source.replace('INDEX_OK', 'READY_RACE_OK')
      : `${source}\n<!-- READY_RACE_OK -->\n`;
    await fsp.writeFile(indexPath, source, 'utf8');

    await waitFor(() => rebuildSuccess >= 1, {
      timeoutMs: 15000,
      label: 'rebuild after immediate post-ready write',
    });
    const dist = await fsp.readFile(distIndex, 'utf8');
    assert.match(dist, /READY_RACE_OK/);
  });

  it('A: error-before-ready は start を 1 回だけ reject し EventEmitter throw しない', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);

    const fake = createControllableWatchFactory();
    const watcher = createProjectWatcher(createMinimalProject(ws.workspaceRoot), {
      runInitialBuild: false,
      logChanges: false,
      watchFactory: fake.watchFactory,
    });
    watchers.push(watcher);

    let readyCount = 0;
    let runtimeErrorCount = 0;
    watcher.on('ready', () => {
      readyCount += 1;
    });
    watcher.on('error', () => {
      runtimeErrorCount += 1;
    });

    const boom = new Error('injected chokidar startup error');
    boom.code = 'JSKIM_TEST_WATCH_ERROR';

    const startPromise = watcher.start();
    await waitFor(() => fake.getWatcher() != null, {
      timeoutMs: 2000,
      label: 'fake watcher created',
    });

    let uncaught = null;
    const onUncaught = (err) => {
      uncaught = err;
    };
    process.once('uncaughtException', onUncaught);
    try {
      fake.emitError(boom);
      await assert.rejects(
        () => startPromise,
        (err) => {
          assert.equal(err, boom);
          return true;
        }
      );
    } finally {
      process.off('uncaughtException', onUncaught);
    }

    await waitFor(() => fake.closeCount() >= 1, {
      timeoutMs: 2000,
      label: 'watcher closed after startup error',
    });

    assert.equal(uncaught, null);
    assert.equal(readyCount, 0);
    assert.equal(runtimeErrorCount, 0);
    assert.equal(fake.listenerCounts().ready, 0);
  });

  it('B: close-before-ready は start を settle し永久 pending にしない', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);

    const fake = createControllableWatchFactory();
    const watcher = createProjectWatcher(createMinimalProject(ws.workspaceRoot), {
      runInitialBuild: false,
      logChanges: false,
      watchFactory: fake.watchFactory,
    });
    watchers.push(watcher);

    let readyCount = 0;
    watcher.on('ready', () => {
      readyCount += 1;
    });

    const startPromise = watcher.start();
    await waitFor(() => fake.getWatcher() != null, {
      timeoutMs: 2000,
      label: 'fake watcher created',
    });

    await watcher.close();

    await assert.rejects(
      () => startPromise,
      (err) => {
        assert.equal(err && err.code, JSKIM_WATCHER_CLOSED_BEFORE_READY);
        assert.match(String(err.message), /監視開始前にwatcherが終了/);
        return true;
      }
    );
    assert.equal(readyCount, 0);
    assert.equal(fake.closeCount() >= 1, true);
    assert.equal(fake.listenerCounts().ready, 0);
    assert.equal(fake.listenerCounts().error, 0);

    // close 後は listener が外れているので late ready は JSKim ready を増やさない
    fake.emitReady();
    assert.equal(readyCount, 0);

    await watcher.close();
    assert.equal(fake.closeCount() >= 1, true);
  });

  it('ready 後 runtime error は error listener へ伝達する', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);
    const fake = createControllableWatchFactory();
    const watcher = createProjectWatcher(createMinimalProject(ws.workspaceRoot), {
      runInitialBuild: false,
      logChanges: false,
      watchFactory: fake.watchFactory,
    });
    watchers.push(watcher);

    /** @type {Error | null} */
    let seen = null;
    watcher.on('error', (err) => {
      seen = err;
    });

    const startPromise = watcher.start();
    await waitFor(() => fake.getWatcher() != null, {
      timeoutMs: 2000,
      label: 'fake watcher created',
    });
    fake.emitReady();
    await startPromise;

    const runtimeErr = new Error('runtime watch error');
    fake.emitError(runtimeErr);
    assert.equal(seen, runtimeErr);
  });

  it('close after ready は正常終了する', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);
    const fake = createControllableWatchFactory();
    const watcher = createProjectWatcher(createMinimalProject(ws.workspaceRoot), {
      runInitialBuild: false,
      logChanges: false,
      watchFactory: fake.watchFactory,
    });
    watchers.push(watcher);

    const startPromise = watcher.start();
    await waitFor(() => fake.getWatcher() != null, {
      timeoutMs: 2000,
      label: 'fake watcher created',
    });
    fake.emitReady();
    await startPromise;
    await watcher.close();
    await watcher.close();
    assert.equal(fake.closeCount(), 1);
  });
});
