'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fsp = require('node:fs/promises');
const path = require('node:path');
const fse = require('fs-extra');
const { createTestWorkspace } = require('./helpers/create-test-workspace');
const { createWatchRuntime } = require('../scripts/lib/create-watch-runtime');
const { createProjectWatcher } = require('../scripts/lib/create-project-watcher');
const { runBuild } = require('../scripts/lib/build-project');
const { waitFor } = require('./helpers/wait-for-output');
const { getFreePort } = require('./helpers/get-free-port');
const {
  collectOutputManifest,
  assertManifestEqual,
} = require('./helpers/output-manifest');

/**
 * 手動 ready/error 制御用 chokidar 代替。
 */
function createControllableWatchFactory() {
  /** @type {(import('node:events').EventEmitter & { close: Function }) | null} */
  let current = null;
  let closeCount = 0;

  function watchFactory() {
    const watcher = new EventEmitter();
    watcher.close = async () => {
      closeCount += 1;
      watcher.removeAllListeners();
    };
    current = watcher;
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
    emitChange(filePath) {
      assert.ok(current, 'watcher not created');
      current.emit('all', 'change', filePath);
    },
    getWatcher() {
      return current;
    },
    closeCount() {
      return closeCount;
    },
  };
}

/**
 * projectWatcherFactory seam: 呼び出し順に ready / error-before-ready を制御する。
 */
function createSequencedProjectWatcherFactory(outcomes) {
  let index = 0;
  /** @type {Array<object>} */
  const created = [];

  function projectWatcherFactory(project, options = {}) {
    const outcome = outcomes[index] || { type: 'ready' };
    index += 1;
    const fake = createControllableWatchFactory();
    const watchFactory = (paths, watchOptions) => {
      const watcher = fake.watchFactory(paths, watchOptions);
      queueMicrotask(() => {
        Promise.resolve()
          .then(async () => {
            if (typeof outcome.beforeSettle === 'function') {
              await outcome.beforeSettle({ project, outcome, fake });
            }
            if (outcome.type === 'ready') {
              fake.emitReady();
            } else {
              const err =
                outcome.error ||
                Object.assign(new Error('injected candidate/rollback failure'), {
                  code: 'JSKIM_TEST_WATCH_START_FAIL',
                });
              fake.emitError(err);
            }
          })
          .catch((err) => {
            fake.emitError(err);
          });
      });
      return watcher;
    };

    const watcher = createProjectWatcher(project, {
      ...options,
      watchFactory,
      ...(typeof outcome.executeBuildImpl === 'function'
        ? { executeBuildImpl: outcome.executeBuildImpl }
        : {}),
    });
    const record = {
      outcome,
      project,
      watcher,
      fake,
      closed: false,
      initialBuildStarts: 0,
      initialBuildSuccesses: 0,
      initialBuildFailures: 0,
    };
    watcher.on('build:start', ({ initial }) => {
      if (initial) {
        record.initialBuildStarts += 1;
      }
    });
    watcher.on('build:success', ({ initial }) => {
      if (initial) {
        record.initialBuildSuccesses += 1;
      }
    });
    watcher.on('build:failure', ({ initial }) => {
      if (initial) {
        record.initialBuildFailures += 1;
      }
    });
    const originalClose = watcher.close.bind(watcher);
    watcher.close = async () => {
      record.closed = true;
      await originalClose();
    };
    created.push(record);
    return watcher;
  }

  return {
    projectWatcherFactory,
    created,
    get createCount() {
      return created.length;
    },
  };
}

