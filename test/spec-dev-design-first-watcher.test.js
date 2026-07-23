'use strict';

/**
 * Phase 7B-1 安定化: Description 新規作成 / 初回保存時の
 * collect / viewer build / reload(target=spec) 回数を live runtime で計測する。
 *
 * POST/PUT の HTTP 完了と、非同期 Spec refresh（BUILD_ONLY → buildCompleted → reload）は
 * 別境界として待つ。buildStarted（buildFn 入口）を最終完了 signal にしない。
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSpecDevRuntime } = require('../scripts/lib/create-spec-dev-runtime');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest, openSse } = require('./helpers/http-request');
const { waitFor, sleep } = require('./helpers/wait-for-output');
const {
  DESCRIPTION_API_PREFIX,
} = require('../scripts/lib/create-description-edit-api');

const REPO_ROOT = path.resolve(__dirname, '..');
const COMPANION_ENTRY = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js'
);

describe('design-first Description create: watcher 回数', () => {
  /** @type {object|null} */
  let companion = null;

  before(async () => {
    companion = await import(pathToFileURL(COMPANION_ENTRY).href);
  });

  function countReloadTarget(sse, target) {
    return sse.typedEvents.filter((event) => {
      if (event.name !== 'reload') {
        return false;
      }
      try {
        const payload = JSON.parse(event.data);
        return (payload.target || 'all') === target;
      } catch {
        return false;
      }
    }).length;
  }

  function createCounters() {
    return {
      collect: 0,
      buildStarted: 0,
      buildCompleted: 0,
      buildFailed: 0,
      /** @type {Error|null} */
      lastBuildError: null,
      failNextBuild: false,
    };
  }

  function snapshotRefresh(counters, sse) {
    return {
      collect: counters.collect,
      buildStarted: counters.buildStarted,
      buildCompleted: counters.buildCompleted,
      buildFailed: counters.buildFailed,
      specReloads: countReloadTarget(sse, 'spec'),
    };
  }

  function asError(err) {
    return err instanceof Error ? err : new Error(String(err));
  }

  function formatBuildFailureDetail(err) {
    if (!err) {
      return 'Screen Spec build failed before reload:\n(unknown error)';
    }
    const lines = [
      'Screen Spec build failed before reload:',
      String(err.message || err),
      `code=${err.code != null ? err.code : ''}`,
      `path=${err.path != null ? err.path : ''}`,
    ];
    if (err.cause) {
      const cause = err.cause;
      lines.push(
        `cause=${cause && cause.message ? cause.message : String(cause)}`
      );
    }
    return lines.join('\n');
  }

  function throwBuildFailure(counters, extraLines = []) {
    const original = counters.lastBuildError || new Error('unknown');
    const wrapped = new Error(
      [formatBuildFailureDetail(original), ...extraLines].join('\n')
    );
    wrapped.cause = original;
    if (original.code != null) {
      wrapped.code = original.code;
    }
    if (original.path != null) {
      wrapped.path = original.path;
    }
    throw wrapped;
  }

  function wrapCleanupError(err, stage) {
    const original = asError(err);
    const wrapped = new Error(
      `session cleanup failed: ${stage}: ${original.message}`
    );
    wrapped.cause = original;
    if (original.code != null) {
      wrapped.code = original.code;
    }
    if (original.path != null) {
      wrapped.path = original.path;
    }
    wrapped.cleanupStage = stage;
    if (original.stack) {
      wrapped.stack = `${wrapped.stack}\n--- caused by ---\n${original.stack}`;
    }
    return wrapped;
  }

  /**
   * callback 本体エラーと cleanup エラーを両方残して再送出する。
   * 本体成功 + cleanup 失敗 → cleanup を throw。
   * 本体失敗 + cleanup 成功 → 本体を throw。
   * 両方失敗 → AggregateError([body, ...cleanup])。
   */
  function rethrowSessionErrors(bodyError, cleanupErrors) {
    if (!bodyError && cleanupErrors.length === 0) {
      return;
    }
    if (bodyError && cleanupErrors.length === 0) {
      throw bodyError;
    }
    if (!bodyError && cleanupErrors.length === 1) {
      throw cleanupErrors[0];
    }
    if (!bodyError) {
      throw new AggregateError(
        cleanupErrors,
        'session cleanup failed'
      );
    }
    throw new AggregateError(
      [bodyError, ...cleanupErrors],
      `${bodyError.message} (with ${cleanupErrors.length} cleanup error(s))`
    );
  }

  /**
   * BUILD_ONLY 成功完了（buildCompleted + reload(spec)）を待つ。
   * buildFailed が増えたら lastBuildError を cause として即失敗する。
   */
  async function waitForSpecRefresh({
    counters,
    sse,
    before,
    label,
    timeoutMs = 10000,
  }) {
    await waitFor(
      () => {
        if (counters.buildFailed > before.buildFailed) {
          throwBuildFailure(counters);
        }
        return (
          counters.buildStarted >= before.buildStarted + 1 &&
          counters.buildCompleted >= before.buildCompleted + 1 &&
          countReloadTarget(sse, 'spec') >= before.specReloads + 1
        );
      },
      { timeoutMs, label }
    );
  }

  /**
   * 追加 Spec refresh が起きないことを短い安定窓で確認する（時間は既存 sleep(500) 相当）。
   */
  async function assertNoSpecRefresh({ counters, sse, before }) {
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      assert.equal(counters.collect, before.collect);
      assert.equal(counters.buildStarted, before.buildStarted);
      assert.equal(counters.buildCompleted, before.buildCompleted);
      assert.equal(counters.buildFailed, before.buildFailed);
      assert.equal(countReloadTarget(sse, 'spec'), before.specReloads);
      // eslint-disable-next-line no-await-in-loop
      await sleep(50);
    }
  }

  /**
   * counters / reload が windowMs の間変化しないことを待つ。
   * 変化があれば snapshot を更新して安定窓をやり直す（固定 sleep 後の無条件 return ではない）。
   */
  async function waitForCountersQuiescence(counters, sse, options = {}) {
    const windowMs = options.windowMs ?? 500;
    const timeoutMs = options.timeoutMs ?? 10000;
    const label = options.label || 'metadata probe quiescence';
    const startedAt = Date.now();
    let snapshot = snapshotRefresh(counters, sse);
    let windowStartedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
      if (counters.buildFailed > snapshot.buildFailed) {
        throwBuildFailure(counters, [
          `probeQuiescence=true`,
          `buildStarted=${counters.buildStarted}`,
          `buildCompleted=${counters.buildCompleted}`,
          `buildFailed=${counters.buildFailed}`,
          `specReloads=${countReloadTarget(sse, 'spec')}`,
        ]);
      }

      const current = snapshotRefresh(counters, sse);
      const changed =
        current.collect !== snapshot.collect ||
        current.buildStarted !== snapshot.buildStarted ||
        current.buildCompleted !== snapshot.buildCompleted ||
        current.buildFailed !== snapshot.buildFailed ||
        current.specReloads !== snapshot.specReloads;

      if (changed) {
        snapshot = current;
        windowStartedAt = Date.now();
      } else if (Date.now() - windowStartedAt >= windowMs) {
        return snapshot;
      }

      // eslint-disable-next-line no-await-in-loop
      await sleep(50);
    }

    throw new Error(`待機タイムアウト: ${label}`);
  }

  async function writeViewerDist(specDistDir, marker) {
    await fsp.mkdir(specDistDir, { recursive: true });
    await fsp.writeFile(
      path.join(specDistDir, 'index.html'),
      `<!DOCTYPE html><html><body>${marker}</body></html>\n`,
      'utf8'
    );
  }

  async function writeBaseConfig(workspaceRoot) {
    await fsp.writeFile(
      path.join(workspaceRoot, 'jskim.config.js'),
      `module.exports = {
  defaults: {
    files: [{ from: 'pages', to: '' }],
    templates: ['layouts'],
    build: { clean: true },
    watch: { debounce: 80 },
    serve: { host: '127.0.0.1', port: 34567 },
    dev: { liveReload: true },
  },
  projects: {
    sample: {
      sourceDir: 'src/sample',
      outputDir: 'dist/sample',
    },
  },
};
`,
      'utf8'
    );
  }

  async function startRuntime(workspaceRoot, options = {}) {
    const port = await getFreePort();
    const counters = createCounters();
    const runtime = createSpecDevRuntime({
      workspaceRoot,
      projectName: 'sample',
      host: '127.0.0.1',
      port,
      open: false,
      openBrowserFn: () => ({ ok: true }),
      skipInitialCollect: true,
      skipInitialBuild: true,
      debounceMs: 80,
      log: false,
      initialDevLog: false,
      collectFn: async () => {
        counters.collect += 1;
        return { screens: 0, states: 0, updated: 0, unchanged: 0 };
      },
      buildFn: async () => {
        counters.buildStarted += 1;
        try {
          if (counters.failNextBuild) {
            counters.failNextBuild = false;
            const err = new Error('意図的な viewer build 失敗');
            err.code = 'JSKIM_SPEC_BUILD_FAIL';
            throw err;
          }
          await writeViewerDist(
            path.join(workspaceRoot, 'spec', 'sample', 'dist'),
            `SPEC_V${counters.buildCompleted + 2}`
          );
          counters.buildCompleted += 1;
          return {
            outDir: path.join(workspaceRoot, 'spec', 'sample', 'dist'),
          };
        } catch (err) {
          counters.buildFailed += 1;
          counters.lastBuildError = err;
          throw err;
        }
      },
      classifyPath: companion.classifyScreenSpecWatchPath,
      mergeKinds: companion.mergeScreenSpecWatchKinds,
      createFileDescriptionStore: companion.createFileDescriptionStore,
      loadScreenSpecProject: companion.loadScreenSpecProject,
      ...options,
    });
    try {
      await runtime.start();
    } catch (err) {
      try {
        await runtime.close();
      } catch (closeErr) {
        throw new AggregateError(
          [
            asError(err),
            wrapCleanupError(closeErr, 'runtime.close after start failure'),
          ],
          'runtime start failed with cleanup error'
        );
      }
      throw err;
    }
    return {
      workspaceRoot,
      port,
      counters,
      runtime,
      close: () => runtime.close(),
      cleanup: () => fsp.rm(workspaceRoot, { recursive: true, force: true }),
    };
  }

  /**
   * metadata watcher ready を確定し、probe 由来の pending 作業を drain する。
   *
   * 旧流れ（混入し得る）:
   *   probe write A → 250ms → probe write B → 最初の completed/reload で即 return
   *   → A 完了後でも B が debounce/pending のまま本テスト baseline に混入し得る
   *
   * 新流れ:
   *   1 attempt = write → 反応待ち →（反応ありならその完了まで待つ / 無しなら次 attempt）
   *   最初の成功 refresh 観察後、安定窓で追加 refresh が無いことを確認してから return
   */
  async function ensureMetadataWatchReadyAndDrained({
    workspaceRoot,
    counters,
    sse,
  }) {
    const themePath = path.join(
      workspaceRoot,
      'spec',
      'sample',
      'src',
      'theme',
      'preview.css'
    );
    const overallBefore = snapshotRefresh(counters, sse);
    const deadline = Date.now() + 10000;
    // awaitWriteFinish(50) + debounce(80) を超え、未準備時の無反応判定に使う（suite timeout は増やさない）
    const noReactionMs = 500;
    let probe = 0;
    let observedRefresh = false;
    let lastToken = '';

    while (Date.now() < deadline) {
      if (counters.buildFailed > overallBefore.buildFailed) {
        throwBuildFailure(counters, [
          `probeToken=${lastToken}`,
          `probePath=${themePath}`,
          `buildStarted=${counters.buildStarted}`,
          `buildCompleted=${counters.buildCompleted}`,
          `buildFailed=${counters.buildFailed}`,
          `specReloads=${countReloadTarget(sse, 'spec')}`,
        ]);
      }

      if (
        counters.buildCompleted >= overallBefore.buildCompleted + 1 &&
        countReloadTarget(sse, 'spec') >= overallBefore.specReloads + 1
      ) {
        observedRefresh = true;
        break;
      }

      const attemptBefore = snapshotRefresh(counters, sse);
      probe += 1;
      lastToken = `${Date.now()}-${probe}`;
      // eslint-disable-next-line no-await-in-loop
      await fsp.writeFile(
        themePath,
        `/* metadata-watch-ready ${lastToken} */\n`,
        'utf8'
      );

      let reacted = false;
      const reactionDeadline = Date.now() + noReactionMs;
      while (Date.now() < reactionDeadline && Date.now() < deadline) {
        if (counters.buildFailed > attemptBefore.buildFailed) {
          throwBuildFailure(counters, [
            `probeToken=${lastToken}`,
            `probePath=${themePath}`,
            `buildStarted=${counters.buildStarted}`,
            `buildCompleted=${counters.buildCompleted}`,
            `buildFailed=${counters.buildFailed}`,
            `specReloads=${countReloadTarget(sse, 'spec')}`,
          ]);
        }
        if (counters.buildStarted > attemptBefore.buildStarted) {
          reacted = true;
          break;
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(50);
      }

      if (!reacted) {
        // watcher 未準備: この attempt の pending は無いので次 write へ
        continue;
      }

      // 反応済み: 完了するまで次の probe write を出さない（直列）
      const remainingMs = Math.max(1, deadline - Date.now());
      // eslint-disable-next-line no-await-in-loop
      await waitForSpecRefresh({
        counters,
        sse,
        before: attemptBefore,
        label: `metadata probe refresh (${lastToken})`,
        timeoutMs: remainingMs,
      });
      observedRefresh = true;
      break;
    }

    if (!observedRefresh) {
      throw new Error(
        [
          '待機タイムアウト: metadata watcher ready',
          `probeToken=${lastToken}`,
          `probePath=${themePath}`,
          `buildStarted=${counters.buildStarted}`,
          `buildCompleted=${counters.buildCompleted}`,
          `buildFailed=${counters.buildFailed}`,
          `specReloads=${countReloadTarget(sse, 'spec')}`,
          counters.lastBuildError
            ? formatBuildFailureDetail(counters.lastBuildError)
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      );
    }

    const remainingForDrain = Math.max(1, deadline - Date.now());
    await waitForCountersQuiescence(counters, sse, {
      windowMs: 500,
      timeoutMs: remainingForDrain,
      label: 'metadata probe quiescence',
    });
  }

  /**
   * test 単位の resource を必ず解放する。
   * workspace 生成から finally 対象。順序: SSE → runtime → workspace。
   * 前段 cleanup 失敗でも後段は継続し、本体エラーと cleanup エラーを両方残す。
   */
  async function withSession(createWorkspace, run, options = {}) {
    let workspaceRoot = null;
    let session = null;
    let sse = null;
    /** @type {Error|null} */
    let bodyError = null;
    /** @type {Error[]} */
    const cleanupErrors = [];

    try {
      workspaceRoot = await createWorkspace();
      const startFn = options.startRuntimeFn || startRuntime;
      session = await startFn(workspaceRoot, options.runtimeOptions || {});
      sse = await openSse({ port: session.port });
      assert.equal(sse.status, 200);
      if (options.skipMetadataProbe !== true) {
        await ensureMetadataWatchReadyAndDrained({
          workspaceRoot,
          counters: session.counters,
          sse,
        });
      }
      // spread すると close 差し替えが finally に届かないため同一 object を渡す
      session.sse = sse;
      await run(session);
    } catch (err) {
      bodyError = asError(err);
    } finally {
      if (sse) {
        try {
          sse.close();
        } catch (err) {
          cleanupErrors.push(wrapCleanupError(err, 'SSE close'));
        }
      }
      if (session) {
        try {
          await session.close();
        } catch (err) {
          cleanupErrors.push(wrapCleanupError(err, 'runtime.close'));
        }
      }
      if (workspaceRoot) {
        try {
          const rmFn =
            options.workspaceRmFn ||
            ((root) => fsp.rm(root, { recursive: true, force: true }));
          await rmFn(workspaceRoot);
        } catch (err) {
          cleanupErrors.push(
            wrapCleanupError(err, `workspace rm (${workspaceRoot})`)
          );
        }
      }
    }

    rethrowSessionErrors(bodyError, cleanupErrors);
  }

  async function createEmptyDesignWorkspace() {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-df-watch-empty-')
    );
    const pagesDir = path.join(workspaceRoot, 'src', 'sample', 'pages');
    const layoutsDir = path.join(workspaceRoot, 'src', 'sample', 'layouts');
    const dataDir = path.join(workspaceRoot, 'spec', 'sample', 'src', 'data');
    const themeDir = path.join(workspaceRoot, 'spec', 'sample', 'src', 'theme');
    const specDistDir = path.join(workspaceRoot, 'spec', 'sample', 'dist');
    const distDir = path.join(workspaceRoot, 'dist', 'sample');

    await fsp.mkdir(pagesDir, { recursive: true });
    await fsp.mkdir(layoutsDir, { recursive: true });
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.mkdir(themeDir, { recursive: true });
    await fsp.mkdir(specDistDir, { recursive: true });
    await fsp.mkdir(distDir, { recursive: true });

    await writeBaseConfig(workspaceRoot);
    await fsp.writeFile(
      path.join(layoutsDir, 'base.njk'),
      '<!DOCTYPE html><html><body>{% block body %}{% endblock %}</body></html>\n',
      'utf8'
    );
    await fsp.writeFile(
      path.join(pagesDir, 'index.html.njk'),
      '{% extends "base.njk" %}{% block body %}APP_OK{% endblock %}\n',
      'utf8'
    );
    await fsp.writeFile(path.join(themeDir, 'preview.css'), '/* theme */\n', 'utf8');
    await fsp.writeFile(
      path.join(distDir, 'index.html'),
      '<!DOCTYPE html><html><body>APP_OK</body></html>\n',
      'utf8'
    );
    await writeViewerDist(specDistDir, 'SPEC_V1');
    return workspaceRoot;
  }

  async function createImplOnlyWorkspace() {
    const workspaceRoot = await createEmptyDesignWorkspace();
    const pagesDir = path.join(workspaceRoot, 'src', 'sample', 'pages');
    const snapDir = path.join(
      workspaceRoot,
      'spec',
      'sample',
      'src',
      'snapshots',
      'impl-only'
    );
    await fsp.mkdir(snapDir, { recursive: true });
    await fsp.writeFile(
      path.join(pagesDir, 'impl-only.spec.json'),
      JSON.stringify(
        {
          schemaVersion: '1.0',
          screen: { id: 'impl-only', path: '/' },
          states: [
            {
              id: 'default',
              name: '初期',
              viewer: { visible: true, order: 1 },
            },
          ],
          interactions: [],
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
    await fsp.writeFile(
      path.join(snapDir, 'default.html'),
      '<div data-jskim-spec-item="title">title</div>\n',
      'utf8'
    );
    return workspaceRoot;
  }

  function apiHeaders(port) {
    return {
      'Content-Type': 'application/json',
      Origin: `http://127.0.0.1:${port}`,
      Host: `127.0.0.1:${port}`,
    };
  }

  it(
    '0 画面 → POST 作成: collect:0 build:1 reload(spec):1',
    { timeout: 30000 },
    async () => {
      await withSession(createEmptyDesignWorkspace, async ({
        port,
        counters,
        sse,
        workspaceRoot,
      }) => {
        const before = snapshotRefresh(counters, sse);
        assert.equal(counters.collect, before.collect);
        // ready warm-up 後の相対増加で検証する

        const post = await httpRequest({
          port,
          method: 'POST',
          path: DESCRIPTION_API_PREFIX,
          headers: apiHeaders(port),
          body: JSON.stringify({
            screenId: 'design-first',
            name: '設計先行',
            description: '',
          }),
        });
        assert.equal(post.status, 201);

        const filePath = path.join(
          workspaceRoot,
          'spec',
          'sample',
          'src',
          'data',
          'design-first.json'
        );
        await waitFor(
          async () => {
            try {
              await fsp.access(filePath);
              return true;
            } catch {
              return false;
            }
          },
          { timeoutMs: 5000, label: 'description file created' }
        );

        await waitForSpecRefresh({
          counters,
          sse,
          before,
          label: 'viewer build once after POST',
        });

        assert.equal(counters.collect, before.collect);
        assert.equal(counters.buildStarted, before.buildStarted + 1);
        assert.equal(counters.buildCompleted, before.buildCompleted + 1);
        assert.equal(counters.buildFailed, before.buildFailed);
        assert.equal(countReloadTarget(sse, 'spec'), before.specReloads + 1);
      });
    }
  );

  it(
    'IMPLEMENTATION_ONLY 初回 PUT: collect:0 build:1 reload(spec):1',
    { timeout: 30000 },
    async () => {
      await withSession(createImplOnlyWorkspace, async ({
        port,
        counters,
        sse,
        workspaceRoot,
      }) => {
        const before = snapshotRefresh(counters, sse);
        const getRes = await httpRequest({
          port,
          path: `${DESCRIPTION_API_PREFIX}/impl-only`,
        });
        assert.equal(getRes.status, 200);
        const getJson = JSON.parse(getRes.body.toString('utf8'));
        assert.equal(getJson.exists, false);

        const nextDoc = structuredClone(getJson.document);
        nextDoc.screen.name = '実装のみから連携';
        nextDoc.screen.description = '初回保存';

        const putRes = await httpRequest({
          port,
          method: 'PUT',
          path: `${DESCRIPTION_API_PREFIX}/impl-only`,
          headers: apiHeaders(port),
          body: JSON.stringify({
            expectedRevision: getJson.revision,
            document: nextDoc,
          }),
        });
        assert.equal(putRes.status, 200);

        await waitForSpecRefresh({
          counters,
          sse,
          before,
          label: 'viewer build once after first PUT',
        });

        assert.equal(counters.collect, before.collect);
        assert.equal(counters.buildStarted, before.buildStarted + 1);
        assert.equal(counters.buildCompleted, before.buildCompleted + 1);
        assert.equal(counters.buildFailed, before.buildFailed);
        assert.equal(countReloadTarget(sse, 'spec'), before.specReloads + 1);

        const saved = JSON.parse(
          await fsp.readFile(
            path.join(
              workspaceRoot,
              'spec',
              'sample',
              'src',
              'data',
              'impl-only.json'
            ),
            'utf8'
          )
        );
        assert.equal(saved.screen.name, '実装のみから連携');
      });
    }
  );

  it(
    'DESIGN_ONLY 項目追加 PUT: collect:0 build:1 reload(spec):1',
    { timeout: 30000 },
    async () => {
      await withSession(createEmptyDesignWorkspace, async ({
        port,
        counters,
        sse,
        workspaceRoot,
      }) => {
        const headers = apiHeaders(port);
        const createBefore = snapshotRefresh(counters, sse);

        const post = await httpRequest({
          port,
          method: 'POST',
          path: DESCRIPTION_API_PREFIX,
          headers,
          body: JSON.stringify({
            screenId: 'item-order-watch',
            name: '項目順',
            description: '',
          }),
        });
        assert.equal(post.status, 201);
        await waitForSpecRefresh({
          counters,
          sse,
          before: createBefore,
          label: 'create build',
        });

        const before = snapshotRefresh(counters, sse);

        const getRes = await httpRequest({
          port,
          path: `${DESCRIPTION_API_PREFIX}/item-order-watch`,
        });
        assert.equal(getRes.status, 200);
        const getJson = JSON.parse(getRes.body.toString('utf8'));
        const nextDoc = structuredClone(getJson.document);
        nextDoc.items['manual-first'] = {
          name: '手動1',
          type: 'text',
          description: '',
          note: '',
        };
        nextDoc.items['manual-second'] = {
          name: '手動2',
          type: 'button',
          description: '',
          note: '',
        };
        nextDoc.itemOrder = ['manual-first', 'manual-second'];

        const putRes = await httpRequest({
          port,
          method: 'PUT',
          path: `${DESCRIPTION_API_PREFIX}/item-order-watch`,
          headers,
          body: JSON.stringify({
            expectedRevision: getJson.revision,
            document: nextDoc,
          }),
        });
        assert.equal(putRes.status, 200);

        await waitForSpecRefresh({
          counters,
          sse,
          before,
          label: 'viewer build once after item add PUT',
        });

        assert.equal(counters.collect, before.collect);
        assert.equal(counters.buildStarted, before.buildStarted + 1);
        assert.equal(counters.buildCompleted, before.buildCompleted + 1);
        assert.equal(counters.buildFailed, before.buildFailed);
        assert.equal(countReloadTarget(sse, 'spec'), before.specReloads + 1);

        const saved = JSON.parse(
          await fsp.readFile(
            path.join(
              workspaceRoot,
              'spec',
              'sample',
              'src',
              'data',
              'item-order-watch.json'
            ),
            'utf8'
          )
        );
        assert.equal(saved.schemaVersion, '1.2');
        assert.deepEqual(saved.excludedItems, {});
        assert.deepEqual(saved.itemOrder, ['manual-first', 'manual-second']);
      });
    }
  );

  it(
    '重複 POST 409: collect:0 build:0 reload:0',
    { timeout: 30000 },
    async () => {
      await withSession(createEmptyDesignWorkspace, async ({
        port,
        counters,
        sse,
      }) => {
        const headers = apiHeaders(port);
        const body = JSON.stringify({
          screenId: 'dup-watch',
          name: '重複',
          description: '',
        });

        const firstBefore = snapshotRefresh(counters, sse);
        const first = await httpRequest({
          port,
          method: 'POST',
          path: DESCRIPTION_API_PREFIX,
          headers,
          body,
        });
        assert.equal(first.status, 201);
        await waitForSpecRefresh({
          counters,
          sse,
          before: firstBefore,
          label: 'first create build',
        });
        const afterFirst = snapshotRefresh(counters, sse);

        const second = await httpRequest({
          port,
          method: 'POST',
          path: DESCRIPTION_API_PREFIX,
          headers,
          body,
        });
        assert.equal(second.status, 409);
        await assertNoSpecRefresh({
          counters,
          sse,
          before: afterFirst,
        });
      });
    }
  );

  it(
    '画面複製 POST: collect:0 build:1 reload(spec):1',
    { timeout: 30000 },
    async () => {
      await withSession(createEmptyDesignWorkspace, async ({
        port,
        counters,
        sse,
        workspaceRoot,
      }) => {
        const headers = apiHeaders(port);

        // --- 準備: 複製元 Description を作成・seed ---
        const createBefore = snapshotRefresh(counters, sse);
        const create = await httpRequest({
          port,
          method: 'POST',
          path: DESCRIPTION_API_PREFIX,
          headers,
          body: JSON.stringify({
            screenId: 'dup-source',
            name: '複製元',
            description: '元説明',
          }),
        });
        assert.equal(create.status, 201);
        await waitForSpecRefresh({
          counters,
          sse,
          before: createBefore,
          label: 'source create build',
        });

        const getRes = await httpRequest({
          port,
          path: `${DESCRIPTION_API_PREFIX}/dup-source`,
        });
        const getJson = JSON.parse(getRes.body.toString('utf8'));
        const seeded = structuredClone(getJson.document);
        seeded.items.a = {
          name: 'A',
          type: 'text',
          description: '',
          note: '',
        };
        seeded.items.b = {
          name: 'B',
          type: 'button',
          description: '',
          note: '',
        };
        seeded.itemOrder = ['a', 'b'];
        const putBefore = snapshotRefresh(counters, sse);
        const putRes = await httpRequest({
          port,
          method: 'PUT',
          path: `${DESCRIPTION_API_PREFIX}/dup-source`,
          headers,
          body: JSON.stringify({
            expectedRevision: getJson.revision,
            document: seeded,
          }),
        });
        assert.equal(putRes.status, 200);
        await waitForSpecRefresh({
          counters,
          sse,
          before: putBefore,
          label: 'source seed build',
        });

        // excludedItems は PUT では新規追加できないため、ディスク上で複製元へ付与する
        const sourcePath = path.join(
          workspaceRoot,
          'spec',
          'sample',
          'src',
          'data',
          'dup-source.json'
        );
        const onDisk = JSON.parse(await fsp.readFile(sourcePath, 'utf8'));
        onDisk.excludedItems = {
          layout: {
            name: '枠',
            type: 'container',
            description: '',
            note: '',
          },
        };
        const exclBefore = snapshotRefresh(counters, sse);
        await fsp.writeFile(
          sourcePath,
          `${JSON.stringify(onDisk, null, 2)}\n`,
          'utf8'
        );
        await waitForSpecRefresh({
          counters,
          sse,
          before: exclBefore,
          label: 'source excludedItems write build',
        });

        const before = snapshotRefresh(counters, sse);

        // --- A. POST/source contract（Spec refresh 完了は仮定しない） ---
        const copy = await httpRequest({
          port,
          method: 'POST',
          path: DESCRIPTION_API_PREFIX,
          headers,
          body: JSON.stringify({
            screenId: 'dup-source-copy',
            name: '複製元 コピー',
            description: '新説明',
            copyFromScreenId: 'dup-source',
          }),
        });
        assert.equal(copy.status, 201);

        const copyPath = path.join(
          workspaceRoot,
          'spec',
          'sample',
          'src',
          'data',
          'dup-source-copy.json'
        );
        await waitFor(
          async () => {
            try {
              await fsp.access(copyPath);
              return true;
            } catch {
              return false;
            }
          },
          { timeoutMs: 5000, label: 'duplicated description file created' }
        );

        const saved = JSON.parse(await fsp.readFile(copyPath, 'utf8'));
        assert.equal(saved.schemaVersion, '1.2');
        assert.deepEqual(saved.itemOrder, ['a', 'b']);
        assert.deepEqual(saved.excludedItems, {});
        assert.equal(saved.screen.description, '新説明');

        const sourceSaved = JSON.parse(await fsp.readFile(sourcePath, 'utf8'));
        assert.equal(sourceSaved.excludedItems.layout.name, '枠');

        // --- B. Async Spec refresh contract ---
        await waitForSpecRefresh({
          counters,
          sse,
          before,
          label: 'duplicate Spec refresh once',
        });

        assert.equal(counters.collect, before.collect);
        assert.equal(counters.buildStarted, before.buildStarted + 1);
        assert.equal(counters.buildCompleted, before.buildCompleted + 1);
        assert.equal(counters.buildFailed, before.buildFailed);
        assert.equal(countReloadTarget(sse, 'spec'), before.specReloads + 1);
      });
    }
  );

  it(
    'collected 除外 PUT: collect:0 build:1 reload(spec):1',
    { timeout: 30000 },
    async () => {
      await withSession(createImplOnlyWorkspace, async ({
        port,
        counters,
        sse,
        workspaceRoot,
      }) => {
        const headers = apiHeaders(port);

        const get1 = await httpRequest({
          port,
          path: `${DESCRIPTION_API_PREFIX}/impl-only`,
        });
        assert.equal(get1.status, 200);
        const get1Json = JSON.parse(get1.body.toString('utf8'));
        assert.ok(get1Json.collectedItemIds.includes('title'));

        const seedDoc = structuredClone(get1Json.document);
        seedDoc.screen.name = '除外 watcher';
        const seedBefore = snapshotRefresh(counters, sse);
        const putSeed = await httpRequest({
          port,
          method: 'PUT',
          path: `${DESCRIPTION_API_PREFIX}/impl-only`,
          headers,
          body: JSON.stringify({
            expectedRevision: get1Json.revision,
            document: seedDoc,
          }),
        });
        assert.equal(putSeed.status, 200);
        await waitForSpecRefresh({
          counters,
          sse,
          before: seedBefore,
          label: 'seed write build',
        });

        const before = snapshotRefresh(counters, sse);

        const get2 = await httpRequest({
          port,
          path: `${DESCRIPTION_API_PREFIX}/impl-only`,
        });
        assert.equal(get2.status, 200);
        const get2Json = JSON.parse(get2.body.toString('utf8'));
        const excluded = structuredClone(get2Json.document);
        excluded.excludedItems.title = excluded.items.title;
        delete excluded.items.title;
        excluded.itemOrder = excluded.itemOrder.filter((id) => id !== 'title');

        const putExcl = await httpRequest({
          port,
          method: 'PUT',
          path: `${DESCRIPTION_API_PREFIX}/impl-only`,
          headers,
          body: JSON.stringify({
            expectedRevision: get2Json.revision,
            document: excluded,
          }),
        });
        assert.equal(putExcl.status, 200);

        await waitForSpecRefresh({
          counters,
          sse,
          before,
          label: 'viewer build once after exclude PUT',
        });

        assert.equal(counters.collect, before.collect);
        assert.equal(counters.buildStarted, before.buildStarted + 1);
        assert.equal(counters.buildCompleted, before.buildCompleted + 1);
        assert.equal(countReloadTarget(sse, 'spec'), before.specReloads + 1);

        const saved = JSON.parse(
          await fsp.readFile(
            path.join(
              workspaceRoot,
              'spec',
              'sample',
              'src',
              'data',
              'impl-only.json'
            ),
            'utf8'
          )
        );
        assert.equal(saved.schemaVersion, '1.2');
        assert.deepEqual(Object.keys(saved.excludedItems), ['title']);
        assert.ok(!saved.items.title);
        assert.ok(!saved.itemOrder.includes('title'));
      });
    }
  );

  it(
    '除外復元 PUT: collect:0 build:1 reload(spec):1',
    { timeout: 30000 },
    async () => {
      await withSession(createImplOnlyWorkspace, async ({
        port,
        counters,
        sse,
        workspaceRoot,
      }) => {
        const headers = apiHeaders(port);

        const get1 = await httpRequest({
          port,
          path: `${DESCRIPTION_API_PREFIX}/impl-only`,
        });
        const get1Json = JSON.parse(get1.body.toString('utf8'));
        const excluded = structuredClone(get1Json.document);
        excluded.screen.name = '復元 watcher';
        excluded.excludedItems.title = excluded.items.title;
        delete excluded.items.title;
        excluded.itemOrder = [];

        const exclBefore = snapshotRefresh(counters, sse);
        const putExcl = await httpRequest({
          port,
          method: 'PUT',
          path: `${DESCRIPTION_API_PREFIX}/impl-only`,
          headers,
          body: JSON.stringify({
            expectedRevision: get1Json.revision,
            document: excluded,
          }),
        });
        assert.equal(putExcl.status, 200);
        await waitForSpecRefresh({
          counters,
          sse,
          before: exclBefore,
          label: 'exclude build',
        });

        const before = snapshotRefresh(counters, sse);

        const get2 = await httpRequest({
          port,
          path: `${DESCRIPTION_API_PREFIX}/impl-only`,
        });
        const get2Json = JSON.parse(get2.body.toString('utf8'));
        const restored = structuredClone(get2Json.document);
        restored.items.title = restored.excludedItems.title;
        delete restored.excludedItems.title;
        restored.itemOrder = [...restored.itemOrder, 'title'];

        const putRest = await httpRequest({
          port,
          method: 'PUT',
          path: `${DESCRIPTION_API_PREFIX}/impl-only`,
          headers,
          body: JSON.stringify({
            expectedRevision: get2Json.revision,
            document: restored,
          }),
        });
        assert.equal(putRest.status, 200);

        await waitForSpecRefresh({
          counters,
          sse,
          before,
          label: 'viewer build once after restore PUT',
        });

        assert.equal(counters.collect, before.collect);
        assert.equal(counters.buildStarted, before.buildStarted + 1);
        assert.equal(counters.buildCompleted, before.buildCompleted + 1);
        assert.equal(countReloadTarget(sse, 'spec'), before.specReloads + 1);

        const saved = JSON.parse(
          await fsp.readFile(
            path.join(
              workspaceRoot,
              'spec',
              'sample',
              'src',
              'data',
              'impl-only.json'
            ),
            'utf8'
          )
        );
        assert.deepEqual(saved.excludedItems, {});
        assert.deepEqual(saved.itemOrder.slice(-1), ['title']);
      });
    }
  );

  it(
    'manual-only 除外拒否: collect:0 build:0 reload:0',
    { timeout: 30000 },
    async () => {
      await withSession(createEmptyDesignWorkspace, async ({
        port,
        counters,
        sse,
      }) => {
        const headers = apiHeaders(port);

        const createBefore = snapshotRefresh(counters, sse);
        const post = await httpRequest({
          port,
          method: 'POST',
          path: DESCRIPTION_API_PREFIX,
          headers,
          body: JSON.stringify({
            screenId: 'manual-excl-watch',
            name: '手動除外拒否',
            description: '',
          }),
        });
        assert.equal(post.status, 201);
        await waitForSpecRefresh({
          counters,
          sse,
          before: createBefore,
          label: 'create build',
        });

        const get1 = await httpRequest({
          port,
          path: `${DESCRIPTION_API_PREFIX}/manual-excl-watch`,
        });
        const get1Json = JSON.parse(get1.body.toString('utf8'));
        const withManual = structuredClone(get1Json.document);
        withManual.items.manual = {
          name: '手動',
          type: 'text',
          description: '',
          note: '',
        };
        withManual.itemOrder = ['manual'];
        const addBefore = snapshotRefresh(counters, sse);
        const putAdd = await httpRequest({
          port,
          method: 'PUT',
          path: `${DESCRIPTION_API_PREFIX}/manual-excl-watch`,
          headers,
          body: JSON.stringify({
            expectedRevision: get1Json.revision,
            document: withManual,
          }),
        });
        assert.equal(putAdd.status, 200);
        await waitForSpecRefresh({
          counters,
          sse,
          before: addBefore,
          label: 'manual add build',
        });

        const before = snapshotRefresh(counters, sse);

        const get2 = await httpRequest({
          port,
          path: `${DESCRIPTION_API_PREFIX}/manual-excl-watch`,
        });
        const get2Json = JSON.parse(get2.body.toString('utf8'));
        const bad = structuredClone(get2Json.document);
        bad.excludedItems.manual = bad.items.manual;
        delete bad.items.manual;
        bad.itemOrder = [];

        const putBad = await httpRequest({
          port,
          method: 'PUT',
          path: `${DESCRIPTION_API_PREFIX}/manual-excl-watch`,
          headers,
          body: JSON.stringify({
            expectedRevision: get2Json.revision,
            document: bad,
          }),
        });
        assert.equal(putBad.status, 400);
        const badJson = JSON.parse(putBad.body.toString('utf8'));
        assert.equal(
          badJson.code,
          'SPEC_DESCRIPTION_MANUAL_ITEM_EXCLUDE_NOT_ALLOWED'
        );
        await assertNoSpecRefresh({
          counters,
          sse,
          before,
        });
      });
    }
  );

  it(
    'BUILD_ONLY 失敗は reload せず、次の変更で recovery する',
    { timeout: 30000 },
    async () => {
      await withSession(createEmptyDesignWorkspace, async ({
        port,
        counters,
        sse,
        workspaceRoot,
      }) => {
        const headers = apiHeaders(port);
        const themePath = path.join(
          workspaceRoot,
          'spec',
          'sample',
          'src',
          'theme',
          'preview.css'
        );

        // 正常結果を先に確定
        const createBefore = snapshotRefresh(counters, sse);
        const post = await httpRequest({
          port,
          method: 'POST',
          path: DESCRIPTION_API_PREFIX,
          headers,
          body: JSON.stringify({
            screenId: 'build-fail-watch',
            name: '失敗後復旧',
            description: '',
          }),
        });
        assert.equal(post.status, 201);
        await waitForSpecRefresh({
          counters,
          sse,
          before: createBefore,
          label: 'baseline success build',
        });

        const beforeFail = snapshotRefresh(counters, sse);
        const beforeHtml = await fsp.readFile(
          path.join(workspaceRoot, 'spec', 'sample', 'dist', 'index.html'),
          'utf8'
        );

        counters.failNextBuild = true;
        await fsp.writeFile(themePath, '/* fail once */\n', 'utf8');

        await waitFor(
          () =>
            counters.buildStarted === beforeFail.buildStarted + 1 &&
            counters.buildFailed === beforeFail.buildFailed + 1,
          { timeoutMs: 10000, label: 'injected build failure' }
        );

        assert.equal(counters.buildCompleted, beforeFail.buildCompleted);
        assert.equal(countReloadTarget(sse, 'spec'), beforeFail.specReloads);
        assert.equal(counters.collect, beforeFail.collect);
        assert.ok(counters.lastBuildError);
        assert.equal(counters.lastBuildError.code, 'JSKIM_SPEC_BUILD_FAIL');
        assert.equal(
          await fsp.readFile(
            path.join(workspaceRoot, 'spec', 'sample', 'dist', 'index.html'),
            'utf8'
          ),
          beforeHtml
        );

        const beforeRecover = snapshotRefresh(counters, sse);
        await fsp.writeFile(themePath, '/* recover */\n', 'utf8');
        await waitForSpecRefresh({
          counters,
          sse,
          before: beforeRecover,
          label: 'recovery build after failure',
        });

        assert.equal(counters.collect, beforeRecover.collect);
        assert.equal(counters.buildCompleted, beforeRecover.buildCompleted + 1);
        assert.equal(counters.buildFailed, beforeRecover.buildFailed);
        assert.equal(
          countReloadTarget(sse, 'spec'),
          beforeRecover.specReloads + 1
        );
      });
    }
  );

  it(
    'withSession: runtime 起動失敗でも workspace を削除し起動エラーを保持する',
    { timeout: 30000 },
    async () => {
      let workspaceRoot = null;
      const startupErr = new Error('意図的な runtime 起動失敗');
      startupErr.code = 'JSKIM_TEST_STARTUP_FAIL';
      let callbackRan = false;

      await assert.rejects(
        () =>
          withSession(
            async () => {
              workspaceRoot = await createEmptyDesignWorkspace();
              return workspaceRoot;
            },
            async () => {
              callbackRan = true;
              assert.fail('callback は実行されない');
            },
            {
              startRuntimeFn: async () => {
                throw startupErr;
              },
              skipMetadataProbe: true,
            }
          ),
        (err) => {
          assert.equal(err, startupErr);
          assert.equal(err.code, 'JSKIM_TEST_STARTUP_FAIL');
          return true;
        }
      );

      assert.equal(callbackRan, false);
      assert.ok(workspaceRoot);
      await assert.rejects(() => fsp.access(workspaceRoot), {
        code: 'ENOENT',
      });
    }
  );

  it(
    'withSession: callback 失敗と runtime.close 失敗を AggregateError で両方保持する',
    { timeout: 30000 },
    async () => {
      let workspaceRoot = null;
      const callbackErr = new Error('意図的な callback 失敗');
      callbackErr.code = 'JSKIM_TEST_CALLBACK_FAIL';
      const closeErr = new Error('意図的な runtime.close 失敗');
      closeErr.code = 'JSKIM_TEST_CLOSE_FAIL';

      await assert.rejects(
        () =>
          withSession(
            async () => {
              workspaceRoot = await createEmptyDesignWorkspace();
              return workspaceRoot;
            },
            async (session) => {
              const originalClose = session.close.bind(session);
              session.close = async () => {
                try {
                  await originalClose();
                } catch {
                  // close 本体の成否に依存せず、注入エラーを必ず送出する
                }
                throw closeErr;
              };
              throw callbackErr;
            },
            { skipMetadataProbe: true }
          ),
        (err) => {
          assert.ok(err instanceof AggregateError);
          assert.equal(err.errors.length, 2);
          assert.equal(err.errors[0], callbackErr);
          assert.equal(err.errors[0].code, 'JSKIM_TEST_CALLBACK_FAIL');
          assert.match(err.errors[1].message, /runtime\.close/);
          assert.equal(err.errors[1].cause, closeErr);
          assert.equal(err.errors[1].cleanupStage, 'runtime.close');
          return true;
        }
      );

      assert.ok(workspaceRoot);
      await assert.rejects(() => fsp.access(workspaceRoot), {
        code: 'ENOENT',
      });
    }
  );

  it(
    'probe quiescence: 追加 refresh 後に安定してから baseline を許可する',
    { timeout: 10000 },
    async () => {
      const counters = createCounters();
      const sse = { typedEvents: [] };

      counters.buildStarted = 1;
      counters.buildCompleted = 1;
      sse.typedEvents.push({
        name: 'reload',
        data: JSON.stringify({ target: 'spec' }),
      });

      let midWindowInjected = false;
      const drainPromise = waitForCountersQuiescence(counters, sse, {
        windowMs: 200,
        timeoutMs: 5000,
        label: 'probe drain deterministic',
      });

      setTimeout(() => {
        midWindowInjected = true;
        counters.buildStarted = 2;
        counters.buildCompleted = 2;
        sse.typedEvents.push({
          name: 'reload',
          data: JSON.stringify({ target: 'spec' }),
        });
      }, 50);

      const stable = await drainPromise;
      assert.equal(midWindowInjected, true);
      assert.equal(stable.buildCompleted, 2);
      assert.equal(stable.specReloads, 2);
      assert.equal(counters.buildCompleted, 2);
      assert.equal(countReloadTarget(sse, 'spec'), 2);

      // return 時点の snapshot は安定済み（追加変化なし）
      const after = snapshotRefresh(counters, sse);
      assert.deepEqual(after, stable);
    }
  );
});
