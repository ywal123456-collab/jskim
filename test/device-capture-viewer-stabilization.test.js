'use strict';

/**
 * Phase 7C-1A-3S: Viewer 再収集 UX の未検証 same-port 安定化
 * - stale → 再収集 → current
 * - collecting / 409 / barrier 完了
 * - 失敗保全 → 再試行成功
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
const PLAYWRIGHT = require(path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'node_modules',
  'playwright'
));
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

const SCREEN_ID = 'device-capture-demo';
const STATE_ID = 'default';

function parseJson(res) {
  return JSON.parse(res.body.toString('utf8'));
}

function originHeaders(port) {
  return {
    'Content-Type': 'application/json',
    Origin: `http://127.0.0.1:${port}`,
    Host: `127.0.0.1:${port}`,
  };
}

describe('Device Capture Viewer stabilization (7C-1A-3S)', () => {
  /** @type {Array<{ close: Function, cleanup: Function }>} */
  const sessions = [];
  /** @type {object|null} */
  let companion = null;
  /** @type {import('playwright').Browser|null} */
  let browser = null;

  before(async () => {
    companion = await import(pathToFileURL(COMPANION_ENTRY).href);
    browser = await PLAYWRIGHT.chromium.launch({ headless: true });
  });

  after(async () => {
    if (browser) {
      await browser.close().catch(() => {});
    }
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
      path.join(os.tmpdir(), 'jskim-dc-stab-')
    );
    const pagesDir = path.join(workspaceRoot, 'src/sample/pages');
    await fsp.mkdir(pagesDir, { recursive: true });
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
    for (const name of await fsp.readdir(FIXTURE_PUBLIC)) {
      await fsp.copyFile(
        path.join(FIXTURE_PUBLIC, name),
        path.join(pagesDir, name)
      );
    }
    const snapDir = path.join(
      workspaceRoot,
      `spec/sample/src/snapshots/${SCREEN_ID}`
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
    await fsp.mkdir(path.join(workspaceRoot, 'spec/sample/src/captures'), {
      recursive: true,
    });
    const dataDir = path.join(workspaceRoot, 'spec/sample/src/data');
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.writeFile(
      path.join(dataDir, `${SCREEN_ID}.json`),
      `${JSON.stringify(
        {
          schemaVersion: '1.2',
          screen: {
            id: SCREEN_ID,
            name: 'Device Capture Demo',
            description: 'LINKED fixture',
          },
          itemOrder: [],
          excludedItems: {},
          items: {},
        },
        null,
        2
      )}\n`
    );
    return workspaceRoot;
  }

  /**
   * @param {string} workspaceRoot
   * @param {{
   *   getDeviceCaptureHooks?: Function,
   *   wrapCollect?: (fn: Function) => Function,
   * }} [extra]
   */
  async function startRuntime(workspaceRoot, extra = {}) {
    const port = await getFreePort();
    const counters = { collect: 0, build: 0, buildsInFlight: 0, captureCalls: 0 };
    const baseCollect = companion.collectDeviceCapture;
    const collectWrapped =
      typeof extra.wrapCollect === 'function'
        ? extra.wrapCollect(baseCollect)
        : async (opts) => {
            counters.captureCalls += 1;
            return baseCollect(opts);
          };

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
      collectDeviceCapture: collectWrapped,
      getDeviceCapturePublicInfo: companion.getDeviceCapturePublicInfo,
      getDeviceCaptureHooks: extra.getDeviceCaptureHooks,
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

  async function apiCollect(port, viewport) {
    return httpRequest({
      port,
      method: 'POST',
      path: DEVICE_CAPTURE_COLLECT_PATH,
      headers: originHeaders(port),
      body: JSON.stringify({
        screenId: SCREEN_ID,
        stateId: STATE_ID,
        viewport,
      }),
      timeoutMs: 90000,
    });
  }

  async function apiStatus(port, viewport) {
    return httpRequest({
      port,
      path: `${DEVICE_CAPTURE_STATUS_PATH}?screenId=${SCREEN_ID}&stateId=${STATE_ID}&viewport=${viewport}`,
      headers: {
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      },
    });
  }

  async function fetchScreen(port) {
    const res = await httpRequest({
      port,
      path: `/spec/data/screens/${SCREEN_ID}.json`,
    });
    assert.equal(res.status, 200);
    return parseJson(res);
  }

  async function openScreen(page, port, counters, provider) {
    await waitFor(() => counters.buildsInFlight === 0, {
      timeoutMs: 30000,
      label: 'builds idle before navigate',
    });
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await page.goto(`http://127.0.0.1:${port}/spec/screens/${SCREEN_ID}`, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        // eslint-disable-next-line no-await-in-loop
        await page.evaluate((p) => {
          sessionStorage.setItem('jskim-spec-preview-provider:sample', p);
        }, provider);
        // eslint-disable-next-line no-await-in-loop
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (lastErr) {
      throw lastErr;
    }
    await page.waitForSelector('[data-testid="preview-provider-tabs"]', {
      timeout: 20000,
    });
  }

  it('stale → Viewer 再収集 → current（他 viewport 維持）', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startRuntime(workspaceRoot);
    const { port, counters } = session;
    const sse = await openSse({ port, timeoutMs: 10000 });
    const page = await browser.newPage();

    const postPc = await apiCollect(port, 'pc');
    assert.equal(postPc.status, 200, postPc.body.toString('utf8'));
    assert.equal(parseJson(postPc).result, 'created');
    await waitFor(
      () => counters.build >= 1 && counters.buildsInFlight === 0,
      { timeoutMs: 60000, label: 'PC created build' }
    );

    const postSp = await apiCollect(port, 'sp');
    assert.equal(postSp.status, 200, postSp.body.toString('utf8'));
    await waitFor(
      () => counters.build >= 2 && counters.buildsInFlight === 0,
      { timeoutMs: 60000, label: 'SP created build' }
    );

    const before = await fetchScreen(port);
    const beforeState = before.states.find((s) => s.id === STATE_ID);
    assert.equal(beforeState.deviceCaptures.pc.status, 'current');
    assert.equal(beforeState.deviceCaptures.sp.status, 'current');
    const oldPcPath = beforeState.deviceCaptures.pc.imagePath;
    const oldSpPath = beforeState.deviceCaptures.sp.imagePath;
    const oldPcRev = beforeState.deviceCaptures.pc.imageRevision;
    const captureCallsBeforeStale = counters.captureCalls;
    const buildBeforeStale = counters.build;
    const reloadBeforeStale = countReloadTarget(sse, 'spec');

    // inputRevision に含まれる snapshot を変更（Capture 自動実行なし）
    const snapPath = path.join(
      workspaceRoot,
      `spec/sample/src/snapshots/${SCREEN_ID}/default.html`
    );
    await fsp.writeFile(snapPath, '<html><!--snap-changed-for-stale--></html>\n');
    // 再収集時の screenshot も変える（コメントではなく可視 DOM）
    const indexHtml = path.join(workspaceRoot, 'src/sample/pages/index.html');
    const prevHtml = await fsp.readFile(indexHtml, 'utf8');
    const marker = `<div data-stale-marker="1" style="height:48px;background:#c00;color:#fff">STALE-${Date.now()}</div>`;
    const nextHtml = prevHtml.includes('</body>')
      ? prevHtml.replace('</body>', `${marker}</body>`)
      : `${prevHtml}\n${marker}\n`;
    await fsp.writeFile(indexHtml, nextHtml);
    // snapshots は watcher IGNORE → Viewer rebuild のみ（Capture は走らない）
    await companion.buildScreenSpecViewer({
      rootDir: workspaceRoot,
      projectName: 'sample',
      base: '/spec/',
    });
    await waitFor(() => counters.buildsInFlight === 0, {
      timeoutMs: 20000,
      label: 'settle after source change',
    });
    assert.equal(
      counters.captureCalls,
      captureCallsBeforeStale,
      'stale 化で Device Capture が自動実行されてはいけない'
    );

    const staleScreen = await fetchScreen(port);
    const staleState = staleScreen.states.find((s) => s.id === STATE_ID);
    assert.equal(staleState.deviceCaptures.pc.status, 'stale');
    assert.equal(staleState.deviceCaptures.sp.status, 'stale');
    assert.equal(staleState.deviceCaptures.pc.imagePath, oldPcPath);

    await openScreen(page, port, counters, 'pc');
    await page.waitForSelector('[data-testid="device-capture-panel"]');
    assert.match(
      await page.locator('[data-testid="device-capture-status-label"]').innerText(),
      /更新が必要/
    );
    assert.match(
      await page.locator('[data-testid="device-capture-guidance"]').innerText(),
      /実装またはリソースが変更/
    );
    const staleImg = page.locator('[data-testid="device-capture-image"] img');
    await staleImg.waitFor({ state: 'visible' });
    const staleSrc = await staleImg.getAttribute('src');
    assert.ok(staleSrc.includes(oldPcPath));
    assert.ok(!/[?&](t|timestamp|random)=/.test(staleSrc || ''));
    const collectBtn = page.locator('[data-testid="device-capture-collect"]');
    assert.equal(await collectBtn.isDisabled(), false);

    const buildBeforeRecollect = counters.build;
    const reloadBeforeRecollect = countReloadTarget(sse, 'spec');
    await collectBtn.click();
    await page.waitForSelector('[data-testid="device-capture-progress"]', {
      timeout: 5000,
    });

    await waitFor(
      () =>
        counters.build >= buildBeforeRecollect + 1 &&
        counters.buildsInFlight === 0,
      { timeoutMs: 90000, label: 'stale recollect build' }
    );
    await waitFor(
      () => countReloadTarget(sse, 'spec') >= reloadBeforeRecollect + 1,
      { timeoutMs: 30000, label: 'stale recollect reload(spec)' }
    );

    await openScreen(page, port, counters, 'pc');
    await waitFor(
      async () =>
        (await page.locator('[data-testid="device-capture-status-label"]').innerText()).includes(
          '最新'
        ),
      { timeoutMs: 20000, label: 'PC current after recollect' }
    );
    const after = await fetchScreen(port);
    const afterState = after.states.find((s) => s.id === STATE_ID);
    assert.equal(afterState.deviceCaptures.pc.status, 'current');
    assert.notEqual(
      afterState.deviceCaptures.pc.inputRevision,
      staleState.deviceCaptures.pc.inputRevision,
      '再収集後は inputRevision が更新される'
    );
    // ライブ HTML も変えているので screenshot も変わり revision-addressed path が更新される
    assert.notEqual(afterState.deviceCaptures.pc.imagePath, oldPcPath);
    assert.notEqual(afterState.deviceCaptures.pc.imageRevision, oldPcRev);
    // SP は再収集していないので stale のまま（自動 Capture なし）
    assert.equal(afterState.deviceCaptures.sp.status, 'stale');
    assert.equal(afterState.deviceCaptures.sp.imagePath, oldSpPath);

    const newSrc = await page
      .locator('[data-testid="device-capture-image"] img')
      .getAttribute('src');
    assert.ok(newSrc.includes(afterState.deviceCaptures.pc.imagePath));
    assert.ok(!/[?&](t|timestamp|random)=/.test(newSrc || ''));
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem('jskim-spec-pending-device-capture:sample')
      ),
      null
    );

    // stale 化の間に Device Capture は増えていない（上で検証済み）
    void buildBeforeStale;
    void reloadBeforeStale;

    await page.close();
    sse.close();
  });

  it('collecting / polling / 同一 key 409 → barrier 解除で完了', async () => {
    const workspaceRoot = await prepareWorkspace();
    /** @type {{ release: null|Function, entered: null|Promise, resolveEntered: null|Function }} */
    const barrierCtl = {
      release: null,
      entered: null,
      resolveEntered: null,
    };
    const hooks = {
      enabled: false,
      awaitBarrier: async () => {
        if (!hooks.enabled) {
          return;
        }
        if (barrierCtl.resolveEntered) {
          barrierCtl.resolveEntered();
          barrierCtl.resolveEntered = null;
        }
        await new Promise((resolve) => {
          barrierCtl.release = resolve;
        });
      },
    };

    const session = await startRuntime(workspaceRoot, {
      getDeviceCaptureHooks: () =>
        hooks.enabled ? { awaitBarrier: hooks.awaitBarrier } : {},
    });
    const { port, counters } = session;
    const sse = await openSse({ port, timeoutMs: 10000 });
    const page = await browser.newPage();

    // 既存 current（barrier なし）
    assert.equal((await apiCollect(port, 'pc')).status, 200);
    await waitFor(
      () => counters.build >= 1 && counters.buildsInFlight === 0,
      { timeoutMs: 60000, label: 'PC baseline build' }
    );
    await waitFor(() => countReloadTarget(sse, 'spec') >= 1, {
      timeoutMs: 20000,
      label: 'PC baseline reload(spec)',
    });
    const baselineCalls = counters.captureCalls;
    const baselineBuild = counters.build;
    const baselineReload = countReloadTarget(sse, 'spec');

    barrierCtl.entered = new Promise((resolve) => {
      barrierCtl.resolveEntered = resolve;
    });
    hooks.enabled = true;

    await openScreen(page, port, counters, 'pc');
    await page.waitForSelector('[data-testid="device-capture-collect"]');

    // click はすぐ完了し、POST は barrier で待機する
    await page.click('[data-testid="device-capture-collect"]');
    await barrierCtl.entered;
    // runtime collecting（API）
    await waitFor(
      async () => {
        const st = parseJson(await apiStatus(port, 'pc'));
        return st.runtime.status === 'collecting';
      },
      { timeoutMs: 10000, label: 'runtime collecting' }
    );
    await waitFor(
      async () => {
        const progress = page.locator('[data-testid="device-capture-progress"]');
        return (
          (await progress.count()) > 0 &&
          (await progress.innerText()).includes('収集')
        );
      },
      { timeoutMs: 10000, label: 'Viewer collecting UI' }
    );
    assert.equal(
      await page.locator('[data-testid="device-capture-collect"]').isDisabled(),
      true
    );
    // 既存 current 画像は維持
    assert.equal(
      await page.locator('[data-testid="device-capture-image"] img').count(),
      1
    );
    assert.equal(counters.captureCalls, baselineCalls + 1);

    const conflict = await apiCollect(port, 'pc');
    assert.equal(conflict.status, 409);
    assert.equal(parseJson(conflict).code, 'SPEC_DEVICE_CAPTURE_IN_PROGRESS');
    assert.equal(
      counters.captureCalls,
      baselineCalls + 1,
      '409 で二度目の core 呼び出しがあってはいけない'
    );
    assert.equal(counters.build, baselineBuild);
    assert.equal(countReloadTarget(sse, 'spec'), baselineReload);

    // Live へ移動しても barrier 中の Capture は継続。polling は Live で止める
    await page.click('[data-provider="live"]');
    await page.waitForSelector('[data-testid="preview-panel-live"]');

    // barrier 解除（同一入力なら unchanged → build/reload 0 もあり得る）
    assert.ok(typeof barrierCtl.release === 'function');
    barrierCtl.release();

    await waitFor(
      async () => {
        const st = parseJson(await apiStatus(port, 'pc'));
        return st.runtime.status === 'idle';
      },
      { timeoutMs: 90000, label: 'runtime idle after barrier' }
    );
    await waitFor(() => counters.buildsInFlight === 0, {
      timeoutMs: 20000,
      label: 'builds idle after barrier',
    });
    assert.ok(
      counters.build === baselineBuild ||
        counters.build === baselineBuild + 1,
      `unexpected build count: ${counters.build} baseline=${baselineBuild}`
    );
    assert.ok(
      countReloadTarget(sse, 'spec') === baselineReload ||
        countReloadTarget(sse, 'spec') === baselineReload + 1
    );

    await openScreen(page, port, counters, 'pc');
    await waitFor(
      async () =>
        (await page.locator('[data-testid="device-capture-status-label"]').innerText()).includes(
          '最新'
        ),
      { timeoutMs: 20000, label: 'PC current after barrier' }
    );
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem('jskim-spec-pending-device-capture:sample')
      ),
      null
    );
    assert.equal(counters.captureCalls, baselineCalls + 1);

    hooks.enabled = false;
    await page.close();
    sse.close();
  });

  it('失敗 → 既存画像維持 → 再試行成功', async () => {
    const workspaceRoot = await prepareWorkspace();
    const hookState = { failScreenshot: false };
    const session = await startRuntime(workspaceRoot, {
      getDeviceCaptureHooks: () =>
        hookState.failScreenshot ? { failScreenshot: true } : {},
    });
    const { port, counters } = session;
    const sse = await openSse({ port, timeoutMs: 10000 });
    const page = await browser.newPage();

    assert.equal((await apiCollect(port, 'pc')).status, 200);
    await waitFor(
      () => counters.build >= 1 && counters.buildsInFlight === 0,
      { timeoutMs: 60000, label: 'PC baseline for fail test' }
    );

    const metaPath = path.join(
      workspaceRoot,
      `spec/sample/src/captures/${SCREEN_ID}/${STATE_ID}/pc/meta.json`
    );
    const metaBefore = fs.readFileSync(metaPath);
    const screenBefore = await fetchScreen(port);
    const pcBefore = screenBefore.states.find((s) => s.id === STATE_ID)
      .deviceCaptures.pc;
    assert.equal(pcBefore.status, 'current');
    const imgBeforePath = path.join(
      workspaceRoot,
      'spec/sample/dist/data',
      pcBefore.imagePath
    );
    const imgBefore = fs.readFileSync(imgBeforePath);
    const buildBeforeFail = counters.build;
    const reloadBeforeFail = countReloadTarget(sse, 'spec');
    const callsBeforeFail = counters.captureCalls;

    hookState.failScreenshot = true;
    await openScreen(page, port, counters, 'pc');
    await page.click('[data-testid="device-capture-collect"]');

    await waitFor(
      async () => {
        const err = page.locator('[data-testid="device-capture-error"]');
        return (
          (await err.count()) > 0 &&
          (await err.innerText()).includes('失敗')
        );
      },
      { timeoutMs: 60000, label: 'failed UI' }
    );

    assert.ok(fs.readFileSync(metaPath).equals(metaBefore));
    assert.ok(fs.readFileSync(imgBeforePath).equals(imgBefore));
    assert.equal(counters.build, buildBeforeFail);
    assert.equal(countReloadTarget(sse, 'spec'), reloadBeforeFail);
    assert.equal(counters.captureCalls, callsBeforeFail + 1);

    const statusFail = parseJson(await apiStatus(port, 'pc'));
    assert.equal(statusFail.runtime.status, 'failed');
    assert.equal(statusFail.capture.status, 'current');

    // 既存画像は表示されたまま
    assert.equal(
      await page.locator('[data-testid="device-capture-image"] img').count(),
      1
    );
    assert.equal(
      await page.locator('[data-testid="device-capture-collect"]').isDisabled(),
      false
    );
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem('jskim-spec-pending-device-capture:sample')
      ),
      null
    );

    // 再試行成功
    hookState.failScreenshot = false;
    const buildBeforeRetry = counters.build;
    await page.click('[data-testid="device-capture-collect"]');
    await waitFor(
      async () => {
        const st = parseJson(await apiStatus(port, 'pc'));
        return st.runtime.status === 'idle';
      },
      { timeoutMs: 90000, label: 'runtime idle after retry' }
    );

    // unchanged の場合 build 0、updated なら 1。どちらも failed が消えること
    await openScreen(page, port, counters, 'pc');
    await waitFor(
      async () => {
        const err = page.locator('[data-testid="device-capture-error"]');
        const label = await page
          .locator('[data-testid="device-capture-status-label"]')
          .innerText();
        return (await err.count()) === 0 && label.includes('最新');
      },
      { timeoutMs: 20000, label: 'failed cleared and current' }
    );

    const statusOk = parseJson(await apiStatus(port, 'pc'));
    assert.equal(statusOk.runtime.status, 'idle');
    assert.equal(statusOk.capture.status, 'current');
    // meta commit があった場合のみ build が増える（unchanged なら 0）
    assert.ok(counters.build === buildBeforeRetry || counters.build === buildBeforeRetry + 1);

    await page.close();
    sse.close();
  });
});