function captureConsole() {
  const lines = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => {
    lines.push(args.map(String).join(' '));
    origLog(...args);
  };
  console.error = (...args) => {
    lines.push(args.map(String).join(' '));
    origErr(...args);
  };
  return {
    lines,
    output() {
      return lines.join('\n');
    },
    restore() {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

async function writeCleanFalseConfig(workspaceRoot, values) {
  const configPath = path.join(workspaceRoot, 'jskim.config.js');
  const port = values.port != null ? values.port : 3000;
  const body = `module.exports = {
  defaults: {
    render: [
      {
        from: 'pages',
        to: '',
        include: ['**/*.njk'],
        extension: '.html',
      },
    ],
    templates: ['layouts', 'components'],
    copy: [{ from: 'assets', to: 'assets' }],
    build: { clean: false },
    watch: { debounce: ${values.debounce} },
    serve: { host: '127.0.0.1', port: ${port} },
    dev: { liveReload: true },
  },
  projects: {
    sample: {
      sourceDir: ${JSON.stringify(values.sourceDir)},
      outputDir: ${JSON.stringify(values.outputDir)},
    },
  },
};
`;
  delete require.cache[require.resolve(configPath)];
  await fsp.writeFile(configPath, body, 'utf8');
}

async function prepareCleanFalseSources(workspaceRoot) {
  const oldRoot = path.join(workspaceRoot, 'src/sample');
  const altRoot = path.join(workspaceRoot, 'src/sample-alt');
  await fse.copy(oldRoot, altRoot);

  await fsp.writeFile(
    path.join(oldRoot, 'pages/shared.njk'),
    '{% extends "layouts/base.njk" %}{% block content %}SHARED_OLD{% endblock %}\n',
    'utf8'
  );
  await fsp.writeFile(
    path.join(oldRoot, 'pages/old-only.njk'),
    '{% extends "layouts/base.njk" %}{% block content %}OLD_ONLY{% endblock %}\n',
    'utf8'
  );

  await fsp.writeFile(
    path.join(altRoot, 'pages/shared.njk'),
    '{% extends "layouts/base.njk" %}{% block content %}SHARED_CANDIDATE{% endblock %}\n',
    'utf8'
  );
  await fsp.writeFile(
    path.join(altRoot, 'pages/candidate-only.njk'),
    '{% extends "layouts/base.njk" %}{% block content %}CANDIDATE_ONLY{% endblock %}\n',
    'utf8'
  );
  await fse.remove(path.join(altRoot, 'pages/old-only.njk'));

  await writeCleanFalseConfig(workspaceRoot, {
    debounce: 40,
    sourceDir: 'src/sample',
    outputDir: 'dist/sample',
  });
}

describe('config reload watcher transaction', { timeout: 60000 }, () => {
  const workspaces = [];
  const runtimes = [];

  after(async () => {
    for (const runtime of runtimes) {
      // eslint-disable-next-line no-await-in-loop
      await runtime.close().catch(() => {});
    }
    for (const ws of workspaces) {
      // eslint-disable-next-line no-await-in-loop
      await ws.cleanup();
    }
  });

  it('A: candidate startup 失敗 + rollback 成功で clean:false residue を残さない', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 40 },
          build: { clean: false },
        },
      },
    });
    workspaces.push(ws);
    await prepareCleanFalseSources(ws.workspaceRoot);
    const logs = captureConsole();
    const distRoot = path.join(ws.workspaceRoot, 'dist/sample');

    const gapPath = path.join(ws.workspaceRoot, 'src/sample/pages/shared.njk');
    const seq = createSequencedProjectWatcherFactory([
      { type: 'ready' },
      {
        type: 'error',
        async beforeSettle() {
          await fsp.writeFile(
            gapPath,
            '{% extends "layouts/base.njk" %}{% block content %}SHARED_GAP{% endblock %}\n',
            'utf8'
          );
        },
      },
      { type: 'ready' },
    ]);

    const runtime = createWatchRuntime({
      mode: 'watch',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      projectWatcherFactory: seq.projectWatcherFactory,
    });
    runtimes.push(runtime);

    try {
      await runtime.start();
      const oldProject = runtime.project;
      assert.equal(seq.created[0].initialBuildStarts, 1);

      await fsp.writeFile(
        path.join(distRoot, 'external-keep.txt'),
        'KEEP_EXTERNAL',
        'utf8'
      );
      const baseline = await collectOutputManifest(distRoot);
      assert.ok(baseline.has('old-only.html'));
      assert.ok(baseline.has('shared.html'));
      assert.ok(baseline.has('external-keep.txt'));
      assert.equal(baseline.has('candidate-only.html'), false);

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 41,
        sourceDir: 'src/sample-alt',
        outputDir: 'dist/sample',
      });

      await waitFor(
        () => logs.output().includes('以前の設定に戻しました'),
        { timeoutMs: 10000, label: 'rollback success message' }
      );

      assert.equal(seq.createCount, 3);
      assert.equal(seq.created[1].initialBuildStarts, 0, 'candidate build 0');
      assert.equal(seq.created[1].closed, true);
      assert.equal(runtime.getProjectWatcher(), seq.created[2].watcher);
      assert.equal(runtime.project, oldProject);
      assert.equal(runtime.project.sourceDir.includes('sample-alt'), false);
      assert.ok(seq.created[2].initialBuildStarts >= 1, 'rollback build');

      const after = await collectOutputManifest(distRoot);
      assert.equal(after.has('candidate-only.html'), false);
      assert.ok(after.has('old-only.html'));
      assert.ok(after.has('external-keep.txt'));
      assert.match(
        await fsp.readFile(path.join(distRoot, 'shared.html'), 'utf8'),
        /SHARED_GAP/
      );
      assert.equal(
        after.get('external-keep.txt').hash,
        baseline.get('external-keep.txt').hash
      );
      assert.match(logs.output(), /以前の設定に戻しました/);
      assert.equal(logs.output().includes('以前の正常な設定を継続します'), false);

      let rebuilds = 0;
      runtime.getProjectWatcher().on('build:success', ({ initial }) => {
        if (!initial) {
          rebuilds += 1;
        }
      });
      const indexPath = path.join(ws.workspaceRoot, 'src/sample/pages/index.njk');
      let source = await fsp.readFile(indexPath, 'utf8');
      source = source.includes('INDEX_OK')
        ? source.replace('INDEX_OK', 'TX_ROLLBACK_OK')
        : `${source}\n<!-- TX_ROLLBACK_OK -->\n`;
      await fsp.writeFile(indexPath, source, 'utf8');
      seq.created[2].fake.emitChange(indexPath);
      await waitFor(() => rebuilds >= 1, {
        timeoutMs: 10000,
        label: 'rebuild after rollback',
      });
      assert.match(
        await fsp.readFile(path.join(distRoot, 'index.html'), 'utf8'),
        /TX_ROLLBACK_OK/
      );

      await runtime.close();
    } finally {
      logs.restore();
    }
  });

  it('B: candidate/rollback startup 失敗でも clean:false output を変更しない', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 40 },
          build: { clean: false },
        },
      },
    });
    workspaces.push(ws);
    await prepareCleanFalseSources(ws.workspaceRoot);
    const logs = captureConsole();
    const distRoot = path.join(ws.workspaceRoot, 'dist/sample');

    const seq = createSequencedProjectWatcherFactory([
      { type: 'ready' },
      { type: 'error' },
      { type: 'error' },
    ]);

    const runtime = createWatchRuntime({
      mode: 'watch',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      projectWatcherFactory: seq.projectWatcherFactory,
    });
    runtimes.push(runtime);

    try {
      await runtime.start();
      await fsp.writeFile(
        path.join(distRoot, 'external-keep.txt'),
        'KEEP_EXTERNAL',
        'utf8'
      );
      const baseline = await collectOutputManifest(distRoot);
      const oldProject = runtime.project;

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 42,
        sourceDir: 'src/sample-alt',
        outputDir: 'dist/sample',
      });

      await waitFor(
        () => logs.output().includes('以前の監視状態の復旧に失敗しました'),
        { timeoutMs: 10000, label: 'unavailable message' }
      );

      assert.equal(seq.created[1].initialBuildStarts, 0);
      assert.equal(seq.created[2].initialBuildStarts, 0);
      assert.equal(runtime.getProjectWatcher(), null);
      assert.equal(runtime.project, oldProject);
      assertManifestEqual(
        await collectOutputManifest(distRoot),
        baseline,
        'unavailable output'
      );
      assert.equal(logs.output().includes('以前の正常な設定を継続します'), false);

      await runtime.close();
    } finally {
      logs.restore();
    }
  });

  it('C: unavailable 後の次 reload 成功で candidate output を生成する', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 40 },
          build: { clean: false },
        },
      },
    });
    workspaces.push(ws);
    await prepareCleanFalseSources(ws.workspaceRoot);
    const logs = captureConsole();
    const distRoot = path.join(ws.workspaceRoot, 'dist/sample');

    const seq = createSequencedProjectWatcherFactory([
      { type: 'ready' },
      { type: 'error' },
      { type: 'error' },
      { type: 'ready' },
    ]);

    const runtime = createWatchRuntime({
      mode: 'watch',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      projectWatcherFactory: seq.projectWatcherFactory,
    });
    runtimes.push(runtime);

    try {
      await runtime.start();
      await fsp.writeFile(
        path.join(distRoot, 'external-keep.txt'),
        'KEEP_EXTERNAL',
        'utf8'
      );

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 43,
        sourceDir: 'src/sample-alt',
        outputDir: 'dist/sample',
      });
      await waitFor(() => runtime.getProjectWatcher() == null, {
        timeoutMs: 10000,
        label: 'watcher unavailable',
      });
      assert.equal(
        (await collectOutputManifest(distRoot)).has('candidate-only.html'),
        false
      );

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 44,
        sourceDir: 'src/sample-alt',
        outputDir: 'dist/sample',
      });
      await waitFor(
        () => logs.output().includes('監視対象を更新しました'),
        { timeoutMs: 10000, label: 'next reload success' }
      );

      assert.equal(seq.createCount, 4);
      assert.equal(seq.created[3].initialBuildStarts, 1);
      assert.equal(runtime.getProjectWatcher(), seq.created[3].watcher);
      assert.ok(runtime.project.sourceDir.includes('sample-alt'));
      assert.ok(
        (await collectOutputManifest(distRoot)).has('candidate-only.html')
      );
      assert.match(
        await fsp.readFile(path.join(distRoot, 'shared.html'), 'utf8'),
        /SHARED_CANDIDATE/
      );

      let rebuilds = 0;
      runtime.getProjectWatcher().on('build:success', ({ initial }) => {
        if (!initial) {
          rebuilds += 1;
        }
      });
      const sharedAlt = path.join(
        ws.workspaceRoot,
        'src/sample-alt/pages/shared.njk'
      );
      await fsp.writeFile(
        sharedAlt,
        '{% extends "layouts/base.njk" %}{% block content %}SHARED_RECOVER{% endblock %}\n',
        'utf8'
      );
      seq.created[3].fake.emitChange(sharedAlt);
      await waitFor(() => rebuilds >= 1, {
        timeoutMs: 10000,
        label: 'rebuild after recover',
      });
      assert.match(
        await fsp.readFile(path.join(distRoot, 'shared.html'), 'utf8'),
        /SHARED_RECOVER/
      );

      await runtime.close();
    } finally {
      logs.restore();
    }
  });

  it('D: candidate 成功時は ready/commit 後にだけ initial build する', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 40 },
          build: { clean: false },
        },
      },
    });
    workspaces.push(ws);
    await prepareCleanFalseSources(ws.workspaceRoot);
    const logs = captureConsole();
    const distRoot = path.join(ws.workspaceRoot, 'dist/sample');

    let resolveReadyGate;
    const readyGate = new Promise((resolve) => {
      resolveReadyGate = resolve;
    });
    let sawCandidateOnlyBeforeReady = false;

    const seq = createSequencedProjectWatcherFactory([
      { type: 'ready' },
      {
        type: 'ready',
        async beforeSettle() {
          const mid = await collectOutputManifest(distRoot);
          sawCandidateOnlyBeforeReady = mid.has('candidate-only.html');
          resolveReadyGate();
        },
      },
    ]);

    const runtime = createWatchRuntime({
      mode: 'watch',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      projectWatcherFactory: seq.projectWatcherFactory,
    });
    runtimes.push(runtime);

    try {
      await runtime.start();
      await fsp.writeFile(
        path.join(distRoot, 'external-keep.txt'),
        'KEEP_EXTERNAL',
        'utf8'
      );
      const baseline = await collectOutputManifest(distRoot);

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 55,
        sourceDir: 'src/sample-alt',
        outputDir: 'dist/sample',
      });

      await readyGate;
      assert.equal(
        sawCandidateOnlyBeforeReady,
        false,
        'ready 前に candidate output が無い'
      );

      await waitFor(
        () => logs.output().includes('監視対象を更新しました'),
        { timeoutMs: 10000, label: 'candidate commit' }
      );

      assert.equal(seq.createCount, 2);
      assert.equal(seq.created[1].initialBuildStarts, 1);
      assert.equal(runtime.getProjectWatcher(), seq.created[1].watcher);
      assert.ok(runtime.project.sourceDir.includes('sample-alt'));
      assert.ok(
        (await collectOutputManifest(distRoot)).has('candidate-only.html')
      );
      assert.match(
        await fsp.readFile(path.join(distRoot, 'shared.html'), 'utf8'),
        /SHARED_CANDIDATE/
      );
      assert.equal(
        (await collectOutputManifest(distRoot)).get('external-keep.txt').hash,
        baseline.get('external-keep.txt').hash
      );

      await runtime.close();
    } finally {
      logs.restore();
    }
  });

  it('E: candidate ready 後の build failure は rollback せず recovery できる', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 40 },
          build: { clean: false },
        },
      },
    });
    workspaces.push(ws);
    await prepareCleanFalseSources(ws.workspaceRoot);
    const logs = captureConsole();

    const brokenShared = path.join(
      ws.workspaceRoot,
      'src/sample-alt/pages/shared.njk'
    );
    await fsp.writeFile(brokenShared, '{% invalid nunjucks %}\n', 'utf8');

    const seq = createSequencedProjectWatcherFactory([
      { type: 'ready' },
      { type: 'ready' },
    ]);

    const runtime = createWatchRuntime({
      mode: 'watch',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      projectWatcherFactory: seq.projectWatcherFactory,
    });
    runtimes.push(runtime);

    try {
      await runtime.start();

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 56,
        sourceDir: 'src/sample-alt',
        outputDir: 'dist/sample',
      });

      await waitFor(
        () =>
          logs.output().includes('設定の再読み込み後にbuildが失敗しました') &&
          runtime.getProjectWatcher() === seq.created[1].watcher,
        { timeoutMs: 10000, label: 'candidate build failure kept' }
      );

      assert.equal(seq.createCount, 2, 'rollback しない');
      assert.ok(runtime.project.sourceDir.includes('sample-alt'));
      assert.equal(logs.output().includes('以前の設定に戻しました'), false);
      assert.equal(
        logs.output().includes('監視対象を更新しました'),
        false,
        'activation final failure で成功ログを出さない'
      );

      await fsp.writeFile(
        brokenShared,
        '{% extends "layouts/base.njk" %}{% block content %}SHARED_FIXED{% endblock %}\n',
        'utf8'
      );
      let rebuilds = 0;
      runtime.getProjectWatcher().on('build:success', ({ initial }) => {
        if (!initial) {
          rebuilds += 1;
        }
      });
      seq.created[1].fake.emitChange(brokenShared);
      await waitFor(() => rebuilds >= 1, {
        timeoutMs: 10000,
        label: 'source recovery rebuild',
      });
      assert.match(
        await fsp.readFile(
          path.join(ws.workspaceRoot, 'dist/sample/shared.html'),
          'utf8'
        ),
        /SHARED_FIXED/
      );

      await runtime.close();
    } finally {
      logs.restore();
    }
  });

  it('F: config 完了ログは activation drain 後で最新 output と一致する', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 0 },
          build: { clean: false },
        },
      },
    });
    workspaces.push(ws);
    await prepareCleanFalseSources(ws.workspaceRoot);
    const logs = captureConsole();
    const distRoot = path.join(ws.workspaceRoot, 'dist/sample');
    const sharedPath = path.join(ws.workspaceRoot, 'src/sample/pages/shared.njk');

    let createCount = 0;
    /** @type {Array<() => void>} */
    const releases = [];
    let buildCount = 0;
    /** @type {ReturnType<typeof createControllableWatchFactory> | null} */
    let candidateFake = null;

    function projectWatcherFactory(project, options = {}) {
      createCount += 1;
      const isCandidate = createCount >= 2;
      const fake = createControllableWatchFactory();
      if (isCandidate) {
        candidateFake = fake;
      }
      const watchFactory = (paths, watchOptions) => {
        const watcher = fake.watchFactory(paths, watchOptions);
        queueMicrotask(() => {
          fake.emitReady();
        });
        return watcher;
      };

      return createProjectWatcher(project, {
        ...options,
        watchFactory,
        async executeBuildImpl({ initial, project: buildProject }) {
          if (!isCandidate) {
            return runBuild(buildProject, {
              logTitle: initial
                ? 'ビルドが完了しました'
                : '再ビルドが完了しました',
              includeOutput: initial,
            });
          }
          buildCount += 1;
          await new Promise((resolve) => {
            releases.push(resolve);
          });
          return runBuild(buildProject, {
            logTitle: initial
              ? 'ビルドが完了しました'
              : '再ビルドが完了しました',
            includeOutput: initial,
          });
        },
      });
    }

    const runtime = createWatchRuntime({
      mode: 'watch',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      projectWatcherFactory,
    });
    runtimes.push(runtime);

    try {
      await runtime.start();
      assert.equal(createCount, 1);

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 1,
        sourceDir: 'src/sample',
        outputDir: 'dist/sample',
      });

      await waitFor(() => buildCount >= 1 && releases.length >= 1, {
        timeoutMs: 10000,
        label: 'candidate activation build paused',
      });
      await fsp.writeFile(
        sharedPath,
        '{% extends "layouts/base.njk" %}{% block content %}CFG_DRAIN_LATEST{% endblock %}\n',
        'utf8'
      );
      candidateFake.emitChange(sharedPath);
      assert.equal(
        logs.output().includes('監視対象を更新しました'),
        false,
        'config 完了ログは drain 前に出ない'
      );

      releases[0]();
      await waitFor(() => buildCount >= 2 && releases.length >= 2, {
        timeoutMs: 10000,
        label: 'follow-up build paused',
      });
      assert.equal(
        logs.output().includes('監視対象を更新しました'),
        false,
        'follow-up 中も config 完了ログなし'
      );

      releases[1]();
      await waitFor(
        () => logs.output().includes('監視対象を更新しました'),
        { timeoutMs: 10000, label: 'config complete after drain' }
      );

      assert.match(
        await fsp.readFile(path.join(distRoot, 'shared.html'), 'utf8'),
        /CFG_DRAIN_LATEST/
      );
      await runtime.close();
    } finally {
      for (const release of releases) {
        release();
      }
      logs.restore();
    }
  });

  it('G: initial runtime ready 前の config 変更は pending 後に最新1回だけ適用する', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 0 },
          build: { clean: false },
        },
      },
    });
    workspaces.push(ws);
    await prepareCleanFalseSources(ws.workspaceRoot);
    await writeCleanFalseConfig(ws.workspaceRoot, {
      debounce: 0,
      sourceDir: 'src/sample',
      outputDir: 'dist/sample',
    });
    const logs = captureConsole();

    let releaseInitialReady;
    const initialReadyGate = new Promise((resolve) => {
      releaseInitialReady = resolve;
    });
    let sawInitialStartup = false;

    const seq = createSequencedProjectWatcherFactory([
      {
        type: 'ready',
        async beforeSettle() {
          sawInitialStartup = true;
          await writeCleanFalseConfig(ws.workspaceRoot, {
            debounce: 0,
            sourceDir: 'src/sample-alt',
            outputDir: 'dist/sample',
          });
          await writeCleanFalseConfig(ws.workspaceRoot, {
            debounce: 0,
            sourceDir: 'src/sample-alt',
            outputDir: 'dist/sample',
          });
          await initialReadyGate;
        },
      },
      { type: 'ready' },
    ]);

    const runtime = createWatchRuntime({
      mode: 'watch',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      projectWatcherFactory: seq.projectWatcherFactory,
    });
    runtimes.push(runtime);

    try {
      const startPromise = runtime.start();
      await waitFor(() => sawInitialStartup, {
        timeoutMs: 10000,
        label: 'initial watcher startup gate',
      });
      await waitFor(
        () => logs.output().includes('設定ファイルの変更を検出しました'),
        { timeoutMs: 10000, label: 'config change while starting' }
      );
      assert.equal(seq.createCount, 1, 'ready 前に replacement を始めない');
      releaseInitialReady();
      await startPromise;
      await waitFor(
        () =>
          logs.output().includes('監視対象を更新しました') &&
          seq.createCount === 2 &&
          runtime.project.sourceDir.includes('sample-alt'),
        { timeoutMs: 10000, label: 'pending config applied once after ready' }
      );
      assert.equal(seq.createCount, 2);
      await runtime.close();
    } finally {
      logs.restore();
    }
  });

  it('H: candidate startup 中の close は hang せず late commit しない', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 0 },
          build: { clean: false },
        },
      },
    });
    workspaces.push(ws);
    await prepareCleanFalseSources(ws.workspaceRoot);
    const logs = captureConsole();

    let releaseCandidateHold;
    const candidateHold = new Promise((resolve) => {
      releaseCandidateHold = resolve;
    });
    let sawCandidateStartup = false;

    const seq = createSequencedProjectWatcherFactory([
      { type: 'ready' },
      {
        type: 'ready',
        async beforeSettle() {
          sawCandidateStartup = true;
          await candidateHold;
        },
      },
    ]);

    const runtime = createWatchRuntime({
      mode: 'watch',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      projectWatcherFactory: seq.projectWatcherFactory,
    });
    runtimes.push(runtime);

    try {
      await runtime.start();
      const oldWatcher = runtime.getProjectWatcher();

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 0,
        sourceDir: 'src/sample-alt',
        outputDir: 'dist/sample',
      });
      await waitFor(() => sawCandidateStartup, {
        timeoutMs: 10000,
        label: 'candidate startWatching held',
      });

      await runtime.close();
      releaseCandidateHold();

      assert.equal(seq.createCount, 2);
      assert.equal(seq.created[1].closed, true);
      assert.equal(seq.created[1].initialBuildStarts, 0);
      assert.equal(
        logs.output().includes('監視対象を更新しました'),
        false
      );
      assert.notEqual(runtime.getProjectWatcher(), seq.created[1].watcher);
      assert.ok(oldWatcher);
    } finally {
      releaseCandidateHold();
      logs.restore();
    }
  });

  it('I: rollback startup 中の close は hang せず late rollback commit しない', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 0 },
          build: { clean: false },
        },
      },
    });
    workspaces.push(ws);
    await prepareCleanFalseSources(ws.workspaceRoot);
    const logs = captureConsole();

    let releaseRollbackHold;
    const rollbackHold = new Promise((resolve) => {
      releaseRollbackHold = resolve;
    });
    let sawRollbackStartup = false;

    const seq = createSequencedProjectWatcherFactory([
      { type: 'ready' },
      { type: 'error' },
      {
        type: 'ready',
        async beforeSettle() {
          sawRollbackStartup = true;
          await rollbackHold;
        },
      },
    ]);

    const runtime = createWatchRuntime({
      mode: 'watch',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      projectWatcherFactory: seq.projectWatcherFactory,
    });
    runtimes.push(runtime);

    try {
      await runtime.start();

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 0,
        sourceDir: 'src/sample-alt',
        outputDir: 'dist/sample',
      });
      await waitFor(() => sawRollbackStartup, {
        timeoutMs: 10000,
        label: 'rollback startWatching held',
      });

      await runtime.close();
      releaseRollbackHold();

      assert.equal(seq.createCount, 3);
      assert.equal(seq.created[2].closed, true);
      assert.equal(seq.created[2].initialBuildStarts, 0);
      assert.equal(logs.output().includes('以前の設定に戻しました'), false);
      assert.equal(
        logs.output().includes('監視対象を更新しました'),
        false
      );
    } finally {
      releaseRollbackHold();
      logs.restore();
    }
  });

  it('J: rollback final build failure は成功 rollback と区別する', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 0 },
          build: { clean: false },
        },
      },
    });
    workspaces.push(ws);
    await prepareCleanFalseSources(ws.workspaceRoot);
    const logs = captureConsole();
    /** @type {object|null} */
    let rolledBackError = null;

    const seq = createSequencedProjectWatcherFactory([
      { type: 'ready' },
      { type: 'error' },
      {
        type: 'ready',
        async executeBuildImpl({ initial, project: buildProject }) {
          if (initial) {
            throw new Error('injected rollback activation build failure');
          }
          return runBuild(buildProject, {
            logTitle: '再ビルドが完了しました',
            includeOutput: false,
          });
        },
      },
    ]);

    const runtime = createWatchRuntime({
      mode: 'watch',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      projectWatcherFactory: seq.projectWatcherFactory,
      onConfigActivationComplete() {
        assert.fail('rollback 経路で activation complete を呼んではいけない');
      },
    });
    runtimes.push(runtime);

    void rolledBackError;

    try {
      await runtime.start();
      const oldSource = runtime.project.sourceDir;

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 0,
        sourceDir: 'src/sample-alt',
        outputDir: 'dist/sample',
      });

      await waitFor(
        () =>
          logs
            .output()
            .includes(
              '以前の設定での監視は継続していますが、再ビルドに失敗しました'
            ) &&
          runtime.getProjectWatcher() === seq.created[2].watcher,
        { timeoutMs: 10000, label: 'rollback build failure distinguished' }
      );

      assert.equal(runtime.project.sourceDir, oldSource);
      assert.equal(seq.created[2].initialBuildFailures, 1);
      assert.equal(
        logs.output().includes('監視対象を更新しました'),
        false
      );
      assert.equal(
        logs
          .output()
          .includes('新しい設定の適用に失敗したため、以前の設定に戻しました。'),
        false,
        '成功 rollback message と区別する'
      );
      assert.match(
        logs.output(),
        /新しい設定の適用に失敗し、以前の設定での再ビルドにも失敗しました/
      );

      let rebuilds = 0;
      runtime.getProjectWatcher().on('build:success', ({ initial }) => {
        if (!initial) {
          rebuilds += 1;
        }
      });
      const sharedOld = path.join(
        ws.workspaceRoot,
        'src/sample/pages/shared.njk'
      );
      await fsp.writeFile(
        sharedOld,
        '{% extends "layouts/base.njk" %}{% block content %}ROLLBACK_RECOVER{% endblock %}\n',
        'utf8'
      );
      seq.created[2].fake.emitChange(sharedOld);
      await waitFor(() => rebuilds >= 1, {
        timeoutMs: 10000,
        label: 'recovery after rollback build failure',
      });
      assert.match(
        await fsp.readFile(
          path.join(ws.workspaceRoot, 'dist/sample/shared.html'),
          'utf8'
        ),
        /ROLLBACK_RECOVER/
      );

      await runtime.close();
    } finally {
      logs.restore();
    }
  });

  it('K: dev mode で candidate final failure は config SSE を送らない', async () => {
    const port = await getFreePort();
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 0 },
          build: { clean: false },
          serve: { host: '127.0.0.1', port },
          dev: { liveReload: true },
        },
      },
    });
    workspaces.push(ws);
    await prepareCleanFalseSources(ws.workspaceRoot);
    await writeCleanFalseConfig(ws.workspaceRoot, {
      debounce: 0,
      sourceDir: 'src/sample',
      outputDir: 'dist/sample',
      port,
    });
    const logs = captureConsole();

    const brokenShared = path.join(
      ws.workspaceRoot,
      'src/sample-alt/pages/shared.njk'
    );
    await fsp.writeFile(brokenShared, '{% invalid nunjucks %}\n', 'utf8');

    let reloadCount = 0;
    const seq = createSequencedProjectWatcherFactory([
      { type: 'ready' },
      { type: 'ready' },
    ]);

    const runtime = createWatchRuntime({
      mode: 'dev',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      commandName: 'dev',
      projectWatcherFactory: seq.projectWatcherFactory,
      onDevSessionReady({ liveReload }) {
        const original = liveReload.broadcastReload.bind(liveReload);
        liveReload.broadcastReload = (...args) => {
          reloadCount += 1;
          return original(...args);
        };
      },
    });
    runtimes.push(runtime);

    try {
      await runtime.start();

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 0,
        sourceDir: 'src/sample-alt',
        outputDir: 'dist/sample',
        port,
      });

      await waitFor(
        () =>
          logs.output().includes('設定の再読み込み後にbuildが失敗しました') &&
          runtime.getProjectWatcher() === seq.created[1].watcher,
        { timeoutMs: 10000, label: 'dev candidate build failure' }
      );

      assert.equal(reloadCount, 0, 'config-level SSE なし');
      assert.equal(
        logs.output().includes('監視対象を更新しました'),
        false
      );

      await fsp.writeFile(
        brokenShared,
        '{% extends "layouts/base.njk" %}{% block content %}DEV_FIXED{% endblock %}\n',
        'utf8'
      );
      let rebuilds = 0;
      runtime.getProjectWatcher().on('build:success', ({ initial }) => {
        if (!initial) {
          rebuilds += 1;
        }
      });
      seq.created[1].fake.emitChange(brokenShared);
      await waitFor(() => rebuilds >= 1, {
        timeoutMs: 10000,
        label: 'dev source recovery',
      });

      const successLogsBefore = (
        logs.output().match(/監視対象を更新しました/g) || []
      ).length;
      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 0,
        sourceDir: 'src/sample',
        outputDir: 'dist/sample',
        port,
      });
      await waitFor(
        () =>
          (logs.output().match(/監視対象を更新しました/g) || []).length >
            successLogsBefore && reloadCount >= 1,
        { timeoutMs: 10000, label: 'dev candidate success config SSE' }
      );

      await runtime.close();
    } finally {
      logs.restore();
    }
  });

  it('L: config reentry は直列化し最終 filesystem config のみ commit する', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 0 },
          build: { clean: false },
        },
      },
    });
    workspaces.push(ws);
    await prepareCleanFalseSources(ws.workspaceRoot);

    const midRoot = path.join(ws.workspaceRoot, 'src/sample-mid');
    await fse.copy(path.join(ws.workspaceRoot, 'src/sample'), midRoot);
    await fsp.writeFile(
      path.join(midRoot, 'pages/shared.njk'),
      '{% extends "layouts/base.njk" %}{% block content %}SHARED_MID{% endblock %}\n',
      'utf8'
    );

    const logs = captureConsole();
    let createCount = 0;
    /** @type {Array<() => void>} */
    const releases = [];
    let pausedBuilds = 0;

    function projectWatcherFactory(project, options = {}) {
      createCount += 1;
      const index = createCount;
      const fake = createControllableWatchFactory();
      const watchFactory = () => {
        const watcher = fake.watchFactory();
        queueMicrotask(() => {
          fake.emitReady();
        });
        return watcher;
      };

      return createProjectWatcher(project, {
        ...options,
        watchFactory,
        async executeBuildImpl({ initial, project: buildProject }) {
          if (index === 1) {
            return runBuild(buildProject, {
              logTitle: initial
                ? 'ビルドが完了しました'
                : '再ビルドが完了しました',
              includeOutput: initial,
            });
          }
          pausedBuilds += 1;
          await new Promise((resolve) => {
            releases.push(resolve);
          });
          return runBuild(buildProject, {
            logTitle: initial
              ? 'ビルドが完了しました'
              : '再ビルドが完了しました',
            includeOutput: initial,
          });
        },
      });
    }

    const runtime = createWatchRuntime({
      mode: 'watch',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      projectWatcherFactory,
    });
    runtimes.push(runtime);

    try {
      await runtime.start();
      assert.equal(createCount, 1);

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 0,
        sourceDir: 'src/sample-mid',
        outputDir: 'dist/sample',
      });
      await waitFor(() => pausedBuilds >= 1 && releases.length >= 1, {
        timeoutMs: 10000,
        label: 'transaction A paused',
      });
      assert.equal(createCount, 2);

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 0,
        sourceDir: 'src/sample',
        outputDir: 'dist/sample',
      });
      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 0,
        sourceDir: 'src/sample-alt',
        outputDir: 'dist/sample',
      });

      assert.equal(createCount, 2, 'transaction 並列なし');
      releases[0]();

      await waitFor(() => createCount === 3 && releases.length >= 2, {
        timeoutMs: 10000,
        label: 'transaction C paused after A',
      });
      assert.equal(
        (logs.output().match(/監視対象を更新しました/g) || []).length,
        1,
        'C drain 前は A の成功ログのみ'
      );
      releases[1]();

      const distRoot = path.join(ws.workspaceRoot, 'dist/sample');
      await waitFor(
        async () =>
          (logs.output().match(/監視対象を更新しました/g) || []).length >= 2 &&
          runtime.project.sourceDir.includes('sample-alt') &&
          (await collectOutputManifest(distRoot)).has('candidate-only.html'),
        { timeoutMs: 10000, label: 'latest config C committed' }
      );

      assert.equal(
        runtime.project.sourceDir.includes('sample-mid'),
        false,
        'stale B/mid を最終 commit しない'
      );

      await runtime.close();
    } finally {
      for (const release of releases) {
        release();
      }
      logs.restore();
    }
  });

  it('M: candidate activation build 中の close は follow-up を開始しない', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 0 },
          build: { clean: false },
        },
      },
    });
    workspaces.push(ws);
    await prepareCleanFalseSources(ws.workspaceRoot);
    const logs = captureConsole();
    const distRoot = path.join(ws.workspaceRoot, 'dist/sample');
    const sharedPath = path.join(
      ws.workspaceRoot,
      'src/sample-alt/pages/shared.njk'
    );

    let createCount = 0;
    /** @type {Array<() => void>} */
    const releases = [];
    let buildCount = 0;
    let buildStartsAfterClose = 0;
    let closeRequested = false;
    let activationCompleteCalls = 0;
    /** @type {ReturnType<typeof createControllableWatchFactory> | null} */
    let candidateFake = null;
    /** @type {{ closed: boolean, closeCalls: number, watcher: object } | null} */
    let candidateRecord = null;

    function projectWatcherFactory(project, options = {}) {
      createCount += 1;
      const isCandidate = createCount >= 2;
      const fake = createControllableWatchFactory();
      if (isCandidate) {
        candidateFake = fake;
      }
      const watchFactory = () => {
        const watcher = fake.watchFactory();
        queueMicrotask(() => {
          fake.emitReady();
        });
        return watcher;
      };

      const watcher = createProjectWatcher(project, {
        ...options,
        watchFactory,
        async executeBuildImpl({ initial, project: buildProject }) {
          if (!isCandidate) {
            return runBuild(buildProject, {
              logTitle: initial
                ? 'ビルドが完了しました'
                : '再ビルドが完了しました',
              includeOutput: initial,
            });
          }
          buildCount += 1;
          await new Promise((resolve) => {
            releases.push(resolve);
          });
          return runBuild(buildProject, {
            logTitle: initial
              ? 'ビルドが完了しました'
              : '再ビルドが完了しました',
            includeOutput: initial,
          });
        },
      });

      if (isCandidate) {
        candidateRecord = { closed: false, closeCalls: 0, watcher };
        const originalClose = watcher.close.bind(watcher);
        watcher.close = async () => {
          candidateRecord.closeCalls += 1;
          candidateRecord.closed = true;
          await originalClose();
        };
        watcher.on('build:start', () => {
          if (closeRequested) {
            buildStartsAfterClose += 1;
          }
        });
      }

      return watcher;
    }

    const runtime = createWatchRuntime({
      mode: 'watch',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      projectWatcherFactory,
      onConfigActivationComplete() {
        activationCompleteCalls += 1;
      },
    });
    runtimes.push(runtime);

    try {
      await runtime.start();

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 0,
        sourceDir: 'src/sample-alt',
        outputDir: 'dist/sample',
      });
      await waitFor(() => buildCount >= 1 && releases.length >= 1, {
        timeoutMs: 10000,
        label: 'candidate activation paused',
      });

      // pending follow-up を登録（内容変更は initial 完了 write と区別できないため event のみ）
      candidateFake.emitChange(sharedPath);
      assert.equal(buildCount, 1, 'follow-up はまだ開始していない');

      closeRequested = true;
      const closePromise = runtime.close();
      await waitFor(() => candidateRecord && candidateRecord.closed, {
        timeoutMs: 10000,
        label: 'authoritative candidate close started',
      });
      assert.equal(buildCount, 1);
      assert.equal(buildStartsAfterClose, 0);

      releases[0]();
      await closePromise;

      assert.equal(candidateRecord.closeCalls, 1);
      assert.equal(buildCount, 1, 'close 後 follow-up build 0');
      assert.equal(buildStartsAfterClose, 0);
      assert.equal(activationCompleteCalls, 0);
      assert.equal(logs.output().includes('監視対象を更新しました'), false);
      assert.equal(logs.output().includes('以前の設定に戻しました'), false);
      void distRoot;
    } finally {
      for (const release of releases) {
        release();
      }
      logs.restore();
    }
  });

  it('N: rollback activation build 中の close は follow-up と rollback 案内を出さない', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 0 },
          build: { clean: false },
        },
      },
    });
    workspaces.push(ws);
    await prepareCleanFalseSources(ws.workspaceRoot);
    const logs = captureConsole();
    const sharedPath = path.join(
      ws.workspaceRoot,
      'src/sample/pages/shared.njk'
    );

    let createCount = 0;
    /** @type {Array<() => void>} */
    const releases = [];
    let rollbackBuilds = 0;
    let buildStartsAfterClose = 0;
    let closeRequested = false;
    let activationCompleteCalls = 0;
    /** @type {ReturnType<typeof createControllableWatchFactory> | null} */
    let rollbackFake = null;
    /** @type {{ closed: boolean, closeCalls: number } | null} */
    let rollbackRecord = null;

    function projectWatcherFactory(project, options = {}) {
      createCount += 1;
      const index = createCount;
      const isCandidate = index === 2;
      const isRollback = index === 3;
      const fake = createControllableWatchFactory();
      if (isRollback) {
        rollbackFake = fake;
      }
      const watchFactory = () => {
        const watcher = fake.watchFactory();
        queueMicrotask(() => {
          if (isCandidate) {
            fake.emitError(
              Object.assign(new Error('injected candidate startup failure'), {
                code: 'JSKIM_TEST_WATCH_START_FAIL',
              })
            );
          } else {
            fake.emitReady();
          }
        });
        return watcher;
      };

      const watcher = createProjectWatcher(project, {
        ...options,
        watchFactory,
        async executeBuildImpl({ initial, project: buildProject }) {
          if (!isRollback) {
            return runBuild(buildProject, {
              logTitle: initial
                ? 'ビルドが完了しました'
                : '再ビルドが完了しました',
              includeOutput: initial,
            });
          }
          rollbackBuilds += 1;
          await new Promise((resolve) => {
            releases.push(resolve);
          });
          return runBuild(buildProject, {
            logTitle: initial
              ? 'ビルドが完了しました'
              : '再ビルドが完了しました',
            includeOutput: initial,
          });
        },
      });

      if (isRollback) {
        rollbackRecord = { closed: false, closeCalls: 0 };
        const originalClose = watcher.close.bind(watcher);
        watcher.close = async () => {
          rollbackRecord.closeCalls += 1;
          rollbackRecord.closed = true;
          await originalClose();
        };
        watcher.on('build:start', () => {
          if (closeRequested) {
            buildStartsAfterClose += 1;
          }
        });
      }

      return watcher;
    }

    const runtime = createWatchRuntime({
      mode: 'watch',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      projectWatcherFactory,
      onConfigActivationComplete() {
        activationCompleteCalls += 1;
      },
    });
    runtimes.push(runtime);

    try {
      await runtime.start();

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 0,
        sourceDir: 'src/sample-alt',
        outputDir: 'dist/sample',
      });
      await waitFor(() => rollbackBuilds >= 1 && releases.length >= 1, {
        timeoutMs: 10000,
        label: 'rollback activation paused',
      });

      await fsp.writeFile(
        sharedPath,
        '{% extends "layouts/base.njk" %}{% block content %}ROLLBACK_FOLLOW_UP{% endblock %}\n',
        'utf8'
      );
      rollbackFake.emitChange(sharedPath);

      closeRequested = true;
      const closePromise = runtime.close();
      await waitFor(() => rollbackRecord && rollbackRecord.closed, {
        timeoutMs: 10000,
        label: 'authoritative rollback close started',
      });
      assert.equal(rollbackBuilds, 1);
      assert.equal(buildStartsAfterClose, 0);

      releases[0]();
      await closePromise;

      assert.equal(rollbackRecord.closeCalls, 1);
      assert.equal(rollbackBuilds, 1, 'close 後 follow-up build 0');
      assert.equal(buildStartsAfterClose, 0);
      assert.equal(activationCompleteCalls, 0);
      assert.equal(logs.output().includes('以前の設定に戻しました'), false);
      assert.equal(
        logs.output().includes('再ビルドにも失敗しました'),
        false
      );
      assert.equal(
        logs.output().includes('監視対象を更新しました'),
        false
      );
      assert.equal(
        logs.output().includes('JSKIM_CONFIG_WATCHER_UNAVAILABLE') ||
          logs.output().includes('以前の監視状態の復旧に失敗'),
        false,
        'shutdown を unavailable と誤案内しない'
      );
    } finally {
      for (const release of releases) {
        release();
      }
      logs.restore();
    }
  });

  it('O: candidate activation close 中の config reentry は次 transaction を始めない', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 0 },
          build: { clean: false },
        },
      },
    });
    workspaces.push(ws);
    await prepareCleanFalseSources(ws.workspaceRoot);
    const logs = captureConsole();

    let createCount = 0;
    /** @type {Array<() => void>} */
    const releases = [];
    let candidateBuilds = 0;

    function projectWatcherFactory(project, options = {}) {
      createCount += 1;
      const isCandidate = createCount >= 2;
      const fake = createControllableWatchFactory();
      const watchFactory = () => {
        const watcher = fake.watchFactory();
        queueMicrotask(() => {
          fake.emitReady();
        });
        return watcher;
      };
      return createProjectWatcher(project, {
        ...options,
        watchFactory,
        async executeBuildImpl({ initial, project: buildProject }) {
          if (!isCandidate) {
            return runBuild(buildProject, {
              logTitle: initial
                ? 'ビルドが完了しました'
                : '再ビルドが完了しました',
              includeOutput: initial,
            });
          }
          candidateBuilds += 1;
          await new Promise((resolve) => {
            releases.push(resolve);
          });
          return runBuild(buildProject, {
            logTitle: initial
              ? 'ビルドが完了しました'
              : '再ビルドが完了しました',
            includeOutput: initial,
          });
        },
      });
    }

    const runtime = createWatchRuntime({
      mode: 'watch',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      projectWatcherFactory,
    });
    runtimes.push(runtime);

    try {
      await runtime.start();
      assert.equal(createCount, 1);

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 0,
        sourceDir: 'src/sample-alt',
        outputDir: 'dist/sample',
      });
      await waitFor(() => candidateBuilds >= 1 && releases.length >= 1, {
        timeoutMs: 10000,
        label: 'candidate activation paused for reentry',
      });

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 0,
        sourceDir: 'src/sample',
        outputDir: 'dist/sample',
      });
      assert.equal(createCount, 2, 'reentry は pending のみ');

      const closePromise = runtime.close();
      releases[0]();
      await closePromise;

      assert.equal(createCount, 2, 'close 後に次 transaction なし');
      assert.equal(logs.output().includes('監視対象を更新しました'), false);
    } finally {
      for (const release of releases) {
        release();
      }
      logs.restore();
    }
  });

  it('P: rollback activation close 中の config reentry は次 transaction を始めない', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        defaults: {
          watch: { debounce: 0 },
          build: { clean: false },
        },
      },
    });
    workspaces.push(ws);
    await prepareCleanFalseSources(ws.workspaceRoot);
    const logs = captureConsole();

    let createCount = 0;
    /** @type {Array<() => void>} */
    const releases = [];
    let rollbackBuilds = 0;

    function projectWatcherFactory(project, options = {}) {
      createCount += 1;
      const index = createCount;
      const isCandidate = index === 2;
      const isRollback = index === 3;
      const fake = createControllableWatchFactory();
      const watchFactory = () => {
        const watcher = fake.watchFactory();
        queueMicrotask(() => {
          if (isCandidate) {
            fake.emitError(
              Object.assign(new Error('injected candidate startup failure'), {
                code: 'JSKIM_TEST_WATCH_START_FAIL',
              })
            );
          } else {
            fake.emitReady();
          }
        });
        return watcher;
      };
      return createProjectWatcher(project, {
        ...options,
        watchFactory,
        async executeBuildImpl({ initial, project: buildProject }) {
          if (!isRollback) {
            return runBuild(buildProject, {
              logTitle: initial
                ? 'ビルドが完了しました'
                : '再ビルドが完了しました',
              includeOutput: initial,
            });
          }
          rollbackBuilds += 1;
          await new Promise((resolve) => {
            releases.push(resolve);
          });
          return runBuild(buildProject, {
            logTitle: initial
              ? 'ビルドが完了しました'
              : '再ビルドが完了しました',
            includeOutput: initial,
          });
        },
      });
    }

    const runtime = createWatchRuntime({
      mode: 'watch',
      workspaceRoot: ws.workspaceRoot,
      projectName: 'sample',
      projectWatcherFactory,
    });
    runtimes.push(runtime);

    try {
      await runtime.start();

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 0,
        sourceDir: 'src/sample-alt',
        outputDir: 'dist/sample',
      });
      await waitFor(() => rollbackBuilds >= 1 && releases.length >= 1, {
        timeoutMs: 10000,
        label: 'rollback activation paused for reentry',
      });
      const createsAtPause = createCount;

      await writeCleanFalseConfig(ws.workspaceRoot, {
        debounce: 0,
        sourceDir: 'src/sample',
        outputDir: 'dist/sample',
      });
      assert.equal(createCount, createsAtPause, 'reentry は pending のみ');

      const closePromise = runtime.close();
      releases[0]();
      await closePromise;

      assert.equal(createCount, createsAtPause, 'close 後に次 transaction なし');
      assert.equal(logs.output().includes('以前の設定に戻しました'), false);
      assert.equal(logs.output().includes('監視対象を更新しました'), false);
    } finally {
      for (const release of releases) {
        release();
      }
      logs.restore();
    }
  });
});
