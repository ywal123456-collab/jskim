'use strict';

/**
 * Phase 7C-1A-2: Device Capture API + watcher BUILD_ONLY same-port 検証。
 */

const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSpecDevRuntime } = require('../scripts/lib/create-spec-dev-runtime');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest, openSse } = require('./helpers/http-request');
const { waitFor } = require('./helpers/wait-for-output');
const {
  DEVICE_CAPTURE_COLLECT_PATH,
  DEVICE_CAPTURE_STATUS_PATH,
} = require('../scripts/lib/create-device-capture-api');

const REPO_ROOT = path.resolve(__dirname, '..');
const COMPANION_ENTRY = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js'
);
const FIXTURE_PUBLIC = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'test',
  'fixtures',
  'device-capture',
  'public'
);
const FIXTURE_SOURCE = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'test',
  'fixtures',
  'device-capture',
  'source.spec.json'
);

function parseJson(res) {
  return JSON.parse(res.body.toString('utf8'));
}

describe('Device Capture API same-port integration', () => {
  /** @type {Array<{ close: Function, cleanup: Function }>} */
  const sessions = [];
  /** @type {object|null} */
  let companion = null;

  before(async () => {
    companion = await import(pathToFileURL(COMPANION_ENTRY).href);
  });

  after(async () => {
    for (const entry of sessions) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.race([
        entry.close().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
      // eslint-disable-next-line no-await-in-loop
      await entry.cleanup().catch(() => {});
    }
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

  async function prepareWorkspace() {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-dc-api-')
    );
    const pagesDir = path.join(workspaceRoot, 'src/sample/pages');
    const outDir = path.join(workspaceRoot, 'dist/sample');
    await fsp.mkdir(pagesDir, { recursive: true });
    await fsp.mkdir(outDir, { recursive: true });
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
`
    );
    await fsp.copyFile(FIXTURE_SOURCE, path.join(pagesDir, 'demo.spec.json'));
    // source build で dist へ載るよう pages に置く（clean 後も再配置不要）
    for (const name of await fsp.readdir(FIXTURE_PUBLIC)) {
      await fsp.copyFile(
        path.join(FIXTURE_PUBLIC, name),
        path.join(pagesDir, name)
      );
    }
    const snapDir = path.join(
      workspaceRoot,
      'spec/sample/src/snapshots/device-capture-demo'
    );
    await fsp.mkdir(snapDir, { recursive: true });
    await fsp.writeFile(
      path.join(snapDir, 'default.html'),
      '<html><!--snap--></html>\n'
    );
    await fsp.writeFile(
      path.join(snapDir, 'help-modal.html'),
      '<html><!--help--></html>\n'
    );
    // watcher が captures を最初から監視できるよう空ディレクトリを用意
    await fsp.mkdir(
      path.join(workspaceRoot, 'spec/sample/src/captures'),
      { recursive: true },
    );
    return workspaceRoot;
  }

  async function startRuntime(workspaceRoot, extra = {}) {
    const port = await getFreePort();
    const counters = { collect: 0, build: 0, buildsInFlight: 0 };
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
        return { screens: 1, states: 2, updated: 0, unchanged: 2 };
      },
      buildFn: async () => {
        counters.buildsInFlight += 1;
        try {
          await companion.buildScreenSpecViewer({
            rootDir: workspaceRoot,
            projectName: 'sample',
            base: '/spec/',
          });
          // 完了後に数える（開始時だと後続の手動 build と競合する）
          counters.build += 1;
          return {
            outDir: path.join(workspaceRoot, 'spec/sample/dist'),
          };
        } finally {
          counters.buildsInFlight -= 1;
        }
      },
      classifyPath: companion.classifyScreenSpecWatchPath,
      mergeKinds: companion.mergeScreenSpecWatchKinds,
      createFileDescriptionStore: companion.createFileDescriptionStore,
      loadScreenSpecProject: companion.loadScreenSpecProject,
      collectDeviceCapture: companion.collectDeviceCapture,
      getDeviceCapturePublicInfo: companion.getDeviceCapturePublicInfo,
      ...extra,
    });
    await runtime.start();
    await companion.buildScreenSpecViewer({
      rootDir: workspaceRoot,
      projectName: 'sample',
      base: '/spec/',
    });
    const entry = {
      workspaceRoot,
      port,
      counters,
      runtime,
      close: () =>
        Promise.race([
          runtime.close(),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]),
      cleanup: () => fsp.rm(workspaceRoot, { recursive: true, force: true }),
    };
    sessions.push(entry);
    return entry;
  }

  it('POST PC/SP・unchanged・stale・失敗保全', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startRuntime(workspaceRoot);
    const { port, counters } = session;
    const sse = await openSse({ port, timeoutMs: 10000 });

    const indexCheck = await httpRequest({ port, path: '/index.html' });
    assert.equal(
      indexCheck.status,
      200,
      `Capture 用 route が無い: ${indexCheck.body.toString('utf8').slice(0, 80)}`,
    );

    const buildBefore = counters.build;
    const reloadBefore = countReloadTarget(sse, 'spec');

    const postPc = await httpRequest({
      port,
      method: 'POST',
      path: DEVICE_CAPTURE_COLLECT_PATH,
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      },
      body: JSON.stringify({
        screenId: 'device-capture-demo',
        stateId: 'default',
        viewport: 'pc',
      }),
      timeoutMs: 60000,
    });
    assert.equal(
      postPc.status,
      200,
      postPc.body.toString('utf8'),
    );
    const pcBody = parseJson(postPc);
    assert.equal(pcBody.result, 'created');
    assert.equal(pcBody.capture.imageWidth, 1440);
    assert.ok(
      fs.existsSync(
        path.join(
          workspaceRoot,
          'spec/sample/src/captures/device-capture-demo/default/pc/meta.json',
        ),
      ),
    );

    await waitFor(() => counters.build >= buildBefore + 1, {
      timeoutMs: 20000,
      label: 'PC Capture viewer build',
    });
    await waitFor(() => countReloadTarget(sse, 'spec') >= reloadBefore + 1, {
      timeoutMs: 20000,
      label: 'PC Capture reload(spec)',
    });
    assert.equal(counters.collect, 0);

    const screenJson = await httpRequest({
      port,
      path: '/spec/data/screens/device-capture-demo.json',
    });
    assert.equal(screenJson.status, 200);
    const screen = parseJson(screenJson);
    const pcState = screen.states.find((s) => s.id === 'default');
    assert.equal(pcState.deviceCaptures.pc.status, 'current');
    const pcImg = await httpRequest({
      port,
      path: `/spec/data/${pcState.deviceCaptures.pc.imagePath}`,
    });
    assert.equal(pcImg.status, 200);
    assert.equal(pcImg.body[0], 0x89);

    const metaPath = path.join(
      workspaceRoot,
      'spec/sample/src/captures/device-capture-demo/default/pc/meta.json'
    );
    const metaBefore = fs.readFileSync(metaPath);
    const buildMid = counters.build;
    const reloadMid = countReloadTarget(sse, 'spec');

    const unchanged = await httpRequest({
      port,
      method: 'POST',
      path: DEVICE_CAPTURE_COLLECT_PATH,
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      },
      body: JSON.stringify({
        screenId: 'device-capture-demo',
        stateId: 'default',
        viewport: 'pc',
      }),
      timeoutMs: 60000,
    });
    assert.equal(unchanged.status, 200);
    assert.equal(parseJson(unchanged).result, 'unchanged');
    assert.ok(fs.readFileSync(metaPath).equals(metaBefore));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(counters.build, buildMid);
    assert.equal(countReloadTarget(sse, 'spec'), reloadMid);

    const postSp = await httpRequest({
      port,
      method: 'POST',
      path: DEVICE_CAPTURE_COLLECT_PATH,
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      },
      body: JSON.stringify({
        screenId: 'device-capture-demo',
        stateId: 'default',
        viewport: 'sp',
      }),
      timeoutMs: 60000,
    });
    assert.equal(postSp.status, 200);
    assert.equal(parseJson(postSp).capture.imageWidth, 375);
    await waitFor(
      () => counters.build >= buildMid + 1 && counters.buildsInFlight === 0,
      {
        timeoutMs: 20000,
        label: 'SP Capture build settled',
      }
    );

    const snapPath = path.join(
      workspaceRoot,
      'spec/sample/src/snapshots/device-capture-demo/default.html'
    );
    await fsp.writeFile(snapPath, '<html><!--changed--></html>\n');
    // snapshot は watcher IGNORE のため Viewer を手動 rebuild
    await companion.buildScreenSpecViewer({
      rootDir: workspaceRoot,
      projectName: 'sample',
      base: '/spec/',
    });
    assert.equal(
      companion.getDeviceCapturePublicInfo({
        rootDir: workspaceRoot,
        projectName: 'sample',
        screenId: 'device-capture-demo',
        stateId: 'default',
        viewport: 'pc',
      }).status,
      'stale'
    );
    const screenStale = parseJson(
      await httpRequest({
        port,
        path: '/spec/data/screens/device-capture-demo.json',
      })
    );
    const st = screenStale.states.find((s) => s.id === 'default');
    assert.equal(st.deviceCaptures.pc.status, 'stale');
    assert.equal(st.deviceCaptures.sp.status, 'stale');

    sse.close();
    await session.close();
    sessions.pop();

    const session2 = await startRuntime(workspaceRoot, {
      getDeviceCaptureHooks: () => ({ failScreenshot: true }),
    });
    const failPost = await httpRequest({
      port: session2.port,
      method: 'POST',
      path: DEVICE_CAPTURE_COLLECT_PATH,
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${session2.port}`,
        Host: `127.0.0.1:${session2.port}`,
      },
      body: JSON.stringify({
        screenId: 'device-capture-demo',
        stateId: 'default',
        viewport: 'pc',
      }),
      timeoutMs: 60000,
    });
    assert.equal(failPost.status, 500);
    assert.ok(fs.readFileSync(metaPath).equals(metaBefore));
    const statusFail = parseJson(
      await httpRequest({
        port: session2.port,
        path: `${DEVICE_CAPTURE_STATUS_PATH}?screenId=device-capture-demo&stateId=default&viewport=pc`,
        headers: {
          Origin: `http://127.0.0.1:${session2.port}`,
          Host: `127.0.0.1:${session2.port}`,
        },
      })
    );
    assert.equal(statusFail.runtime.status, 'failed');
    assert.equal(statusFail.capture.status, 'stale');
  });
});
