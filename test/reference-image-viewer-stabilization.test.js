'use strict';

/**
 * Phase 7C-2A-3S: Reference Image Viewer の競合・画面作成/複製を
 * same-port browser integration で安定化検証する。
 *
 * 新規機能追加ではない。決定的 barrier / core call count / runtime status /
 * manifest revision / network count で検証する。
 */

const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');
const { createSpecDevRuntime } = require('../scripts/lib/create-spec-dev-runtime');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest, openSse } = require('./helpers/http-request');
const { waitFor } = require('./helpers/wait-for-output');
const { REFERENCE_IMAGE_STATUS_PATH } = require('../scripts/lib/create-reference-image-api');
const { buildMultipartBody } = require('./helpers/multipart');

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

const SCREEN_DESIGN = 'design-screen';
const SCREEN_LINKED = 'device-capture-demo';
const PENDING_REF_KEY = 'jskim-spec-pending-reference-image:sample';
const PENDING_SCREEN_KEY = 'jskim-spec-pending-screen';

function parseJson(res) {
  return JSON.parse(res.body.toString('utf8'));
}

function contentRevision(buf) {
  return `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crcBuf]);
}

function buildValidPng(width, height, rgb = [200, 40, 40]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = pngChunk('IHDR', ihdrData);
  const rowBytes = width * 3;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const off = rowStart + 1 + x * 3;
      raw[off] = rgb[0];
      raw[off + 1] = rgb[1];
      raw[off + 2] = rgb[2];
    }
  }
  const idat = pngChunk('IDAT', zlib.deflateSync(raw));
  const iend = pngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

function createBarrier() {
  /** @type {{ release: null|Function, entered: null|Promise, resolveEntered: null|Function, enabled: boolean }} */
  const ctl = {
    release: null,
    entered: null,
    resolveEntered: null,
    enabled: false,
  };
  const awaitBarrier = async () => {
    if (!ctl.enabled) {
      return;
    }
    if (ctl.resolveEntered) {
      ctl.resolveEntered();
      ctl.resolveEntered = null;
    }
    await new Promise((resolve) => {
      ctl.release = resolve;
    });
  };
  const arm = () => {
    ctl.entered = new Promise((resolve) => {
      ctl.resolveEntered = resolve;
    });
    ctl.enabled = true;
  };
  const release = () => {
    ctl.enabled = false;
    if (ctl.release) {
      ctl.release();
      ctl.release = null;
    }
  };
  return { ctl, awaitBarrier, arm, release };
}

describe('Reference Image Viewer stabilization (7C-2A-3S)', () => {
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
      path.join(os.tmpdir(), 'jskim-ref-stab-')
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
      `spec/sample/src/snapshots/${SCREEN_LINKED}`
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

    const dataDir = path.join(workspaceRoot, 'spec/sample/src/data');
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.writeFile(
      path.join(dataDir, `${SCREEN_LINKED}.json`),
      `${JSON.stringify(
        {
          schemaVersion: '1.2',
          screen: {
            id: SCREEN_LINKED,
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
    await fsp.writeFile(
      path.join(dataDir, `${SCREEN_DESIGN}.json`),
      `${JSON.stringify(
        {
          schemaVersion: '1.2',
          screen: {
            id: SCREEN_DESIGN,
            name: '設計画面',
            description: 'DESIGN_ONLY fixture',
          },
          itemOrder: [],
          excludedItems: {},
          items: {},
        },
        null,
        2
      )}\n`
    );
    await fsp.mkdir(path.join(workspaceRoot, 'spec/sample/src/references'), {
      recursive: true,
    });
    return workspaceRoot;
  }

  /**
   * @param {string} workspaceRoot
   * @param {{
   *   getReferenceImagePutHooks?: Function,
   *   getReferenceImageDeleteHooks?: Function,
   * }} [extra]
   */
  async function startRuntime(workspaceRoot, extra = {}) {
    const port = await getFreePort();
    const counters = {
      collect: 0,
      build: 0,
      buildsInFlight: 0,
      putCalls: 0,
      deleteCalls: 0,
    };
    const basePut = companion.putReferenceImage;
    const baseDelete = companion.deleteReferenceImage;
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
      getReferenceImagePutHooks: extra.getReferenceImagePutHooks,
      getReferenceImageDeleteHooks: extra.getReferenceImageDeleteHooks,
      collectFn: async () => {
        counters.collect += 1;
        return { screens: 0, states: 0 };
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
      withDescriptionScreenLock: companion.withDescriptionScreenLock,
      putReferenceImage: async (opts) => {
        counters.putCalls += 1;
        return basePut(opts);
      },
      deleteReferenceImage: async (opts) => {
        counters.deleteCalls += 1;
        return baseDelete(opts);
      },
      getReferenceImagePublicInfo: companion.getReferenceImagePublicInfo,
      collectDeviceCapture: companion.collectDeviceCapture,
      getDeviceCapturePublicInfo: companion.getDeviceCapturePublicInfo,
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
          new Promise((resolve) => setTimeout(resolve, 8000)),
        ]),
      cleanup: () => fsp.rm(workspaceRoot, { recursive: true, force: true }),
    };
    sessions.push(entry);
    return entry;
  }

  /** debounce でまとまる場合があるため build>=1 + manifest で待つ */
  async function waitPcSpCurrent(port, counters, screenId) {
    await waitFor(
      () => counters.build >= 1 && counters.buildsInFlight === 0,
      { timeoutMs: 45000, label: `${screenId} reference build` }
    );
    await waitFor(
      async () => {
        const screen = await fetchScreenJson(port, screenId);
        return (
          screen?.referenceImages?.pc?.status === 'current' &&
          screen?.referenceImages?.sp?.status === 'current'
        );
      },
      { timeoutMs: 20000, label: `${screenId} pc/sp current` }
    );
  }

  /**
   * Dialog を開いたまま外部更新するため、SSE の full page reload を握りつぶす。
   * soft reloadScreen / status polling は通す。
   */
  async function installReloadSuppressor(page) {
    await page.addInitScript(() => {
      window.__jskimReloadSuppressed = 0;
      const NativeES = window.EventSource;
      function WrappedEventSource(url, config) {
        const es = new NativeES(url, config);
        const add = es.addEventListener.bind(es);
        es.addEventListener = (type, listener, opts) => {
          if (type === 'reload') {
            return add(
              type,
              () => {
                window.__jskimReloadSuppressed =
                  (window.__jskimReloadSuppressed || 0) + 1;
              },
              opts
            );
          }
          return add(type, listener, opts);
        };
        return es;
      }
      WrappedEventSource.prototype = NativeES.prototype;
      WrappedEventSource.CONNECTING = NativeES.CONNECTING;
      WrappedEventSource.OPEN = NativeES.OPEN;
      WrappedEventSource.CLOSED = NativeES.CLOSED;
      window.EventSource = WrappedEventSource;
      Location.prototype.reload = function reload() {
        window.__jskimReloadSuppressed =
          (window.__jskimReloadSuppressed || 0) + 1;
      };
    });
  }

  async function openScreen(page, port, screenId, provider, options = {}) {
    if (options.suppressReload) {
      await installReloadSuppressor(page);
    }
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await page.goto(`http://127.0.0.1:${port}/spec/screens/${screenId}`, {
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
    await page.waitForSelector('[data-testid="reference-image-panel"]', {
      timeout: 20000,
    });
  }

  async function selectReferenceViewport(page, viewport) {
    await page.click(
      `[data-testid="reference-viewport-tabs"] [data-viewport="${viewport}"]`,
      { force: true }
    );
    await waitFor(
      async () =>
        (await page
          .locator(
            `[data-testid="reference-image-panel"][data-viewport="${viewport}"]`
          )
          .count()) > 0,
      { timeoutMs: 5000, label: `viewport panel ${viewport}` }
    );
  }

  async function openUploadDialog(page, mode) {
    const selector =
      mode === 'replace'
        ? '[data-testid="reference-image-replace"]'
        : '[data-testid="reference-image-add"]';
    await page.click(selector);
    await page.waitForSelector('[data-testid="reference-image-upload-dialog"]', {
      timeout: 5000,
    });
  }

  async function submitUploadDialog(page, pngBuffer, filename = 'ref.png') {
    await page.setInputFiles('[data-testid="reference-image-file-input"]', {
      name: filename,
      mimeType: 'image/png',
      buffer: pngBuffer,
    });
    await page.click('[data-testid="reference-image-upload-submit"]');
  }

  async function waitUploadDialogClosed(page, timeoutMs = 60000) {
    await waitFor(
      async () =>
        (await page
          .locator('[data-testid="reference-image-upload-dialog"]')
          .count()) === 0,
      { timeoutMs, label: 'upload dialog closed' }
    );
  }

  async function putImage(port, screenId, viewport, png, expected) {
    const boundary = '----refstab';
    const parts = [
      {
        name: 'image',
        filename: 'ref.png',
        contentType: 'image/png',
        data: png,
      },
    ];
    if (expected != null) {
      parts.push({ name: 'expectedImageRevision', data: expected });
    }
    const body = buildMultipartBody(boundary, parts);
    return httpRequest({
      port,
      method: 'PUT',
      path: `/_jskim/spec/reference-images/${screenId}/${viewport}`,
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      timeoutMs: 30000,
    });
  }

  async function deleteImage(port, screenId, viewport, expectedImageRevision) {
    return httpRequest({
      port,
      method: 'DELETE',
      path: `/_jskim/spec/reference-images/${screenId}/${viewport}`,
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expectedImageRevision }),
      timeoutMs: 15000,
    });
  }

  async function apiStatus(port, screenId, viewport) {
    return httpRequest({
      port,
      path: `${REFERENCE_IMAGE_STATUS_PATH}?screenId=${screenId}&viewport=${viewport}`,
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
      },
    });
  }

  async function fetchScreenJson(port, screenId) {
    const res = await httpRequest({
      port,
      path: `/spec/data/screens/${screenId}.json`,
      headers: { Host: `127.0.0.1:${port}` },
    });
    if (res.status !== 200) {
      return null;
    }
    return JSON.parse(res.body.toString('utf8'));
  }

  function trackReferencePuts(page) {
    const puts = [];
    page.on('request', (req) => {
      if (
        req.method() === 'PUT' &&
        req.url().includes('/_jskim/spec/reference-images/')
      ) {
        puts.push(req.url());
      }
    });
    return puts;
  }

  function trackStatusPolls(page) {
    /** @type {string[]} */
    const polls = [];
    page.on('request', (req) => {
      if (
        req.method() === 'GET' &&
        req.url().includes(REFERENCE_IMAGE_STATUS_PATH)
      ) {
        polls.push(req.url());
      }
    });
    return polls;
  }

  function trackDescriptionMutations(page) {
    /** @type {string[]} */
    const mutations = [];
    page.on('request', (req) => {
      const method = req.method();
      if (
        (method === 'PUT' || method === 'POST' || method === 'DELETE') &&
        req.url().includes('/_jskim/spec/descriptions')
      ) {
        mutations.push(`${method} ${req.url()}`);
      }
    });
    return mutations;
  }

  async function waitRuntime(port, screenId, viewport, status, timeoutMs = 10000) {
    await waitFor(
      async () => {
        const st = parseJson(await apiStatus(port, screenId, viewport));
        return st.runtime.status === status;
      },
      { timeoutMs, label: `runtime ${status}` }
    );
  }

  it('1. Viewer upload in-progress: UI / 409 PUT·DELETE / core 0 → barrier 解除で完了', async () => {
    const workspaceRoot = await prepareWorkspace();
    const barrier = createBarrier();
    const session = await startRuntime(workspaceRoot, {
      getReferenceImagePutHooks: () =>
        barrier.ctl.enabled ? { awaitBarrier: barrier.awaitBarrier } : {},
    });
    const { port, counters } = session;
    const sse = await openSse({ port, timeoutMs: 10000 });

    const pngR1 = buildValidPng(40, 30, [220, 20, 20]);
    const created = parseJson(await putImage(port, SCREEN_DESIGN, 'pc', pngR1));
    assert.equal(created.result, 'created');
    await waitFor(
      () => counters.build >= 1 && counters.buildsInFlight === 0,
      { timeoutMs: 30000, label: 'baseline build' }
    );
    await waitFor(() => countReloadTarget(sse, 'spec') >= 1, {
      timeoutMs: 20000,
      label: 'baseline reload(spec)',
    });
    const baselinePuts = counters.putCalls;
    const baselineBuild = counters.build;
    const baselineReload = countReloadTarget(sse, 'spec');

    const page = await browser.newPage();
    const viewerPuts = trackReferencePuts(page);
    await openScreen(page, port, SCREEN_DESIGN, 'reference');
    assert.equal(
      await page.locator('[data-testid="reference-image"] img').count(),
      1
    );

    barrier.arm();
    const pngR2 = buildValidPng(44, 32, [20, 220, 20]);
    await openUploadDialog(page, 'replace');
    await submitUploadDialog(page, pngR2, 'pc-r2.png');
    await barrier.ctl.entered;

    await waitRuntime(port, SCREEN_DESIGN, 'pc', 'uploading');
    await waitFor(
      async () => {
        const progress = page.locator('[data-testid="reference-image-progress"]');
        return (
          (await progress.count()) > 0 &&
          (await progress.innerText()).includes('アップロード中')
        );
      },
      { timeoutMs: 10000, label: 'Viewer uploading UI' }
    );
    assert.equal(
      await page.locator('[data-testid="reference-image-replace"]').isDisabled(),
      true
    );
    assert.equal(
      await page.locator('[data-testid="reference-image-delete"]').isDisabled(),
      true
    );
    // 既存 current 画像は維持
    assert.equal(
      await page.locator('[data-testid="reference-image"] img').count(),
      1
    );
    assert.equal(counters.putCalls, baselinePuts);

    const dupPut = parseJson(
      await putImage(port, SCREEN_DESIGN, 'pc', buildValidPng(10, 10, [1, 2, 3]))
    );
    assert.equal(dupPut.code, 'SPEC_REFERENCE_IMAGE_IN_PROGRESS');
    const dupDel = parseJson(
      await deleteImage(port, SCREEN_DESIGN, 'pc', contentRevision(pngR1))
    );
    assert.equal(dupDel.code, 'SPEC_REFERENCE_IMAGE_IN_PROGRESS');
    assert.equal(counters.putCalls, baselinePuts);
    assert.equal(counters.deleteCalls, 0);

    // Viewer は自動で重複 PUT を送らない（submit の 1 本のみ）
    assert.equal(viewerPuts.length, 1);

    // 別タブで mount すると runtime uploading を見て status polling が走る
    // （自 PUT 待機中の page を reload すると fetch abort になるため分離する）
    const page2 = await browser.newPage();
    const polls = trackStatusPolls(page2);
    await openScreen(page2, port, SCREEN_DESIGN, 'reference');
    await waitFor(
      async () => {
        const progress = page2.locator(
          '[data-testid="reference-image-progress"]'
        );
        return (
          (await progress.count()) > 0 &&
          (await progress.innerText()).includes('アップロード中')
        );
      },
      { timeoutMs: 10000, label: 'page2 uploading UI via status' }
    );
    await waitFor(() => polls.some((u) => u.includes('viewport=pc')), {
      timeoutMs: 10000,
      label: 'status polling on page2 while uploading',
    });

    barrier.release();
    await waitUploadDialogClosed(page);
    await waitFor(
      () =>
        counters.putCalls >= baselinePuts + 1 &&
        counters.build >= baselineBuild + 1 &&
        counters.buildsInFlight === 0,
      { timeoutMs: 60000, label: 'upload complete build' }
    );
    await waitFor(
      () => countReloadTarget(sse, 'spec') >= baselineReload + 1,
      { timeoutMs: 30000, label: 'upload reload(spec)' }
    );
    await waitRuntime(port, SCREEN_DESIGN, 'pc', 'idle');

    assert.match(
      await page.locator('[data-testid="reference-image-status-label"]').innerText(),
      /登録済み/
    );
    const img = page.locator('[data-testid="reference-image"] img');
    await img.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await img.evaluate((el) => el.naturalWidth), 44);

    const screen = await fetchScreenJson(port, SCREEN_DESIGN);
    assert.equal(screen.referenceImages.pc.status, 'current');
    assert.equal(
      screen.referenceImages.pc.imageRevision,
      contentRevision(pngR2)
    );
    assert.equal(
      await page.evaluate((k) => sessionStorage.getItem(k), PENDING_REF_KEY),
      null
    );
    // 自動再試行なし
    assert.equal(viewerPuts.length, 1);
    assert.equal(counters.putCalls, baselinePuts + 1);
    await waitFor(
      async () =>
        (await page2.evaluate((k) => sessionStorage.getItem(k), PENDING_REF_KEY)) ===
          null &&
        /登録済み/.test(
          await page2
            .locator('[data-testid="reference-image-status-label"]')
            .innerText()
        ),
      { timeoutMs: 30000, label: 'page2 settled after upload' }
    );

    await page.close();
    await page2.close();
    sse.close();
  });

  it('2. Viewer delete in-progress: UI / 重複 409 / barrier 解除で missing', async () => {
    const workspaceRoot = await prepareWorkspace();
    const barrier = createBarrier();
    const session = await startRuntime(workspaceRoot, {
      getReferenceImageDeleteHooks: () =>
        barrier.ctl.enabled ? { awaitBarrier: barrier.awaitBarrier } : {},
    });
    const { port, counters } = session;
    const sse = await openSse({ port, timeoutMs: 10000 });

    const pngPc = buildValidPng(36, 28, [200, 10, 10]);
    const pngSp = buildValidPng(18, 30, [10, 10, 200]);
    assert.equal(
      parseJson(await putImage(port, SCREEN_DESIGN, 'pc', pngPc)).result,
      'created'
    );
    assert.equal(
      parseJson(await putImage(port, SCREEN_DESIGN, 'sp', pngSp)).result,
      'created'
    );
    await waitPcSpCurrent(port, counters, SCREEN_DESIGN);
    const baselineDeletes = counters.deleteCalls;
    const baselinePuts = counters.putCalls;
    const baselineBuild = counters.build;
    const baselineReload = countReloadTarget(sse, 'spec');

    const page = await browser.newPage();
    await openScreen(page, port, SCREEN_DESIGN, 'reference');

    barrier.arm();
    await page.click('[data-testid="reference-image-delete"]');
    await page.waitForSelector('[data-testid="reference-image-delete-dialog"]', {
      timeout: 5000,
    });
    await page.click('[data-testid="reference-image-delete-confirm"]');
    await barrier.ctl.entered;

    await waitRuntime(port, SCREEN_DESIGN, 'pc', 'deleting');
    await waitFor(
      async () => {
        const progress = page.locator('[data-testid="reference-image-progress"]');
        return (
          (await progress.count()) > 0 &&
          (await progress.innerText()).includes('削除中')
        );
      },
      { timeoutMs: 10000, label: 'Viewer deleting UI' }
    );
    assert.equal(
      await page.locator('[data-testid="reference-image"] img').count(),
      1
    );
    assert.equal(
      await page.locator('[data-testid="reference-image-replace"]').isDisabled(),
      true
    );
    assert.equal(counters.deleteCalls, baselineDeletes);

    const dupPut = parseJson(
      await putImage(port, SCREEN_DESIGN, 'pc', buildValidPng(8, 8, [9, 9, 9]))
    );
    assert.equal(dupPut.code, 'SPEC_REFERENCE_IMAGE_IN_PROGRESS');
    const dupDel = parseJson(
      await deleteImage(port, SCREEN_DESIGN, 'pc', contentRevision(pngPc))
    );
    assert.equal(dupDel.code, 'SPEC_REFERENCE_IMAGE_IN_PROGRESS');
    assert.equal(counters.deleteCalls, baselineDeletes);
    assert.equal(counters.putCalls, baselinePuts);

    barrier.release();
    await waitFor(
      async () =>
        (await page
          .locator('[data-testid="reference-image-delete-dialog"]')
          .count()) === 0,
      { timeoutMs: 60000, label: 'delete dialog closed' }
    );
    await waitFor(
      () =>
        counters.deleteCalls >= baselineDeletes + 1 &&
        counters.build >= baselineBuild + 1 &&
        counters.buildsInFlight === 0,
      { timeoutMs: 60000, label: 'delete complete build' }
    );
    await waitFor(
      () => countReloadTarget(sse, 'spec') >= baselineReload + 1,
      { timeoutMs: 30000, label: 'delete reload(spec)' }
    );
    await waitRuntime(port, SCREEN_DESIGN, 'pc', 'idle');

    assert.match(
      await page.locator('[data-testid="reference-image-status-label"]').innerText(),
      /未登録/
    );
    const screen = await fetchScreenJson(port, SCREEN_DESIGN);
    assert.equal(screen.referenceImages.pc.status, 'missing');
    assert.equal(screen.referenceImages.sp.status, 'current');
    assert.equal(
      screen.referenceImages.sp.imageRevision,
      contentRevision(pngSp)
    );
    assert.equal(
      await page.evaluate((k) => sessionStorage.getItem(k), PENDING_REF_KEY),
      null
    );

    await page.close();
    sse.close();
  });

  it('3. Replace Dialog stale revision conflict（R1 Dialog → 外部 R2 → 古い Replace 409）', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startRuntime(workspaceRoot);
    const { port, counters } = session;
    const sse = await openSse({ port, timeoutMs: 10000 });

    const pngR1 = buildValidPng(40, 30, [210, 30, 30]);
    const r1 = parseJson(await putImage(port, SCREEN_DESIGN, 'pc', pngR1));
    assert.equal(r1.result, 'created');
    const revR1 = r1.referenceImage.imageRevision;
    await waitFor(
      () => counters.build >= 1 && counters.buildsInFlight === 0,
      { timeoutMs: 30000, label: 'R1 build' }
    );
    await waitFor(() => countReloadTarget(sse, 'spec') >= 1, {
      timeoutMs: 20000,
      label: 'R1 reload',
    });

    const page = await browser.newPage();
    const viewerPuts = trackReferencePuts(page);
    await openScreen(page, port, SCREEN_DESIGN, 'reference', {
      suppressReload: true,
    });
    await openUploadDialog(page, 'replace');

    // Dialog（expected=R1）を保ったまま外部 R2 へ。full reload は抑止。
    const pngR2 = buildValidPng(50, 40, [30, 210, 30]);
    const r2 = parseJson(
      await putImage(port, SCREEN_DESIGN, 'pc', pngR2, revR1)
    );
    assert.equal(r2.result, 'updated');
    const revR2 = r2.referenceImage.imageRevision;
    await waitFor(
      () => counters.buildsInFlight === 0 && counters.build >= 2,
      { timeoutMs: 45000, label: 'R2 build while dialog open' }
    );
    await waitFor(
      async () => {
        const screen = await fetchScreenJson(port, SCREEN_DESIGN);
        return screen?.referenceImages?.pc?.imageRevision === revR2;
      },
      { timeoutMs: 20000, label: 'manifest output R2' }
    );
    assert.equal(
      await page.locator('[data-testid="reference-image-upload-dialog"]').count(),
      1
    );

    const putsBeforeSubmit = counters.putCalls;
    const buildBeforeSubmit = counters.build;
    const reloadEventsBefore = countReloadTarget(sse, 'spec');
    /** @type {number[]} */
    const putStatuses = [];
    page.on('response', (res) => {
      if (
        res.request().method() === 'PUT' &&
        res.url().includes('/_jskim/spec/reference-images/')
      ) {
        putStatuses.push(res.status());
      }
    });
    const pngStale = buildValidPng(12, 12, [1, 1, 1]);
    await submitUploadDialog(page, pngStale, 'stale.png');
    await waitFor(() => putStatuses.length >= 1, {
      timeoutMs: 15000,
      label: 'stale Replace PUT response',
    });
    assert.equal(putStatuses[0], 409, `stale Replace status=${putStatuses[0]}`);

    await waitFor(
      async () =>
        (await page.locator('[data-testid="reference-image-error"]').count()) >
          0 &&
        (await page.locator('[data-testid="reference-image-error"]').innerText())
          .includes('別の操作で更新'),
      { timeoutMs: 20000, label: 'Replace conflict message' }
    );
    await waitUploadDialogClosed(page);

    assert.equal(counters.putCalls, putsBeforeSubmit + 1);
    // conflict では追加の meta write / watcher build なし
    assert.equal(counters.build, buildBeforeSubmit);
    assert.equal(viewerPuts.length, 1);
    assert.equal(
      await page.evaluate((k) => sessionStorage.getItem(k), PENDING_REF_KEY),
      null
    );

    await waitFor(
      async () => {
        const img = page.locator('[data-testid="reference-image"] img');
        return (
          (await img.count()) > 0 &&
          (await img.evaluate((el) => el.naturalWidth)) === 50
        );
      },
      { timeoutMs: 20000, label: 'R2 image preserved after conflict' }
    );
    const screen = await fetchScreenJson(port, SCREEN_DESIGN);
    assert.equal(screen.referenceImages.pc.imageRevision, revR2);
    // SSE reload event は R2 build 分まで。conflict 後の追加 build 起因 reload なし
    assert.ok(countReloadTarget(sse, 'spec') >= reloadEventsBefore);

    // 新しい Replace Dialog は R2 を expected に使う
    await openUploadDialog(page, 'replace');
    const pngR3 = buildValidPng(52, 42, [40, 40, 210]);
    await submitUploadDialog(page, pngR3, 'r3.png');
    await waitUploadDialogClosed(page);
    await waitFor(
      async () => {
        const s = await fetchScreenJson(port, SCREEN_DESIGN);
        return s?.referenceImages?.pc?.imageRevision === contentRevision(pngR3);
      },
      { timeoutMs: 60000, label: 'Replace with R2 expected succeeds' }
    );
    assert.equal(viewerPuts.length, 2);

    await page.close();
    sse.close();
  });

  it('4. Delete Dialog stale revision conflict（R1 Dialog → 外部 R2 → 古い Delete 409）', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startRuntime(workspaceRoot);
    const { port, counters } = session;
    const sse = await openSse({ port, timeoutMs: 10000 });

    const pngR1 = buildValidPng(38, 28, [180, 20, 20]);
    const r1 = parseJson(await putImage(port, SCREEN_DESIGN, 'pc', pngR1));
    assert.equal(r1.result, 'created');
    const revR1 = r1.referenceImage.imageRevision;
    await waitFor(
      () => counters.build >= 1 && counters.buildsInFlight === 0,
      { timeoutMs: 30000, label: 'R1 build' }
    );

    const page = await browser.newPage();
    await openScreen(page, port, SCREEN_DESIGN, 'reference', {
      suppressReload: true,
    });

    await page.click('[data-testid="reference-image-delete"]');
    await page.waitForSelector('[data-testid="reference-image-delete-dialog"]', {
      timeout: 5000,
    });

    const pngR2 = buildValidPng(48, 36, [20, 180, 20]);
    const r2 = parseJson(
      await putImage(port, SCREEN_DESIGN, 'pc', pngR2, revR1)
    );
    assert.equal(r2.result, 'updated');
    const revR2 = r2.referenceImage.imageRevision;
    await waitFor(
      () => counters.buildsInFlight === 0 && counters.build >= 2,
      { timeoutMs: 45000, label: 'R2 build while delete dialog open' }
    );
    await waitFor(
      async () => {
        const screen = await fetchScreenJson(port, SCREEN_DESIGN);
        return screen?.referenceImages?.pc?.imageRevision === revR2;
      },
      { timeoutMs: 20000, label: 'manifest R2 before stale delete' }
    );
    assert.equal(
      await page.locator('[data-testid="reference-image-delete-dialog"]').count(),
      1
    );

    const deleteBefore = counters.deleteCalls;
    const buildBefore = counters.build;
    /** @type {number[]} */
    const deleteStatuses = [];
    page.on('response', (res) => {
      if (
        res.request().method() === 'DELETE' &&
        res.url().includes('/_jskim/spec/reference-images/')
      ) {
        deleteStatuses.push(res.status());
      }
    });
    await page.click('[data-testid="reference-image-delete-confirm"]');
    await waitFor(() => deleteStatuses.length >= 1, {
      timeoutMs: 15000,
      label: 'stale Delete response',
    });
    assert.equal(
      deleteStatuses[0],
      409,
      `stale Delete status=${deleteStatuses[0]}`
    );

    await waitFor(
      async () =>
        (await page.locator('[data-testid="reference-image-error"]').count()) >
          0 &&
        (await page.locator('[data-testid="reference-image-error"]').innerText())
          .includes('別の操作で更新'),
      { timeoutMs: 20000, label: 'Delete conflict message' }
    );
    await waitFor(
      async () =>
        (await page
          .locator('[data-testid="reference-image-delete-dialog"]')
          .count()) === 0,
      { timeoutMs: 10000, label: 'delete dialog closed after conflict' }
    );

    assert.equal(counters.deleteCalls, deleteBefore + 1);
    assert.equal(counters.build, buildBefore);
    assert.equal(
      await page.evaluate((k) => sessionStorage.getItem(k), PENDING_REF_KEY),
      null
    );
    const infoCount = await page
      .locator('[data-testid="reference-image-info"]')
      .count();
    if (infoCount > 0) {
      assert.doesNotMatch(
        await page.locator('[data-testid="reference-image-info"]').innerText(),
        /削除しました/
      );
    }

    await waitFor(
      async () => {
        const img = page.locator('[data-testid="reference-image"] img');
        return (
          (await img.count()) > 0 &&
          (await img.evaluate((el) => el.naturalWidth)) === 48
        );
      },
      { timeoutMs: 20000, label: 'R2 image preserved' }
    );
    const screen = await fetchScreenJson(port, SCREEN_DESIGN);
    assert.equal(screen.referenceImages.pc.status, 'current');
    assert.equal(screen.referenceImages.pc.imageRevision, revR2);

    // 新しい Delete Dialog は R2 で成功する
    await page.click('[data-testid="reference-image-delete"]');
    await page.waitForSelector('[data-testid="reference-image-delete-dialog"]');
    await page.click('[data-testid="reference-image-delete-confirm"]');
    await waitFor(
      async () => {
        const s = await fetchScreenJson(port, SCREEN_DESIGN);
        return s?.referenceImages?.pc?.status === 'missing';
      },
      { timeoutMs: 60000, label: 'delete with R2 expected succeeds' }
    );

    await page.close();
    sse.close();
  });

  it('5. 新規 DESIGN_ONLY 作成 → Reference missing → Viewer upload（Description 不変）', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startRuntime(workspaceRoot);
    const { port, counters } = session;

    const page = await browser.newPage();
    const descMutations = trackDescriptionMutations(page);
    await openScreen(page, port, SCREEN_DESIGN, 'reference');

    await page.click('.spec-sidebar__create-btn');
    await page.waitForSelector('#create-screen-dialog-title', { timeout: 5000 });
    const newId = 'new-design-only';
    await page.fill('[data-field="screen-id"]', newId);
    await page.fill('[data-field="name"]', '新規設計画面');
    await page.fill('[data-field="description"]', 'create then reference');
    await page.click('.create-screen-dialog__actions button[type="submit"]');

    await page.waitForURL(`**/screens/${newId}`, { timeout: 60000 });
    await page.waitForSelector('[data-testid="reference-image-panel"]', {
      timeout: 20000,
    });

    // DESIGN_ONLY: 参照のみ（Live/PC/SP Device provider なし）
    const providers = await page
      .locator('.preview-provider-tabs__tab')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-provider')));
    assert.deepEqual(providers, ['reference']);
    assert.equal(await page.locator('.state-selector').count(), 0);
    assert.match(
      await page.locator('[data-testid="reference-image-status-label"]').innerText(),
      /未登録/
    );
    assert.equal(
      await page.locator('[data-testid="reference-image-add"]').count(),
      1
    );

    const descriptionPath = path.join(
      workspaceRoot,
      `spec/sample/src/data/${newId}.json`
    );
    const descriptionBefore = await fsp.readFile(descriptionPath, 'utf8');
    const descMutationsBeforeUpload = descMutations.length;
    const buildBefore = counters.build;

    const png = buildValidPng(30, 24, [100, 50, 200]);
    await openUploadDialog(page, 'add');
    await submitUploadDialog(page, png, 'new.png');
    await waitUploadDialogClosed(page);
    await waitFor(
      () => counters.build >= buildBefore + 1 && counters.buildsInFlight === 0,
      { timeoutMs: 60000, label: 'new screen reference upload build' }
    );
    await waitFor(
      async () => {
        const s = await fetchScreenJson(port, newId);
        return s?.referenceImages?.pc?.status === 'current';
      },
      { timeoutMs: 30000, label: 'new screen pc reference current' }
    );

    assert.equal(descMutations.length, descMutationsBeforeUpload);
    const descriptionAfter = await fsp.readFile(descriptionPath, 'utf8');
    assert.equal(descriptionAfter, descriptionBefore);

    const screen = await fetchScreenJson(port, newId);
    assert.equal(screen.referenceImages.pc.status, 'current');
    const imagePath = screen.referenceImages.pc.imagePath;
    assert.ok(imagePath, 'imagePath がある');
    const imgRes = await httpRequest({
      port,
      path: imagePath.startsWith('/')
        ? imagePath
        : `/spec/data/${imagePath.replace(/^data\//, '')}`,
      headers: { Host: `127.0.0.1:${port}` },
    });
    assert.equal(imgRes.status, 200);

    await waitFor(
      async () =>
        (await page.evaluate((k) => sessionStorage.getItem(k), PENDING_REF_KEY)) ===
        null,
      { timeoutMs: 30000, label: 'reference pending cleared' }
    );
    assert.equal(
      await page.evaluate((k) => sessionStorage.getItem(k), PENDING_SCREEN_KEY),
      null
    );

    await page.close();
  });

  it('6. Reference あり画面の複製 → 複製先 missing・元維持・binary 非複製', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startRuntime(workspaceRoot);
    const { port, counters } = session;

    const pngPc = buildValidPng(42, 30, [220, 80, 80]);
    const pngSp = buildValidPng(20, 32, [80, 80, 220]);
    assert.equal(
      parseJson(await putImage(port, SCREEN_DESIGN, 'pc', pngPc)).result,
      'created'
    );
    assert.equal(
      parseJson(await putImage(port, SCREEN_DESIGN, 'sp', pngSp)).result,
      'created'
    );
    await waitPcSpCurrent(port, counters, SCREEN_DESIGN);

    const srcRefsBefore = path.join(
      workspaceRoot,
      `spec/sample/src/references/${SCREEN_DESIGN}`
    );
    const srcListingBefore = await fsp.readdir(srcRefsBefore, {
      recursive: true,
    });
    assert.ok(srcListingBefore.length > 0);

    const page = await browser.newPage();
    await openScreen(page, port, SCREEN_DESIGN, 'reference');

    await page.click('[data-action="duplicate-screen"]');
    await page.waitForSelector('#duplicate-screen-dialog-title', {
      timeout: 5000,
    });
    const copyId = 'design-screen-copy';
    await page.fill('[data-field="screen-id"]', copyId);
    await page.fill('[data-field="screen-name"]', '設計画面（複製）');
    await page.click('[data-action="confirm-duplicate-screen"]');

    await page.waitForURL(`**/screens/${copyId}`, { timeout: 60000 });
    await page.waitForSelector('[data-testid="reference-image-panel"]', {
      timeout: 20000,
    });

    assert.match(
      await page.locator('[data-testid="reference-image-status-label"]').innerText(),
      /未登録/
    );
    assert.equal(
      await page.locator('[data-testid="reference-image-add"]').count(),
      1
    );

    const copyScreen = await fetchScreenJson(port, copyId);
    assert.equal(copyScreen.referenceImages.pc.status, 'missing');
    assert.equal(copyScreen.referenceImages.sp.status, 'missing');

    const srcScreen = await fetchScreenJson(port, SCREEN_DESIGN);
    assert.equal(srcScreen.referenceImages.pc.status, 'current');
    assert.equal(
      srcScreen.referenceImages.pc.imageRevision,
      contentRevision(pngPc)
    );
    assert.equal(srcScreen.referenceImages.sp.status, 'current');

    const copySrcDir = path.join(
      workspaceRoot,
      `spec/sample/src/references/${copyId}`
    );
    assert.equal(fs.existsSync(copySrcDir), false);
    const copyOutDir = path.join(
      workspaceRoot,
      `spec/sample/dist/data/reference-images/${copyId}`
    );
    if (fs.existsSync(copyOutDir)) {
      const listing = await fsp.readdir(copyOutDir, { recursive: true });
      assert.equal(listing.length, 0);
    }

    const srcListingAfter = await fsp.readdir(srcRefsBefore, {
      recursive: true,
    });
    assert.deepEqual(srcListingAfter.sort(), srcListingBefore.sort());

    await page.close();
  });

  it('7. provider / viewport / screen 移動で polling cleanup・stale 遮断', async () => {
    const workspaceRoot = await prepareWorkspace();
    const barrier = createBarrier();
    const session = await startRuntime(workspaceRoot, {
      getReferenceImagePutHooks: ({ viewport }) =>
        barrier.ctl.enabled && viewport === 'pc'
          ? { awaitBarrier: barrier.awaitBarrier }
          : {},
    });
    const { port, counters } = session;

    const png = buildValidPng(24, 20, [90, 90, 90]);
    assert.equal(
      parseJson(await putImage(port, SCREEN_DESIGN, 'pc', png)).result,
      'created'
    );
    await waitFor(
      () => counters.build >= 1 && counters.buildsInFlight === 0,
      { timeoutMs: 30000, label: 'poll cleanup baseline' }
    );

    const page = await browser.newPage();
    const polls = trackStatusPolls(page);
    // upload 完了後の SSE reload と後続 goto が競合しないよう抑止する
    await openScreen(page, port, SCREEN_DESIGN, 'reference', {
      suppressReload: true,
    });

    const pngInFlight = buildValidPng(26, 22, [100, 100, 100]);
    barrier.arm();
    await openUploadDialog(page, 'replace');
    await submitUploadDialog(page, pngInFlight, 'poll.png');
    await barrier.ctl.entered;
    await waitRuntime(port, SCREEN_DESIGN, 'pc', 'uploading');
    await waitFor(() => polls.some((u) => u.includes('viewport=pc')), {
      timeoutMs: 10000,
      label: 'pc status poll started',
    });

    const countDesignPcPolls = () =>
      polls.filter(
        (u) => u.includes(SCREEN_DESIGN) && u.includes('viewport=pc')
      ).length;
    const pcPollsAtSwitch = countDesignPcPolls();

    // Reference PC → SP: Dialog overlay 中でも viewport 切替で前 key polling 終了
    await page.evaluate(() => {
      const btn = document.querySelector(
        '[data-testid="reference-viewport-tabs"] [data-viewport="sp"]'
      );
      if (!btn) {
        throw new Error('SP viewport tab not found');
      }
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await waitFor(
      async () =>
        (await page
          .locator('[data-testid="reference-image-panel"][data-viewport="sp"]')
          .count()) > 0,
      { timeoutMs: 5000, label: 'switched to SP panel' }
    );
    // 観測窓: PC poll が増えないことを連続確認（固定 sleep 単独判定ではない）
    let stablePcPollChecks = 0;
    await waitFor(
      () => {
        if (countDesignPcPolls() !== pcPollsAtSwitch) {
          stablePcPollChecks = 0;
          return false;
        }
        stablePcPollChecks += 1;
        return stablePcPollChecks >= 3;
      },
      { timeoutMs: 8000, label: 'PC poll stopped after SP switch', intervalMs: 400 }
    );

    // in-flight PUT を abort しないよう、画面移動前に barrier 解除して完了させる
    barrier.release();
    await waitRuntime(port, SCREEN_DESIGN, 'pc', 'idle', 60000);
    await waitFor(
      () => counters.buildsInFlight === 0,
      { timeoutMs: 30000, label: 'upload settled before navigation' }
    );
    await waitFor(
      async () => {
        const design = await fetchScreenJson(port, SCREEN_DESIGN);
        return (
          design?.referenceImages?.pc?.imageRevision ===
          contentRevision(pngInFlight)
        );
      },
      { timeoutMs: 30000, label: 'design-screen PC updated after release' }
    );

    // soft reload で SP panel の stale を捨ててから別 screen へ
    await page.evaluate(() => {
      sessionStorage.setItem('jskim-spec-preview-provider:sample', 'reference');
    });
    await page.goto(`http://127.0.0.1:${port}/spec/screens/${SCREEN_LINKED}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForSelector('[data-testid="reference-image-panel"]', {
      timeout: 20000,
    });
    const designPcBeforeNav = countDesignPcPolls();

    await page.click('.preview-provider-tabs__tab[data-provider="live"]');
    await waitFor(
      async () =>
        (await page.locator('[data-testid="reference-image-panel"]').count()) ===
        0,
      { timeoutMs: 10000, label: 'left reference provider' }
    );
    let stableAfterLive = 0;
    await waitFor(
      () => {
        if (countDesignPcPolls() !== designPcBeforeNav) {
          stableAfterLive = 0;
          return false;
        }
        stableAfterLive += 1;
        return stableAfterLive >= 3;
      },
      {
        timeoutMs: 8000,
        label: 'old design-screen PC poll stopped on Live',
        intervalMs: 400,
      }
    );

    assert.equal(
      await page.evaluate(
        () =>
          sessionStorage.getItem('jskim-spec-preview-provider:sample') === 'live'
      ),
      true
    );
    assert.equal(
      await page
        .locator('.preview-provider-tabs__tab[data-provider="live"].is-active')
        .count(),
      1
    );

    // 離れた panel は Live のまま（stale で Reference に戻らない）
    assert.equal(
      await page.locator('[data-testid="reference-image-panel"]').count(),
      0
    );
    const design = await fetchScreenJson(port, SCREEN_DESIGN);
    assert.equal(design.referenceImages.pc.status, 'current');
    assert.equal(
      design.referenceImages.pc.imageRevision,
      contentRevision(pngInFlight)
    );

    await page.close();
  });
});
