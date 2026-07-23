'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createTestWorkspace } = require('./helpers/create-test-workspace');
const { loadConfig } = require('../scripts/lib/load-config');
const { resolveProject } = require('../scripts/lib/resolve-project');
const { createProjectWatcher } = require('../scripts/lib/create-project-watcher');
const { runBuild } = require('../scripts/lib/build-project');
const { waitFor } = require('./helpers/wait-for-output');

function createControllableWatchFactory() {
  /** @type {(import('node:events').EventEmitter & { close: Function }) | null} */
  let current = null;

  function watchFactory() {
    const watcher = new EventEmitter();
    watcher.close = async () => {
      watcher.removeAllListeners();
    };
    current = watcher;
    return watcher;
  }

  return {
    watchFactory,
    emitReady() {
      assert.ok(current);
      current.emit('ready');
    },
    emitChange(filePath) {
      assert.ok(current);
      current.emit('all', 'change', filePath);
    },
  };
}

function createManualDebounce() {
  /** @type {Function | null} */
  let callback = null;
  const timerToken = { id: 'manual-debounce' };

  return {
    scheduleDebouncedBuild(cb) {
      callback = cb;
      return timerToken;
    },
    clearDebouncedBuild(timer) {
      if (timer === timerToken) {
        callback = null;
      }
    },
    flush() {
      assert.ok(callback, 'no debounced callback');
      const cb = callback;
      callback = null;
      cb();
    },
    get pending() {
      return callback != null;
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

function createBuildGate() {
  let concurrent = 0;
  let maxConcurrent = 0;
  let buildCount = 0;
  /** @type {Array<() => void>} */
  const releases = [];
  /** @type {Array<Promise<void>>} */
  const started = [];

  function executeBuildImpl({ initial, project }) {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    buildCount += 1;

    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    releases.push(release);
    let resolveStarted;
    started.push(
      new Promise((resolve) => {
        resolveStarted = resolve;
      })
    );
    resolveStarted();

    return (async () => {
      try {
        await gate;
        return runBuild(project, {
          logTitle: initial ? 'ビルドが完了しました' : '再ビルドが完了しました',
          includeOutput: initial,
        });
      } finally {
        concurrent -= 1;
      }
    })();
  }

  return {
    executeBuildImpl,
    get maxConcurrent() {
      return maxConcurrent;
    },
    get buildCount() {
      return buildCount;
    },
    get concurrent() {
      return concurrent;
    },
    async waitForBuildStart(n) {
      await waitFor(() => started.length >= n, {
        timeoutMs: 5000,
        label: `build start ${n}`,
      });
    },
    release(n) {
      const fn = releases[n - 1];
      assert.ok(fn, `no build ${n} to release`);
      fn();
    },
    releaseAll() {
      for (const fn of releases) {
        fn();
      }
    },
  };
}

async function startReadyWatcher(project, options) {
  const fake = createControllableWatchFactory();
  const watcher = createProjectWatcher(project, {
    runInitialBuild: false,
    logChanges: false,
    watchFactory: fake.watchFactory,
    ...options,
  });
  const startPromise = watcher.startWatching();
  queueMicrotask(() => {
    fake.emitReady();
  });
  await startPromise;
  return { watcher, fake };
}

describe('project watcher build queue', { timeout: 60000 }, () => {
  const workspaces = [];
  const watchers = [];
  /** @type {Array<{ releaseAll: Function }>} */
  const gates = [];

  after(async () => {
    for (const gate of gates) {
      gate.releaseAll();
    }
    for (const watcher of watchers) {
      // eslint-disable-next-line no-await-in-loop
      await watcher.close().catch(() => {});
    }
    for (const ws of workspaces) {
      // eslint-disable-next-line no-await-in-loop
      await ws.cleanup();
    }
  });

  it('runInitialBuild は follow-up drain まで resolve しない', async () => {
    const ws = await createTestWorkspace({
      configOverrides: { defaults: { watch: { debounce: 0 } } },
    });
    workspaces.push(ws);
    const project = createMinimalProject(ws.workspaceRoot);
    const gate = createBuildGate();
    gates.push(gate);
    const { watcher, fake } = await startReadyWatcher(project, {
      executeBuildImpl: gate.executeBuildImpl,
    });
    watchers.push(watcher);

    let settled = false;
    const initialPromise = watcher.runInitialBuild().then((result) => {
      settled = true;
      return result;
    });

    await gate.waitForBuildStart(1);
    const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');
    await fsp.writeFile(
      indexPath,
      '{% extends "layouts/base.njk" %}{% block content %}DRAIN_LATEST{% endblock %}\n',
      'utf8'
    );
    fake.emitChange(indexPath);

    await waitFor(
      () => gate.buildCount >= 2 || gate.maxConcurrent >= 2,
      { timeoutMs: 1000, label: 'pending follow-up scheduled' }
    ).catch(() => {});

    gate.release(1);
    await gate.waitForBuildStart(2);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(settled, false, 'must not resolve before follow-up drain');
    assert.equal(gate.maxConcurrent, 1);

    gate.release(2);
    const result = await initialPromise;
    assert.equal(settled, true);
    assert.ok(result);
    assert.equal(gate.buildCount, 2);
    assert.equal(gate.maxConcurrent, 1);
    assert.match(
      await fsp.readFile(
        path.join(ws.workspaceRoot, 'dist/sample/index.html'),
        'utf8'
      ),
      /DRAIN_LATEST/
    );
  });

  it('three-build chain は third 完了まで runInitialBuild が pending', async () => {
    const ws = await createTestWorkspace({
      configOverrides: { defaults: { watch: { debounce: 0 } } },
    });
    workspaces.push(ws);
    const project = createMinimalProject(ws.workspaceRoot);
    const gate = createBuildGate();
    gates.push(gate);
    const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');
    const { watcher, fake } = await startReadyWatcher(project, {
      executeBuildImpl: gate.executeBuildImpl,
    });
    watchers.push(watcher);

    let settled = false;
    const initialPromise = watcher.runInitialBuild().then((result) => {
      settled = true;
      return result;
    });

    await gate.waitForBuildStart(1);
    await fsp.writeFile(
      indexPath,
      '{% extends "layouts/base.njk" %}{% block content %}CHANGE_A{% endblock %}\n',
      'utf8'
    );
    fake.emitChange(indexPath);
    await waitFor(() => gate.buildCount >= 2 || gate.maxConcurrent >= 2, {
      timeoutMs: 500,
      label: 'A pending',
    }).catch(() => {});

    gate.release(1);
    await gate.waitForBuildStart(2);
    assert.equal(settled, false);

    await fsp.writeFile(
      indexPath,
      '{% extends "layouts/base.njk" %}{% block content %}CHANGE_B{% endblock %}\n',
      'utf8'
    );
    fake.emitChange(indexPath);
    await waitFor(() => gate.buildCount >= 3 || gate.maxConcurrent >= 2, {
      timeoutMs: 500,
      label: 'B pending',
    }).catch(() => {});
    assert.equal(gate.buildCount, 2);
    assert.equal(gate.maxConcurrent, 1);

    gate.release(2);
    await gate.waitForBuildStart(3);
    await Promise.resolve();
    assert.equal(settled, false, 'must wait for third build');
    assert.equal(gate.maxConcurrent, 1);

    gate.release(3);
    await initialPromise;
    assert.equal(settled, true);
    assert.match(
      await fsp.readFile(
        path.join(ws.workspaceRoot, 'dist/sample/index.html'),
        'utf8'
      ),
      /CHANGE_B/
    );
  });

  it('debounce pending 中は initial resolve しない', async () => {
    const ws = await createTestWorkspace({
      configOverrides: { defaults: { watch: { debounce: 50 } } },
    });
    workspaces.push(ws);
    const project = createMinimalProject(ws.workspaceRoot);
    const gate = createBuildGate();
    gates.push(gate);
    const debounce = createManualDebounce();
    const { watcher, fake } = await startReadyWatcher(project, {
      executeBuildImpl: gate.executeBuildImpl,
      scheduleDebouncedBuild: debounce.scheduleDebouncedBuild,
      clearDebouncedBuild: debounce.clearDebouncedBuild,
    });
    watchers.push(watcher);

    let settled = false;
    const initialPromise = watcher.runInitialBuild().then((result) => {
      settled = true;
      return result;
    });

    await gate.waitForBuildStart(1);
    const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');
    await fsp.writeFile(
      indexPath,
      '{% extends "layouts/base.njk" %}{% block content %}DEBOUNCE_OK{% endblock %}\n',
      'utf8'
    );
    fake.emitChange(indexPath);
    assert.equal(debounce.pending, true);

    gate.release(1);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(settled, false, 'debounce timer keeps queue non-drained');
    assert.equal(gate.buildCount, 1);

    debounce.flush();
    await gate.waitForBuildStart(2);
    assert.equal(settled, false);
    gate.release(2);
    await initialPromise;
    assert.equal(settled, true);
    assert.match(
      await fsp.readFile(
        path.join(ws.workspaceRoot, 'dist/sample/index.html'),
        'utf8'
      ),
      /DEBOUNCE_OK/
    );
  });

  it('initial failure → follow-up success の最終結果は success', async () => {
    const ws = await createTestWorkspace({
      configOverrides: { defaults: { watch: { debounce: 0 } } },
    });
    workspaces.push(ws);
    const project = createMinimalProject(ws.workspaceRoot);
    const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');

    let concurrent = 0;
    let maxConcurrent = 0;
    let buildCount = 0;
    /** @type {Array<() => void>} */
    const releases = [];
    const releaseAll = () => {
      for (const fn of releases) {
        fn();
      }
    };
    gates.push({ releaseAll });

    const { watcher, fake } = await startReadyWatcher(project, {
      async executeBuildImpl({ initial, project: buildProject }) {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        buildCount += 1;
        const index = buildCount;
        const gate = new Promise((resolve) => {
          releases.push(resolve);
        });
        try {
          await gate;
          if (index === 1) {
            throw new Error('injected initial build failure');
          }
          return runBuild(buildProject, {
            logTitle: initial ? 'ビルドが完了しました' : '再ビルドが完了しました',
            includeOutput: initial,
          });
        } finally {
          concurrent -= 1;
        }
      },
    });
    watchers.push(watcher);

    const initialPromise = watcher.runInitialBuild();
    await waitFor(() => buildCount >= 1, {
      timeoutMs: 5000,
      label: 'failing initial started',
    });

    await fsp.writeFile(
      indexPath,
      '{% extends "layouts/base.njk" %}{% block content %}RECOVERED_OK{% endblock %}\n',
      'utf8'
    );
    fake.emitChange(indexPath);
    await waitFor(() => buildCount >= 2 || maxConcurrent >= 2, {
      timeoutMs: 500,
      label: 'recovery pending',
    }).catch(() => {});

    releases[0]();
    await waitFor(() => buildCount >= 2, {
      timeoutMs: 5000,
      label: 'recovery build started',
    });
    releases[1]();
    const result = await initialPromise;
    assert.ok(result, 'final result should be recovered success');
    assert.equal(maxConcurrent, 1);
    assert.match(
      await fsp.readFile(
        path.join(ws.workspaceRoot, 'dist/sample/index.html'),
        'utf8'
      ),
      /RECOVERED_OK/
    );
  });

  it('initial success → follow-up failure の最終結果は failure', async () => {
    const ws = await createTestWorkspace({
      configOverrides: { defaults: { watch: { debounce: 0 } } },
    });
    workspaces.push(ws);
    const project = createMinimalProject(ws.workspaceRoot);
    const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');

    let buildCount = 0;
    /** @type {Array<() => void>} */
    const releases = [];
    gates.push({
      releaseAll() {
        for (const fn of releases) {
          fn();
        }
      },
    });

    const { watcher, fake } = await startReadyWatcher(project, {
      async executeBuildImpl({ initial, project: buildProject }) {
        buildCount += 1;
        const index = buildCount;
        const gate = new Promise((resolve) => {
          releases.push(resolve);
        });
        await gate;
        if (index === 2) {
          throw new Error('injected follow-up failure');
        }
        return runBuild(buildProject, {
          logTitle: initial ? 'ビルドが完了しました' : '再ビルドが完了しました',
          includeOutput: initial,
        });
      },
    });
    watchers.push(watcher);

    const initialPromise = watcher.runInitialBuild();
    await waitFor(() => buildCount >= 1, {
      timeoutMs: 5000,
      label: 'initial started',
    });
    fake.emitChange(indexPath);
    await waitFor(() => buildCount >= 2, {
      timeoutMs: 1000,
      label: 'follow-up started or pending',
    }).catch(() => {});

    releases[0]();
    await waitFor(() => buildCount >= 2, {
      timeoutMs: 5000,
      label: 'follow-up running',
    });
    releases[1]();
    const result = await initialPromise;
    assert.equal(result, null);
  });

  it('pending なしなら initial 1 回で drain する', async () => {
    const ws = await createTestWorkspace({
      configOverrides: { defaults: { watch: { debounce: 0 } } },
    });
    workspaces.push(ws);
    const project = createMinimalProject(ws.workspaceRoot);
    const gate = createBuildGate();
    gates.push(gate);
    const { watcher } = await startReadyWatcher(project, {
      executeBuildImpl: gate.executeBuildImpl,
    });
    watchers.push(watcher);

    const initialPromise = watcher.runInitialBuild();
    await gate.waitForBuildStart(1);
    gate.release(1);
    const result = await initialPromise;
    assert.ok(result);
    assert.equal(gate.buildCount, 1);
  });

  it('runInitialBuild 同時呼び出しは同じ Promise を共有し重複しない', async () => {
    const ws = await createTestWorkspace({
      configOverrides: { defaults: { watch: { debounce: 0 } } },
    });
    workspaces.push(ws);
    const project = createMinimalProject(ws.workspaceRoot);
    const gate = createBuildGate();
    gates.push(gate);
    const { watcher } = await startReadyWatcher(project, {
      executeBuildImpl: gate.executeBuildImpl,
    });
    watchers.push(watcher);

    const a = watcher.runInitialBuild();
    const b = watcher.runInitialBuild();
    assert.equal(a, b);
    await gate.waitForBuildStart(1);
    assert.equal(gate.buildCount, 1);
    gate.release(1);
    await a;
    await b;

    const c = watcher.runInitialBuild();
    assert.equal(await c, null);
    assert.equal(gate.buildCount, 1);
  });
});
