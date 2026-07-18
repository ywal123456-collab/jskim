'use strict';

/**
 * Phase 7C-2A-3: same-port Viewer Reference Image flows（Playwright）。
 *
 * 読み取り専用（write API を使わない）Viewer UI 契約は unit test
 * （jskim-screen-spec/test/viewer/reference-image-*.test.ts）が担当するため、
 * ここでは write API（PUT/DELETE）を伴う same-port dev フローのみを検証する。
 * 末尾の smoke test だけ、build 出力の read-only 契約（write API 非依存）を
 * 静的サーバーで軽く確認する。
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
const { createStaticServer } = require('../scripts/lib/create-static-server');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest } = require('./helpers/http-request');
const { waitFor } = require('./helpers/wait-for-output');
const { REFERENCE_IMAGE_STATUS_PATH } = require('../scripts/lib/create-reference-image-api');
const { buildMultipartBody, buildPng } = require('./helpers/multipart');

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

function parseJson(res) {
  return JSON.parse(res.body.toString('utf8'));
}

function contentRevision(buf) {
  return `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;
}

/** CRC32（PNG チャンク用の標準実装） */
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

/**
 * ブラウザで実際に読み込める最小の有効 PNG（IDAT/IEND 込み）を作る。
 * test/helpers/multipart.js の buildPng は IHDR のみ（server 側の寸法検証専用）
 * のため、<img> の実描画確認にはこちらを使う。
 */
function buildValidPng(width, height, rgb = [200, 40, 40]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: truecolor
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = pngChunk('IHDR', ihdrData);

  const rowBytes = width * 3;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filter: none
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

describe('Reference Image Viewer same-port integration', () => {
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

  /**
   * DESIGN_ONLY「design-screen」+ LINKED「device-capture-demo」の 2 画面を
   * 用意する workspace。LINKED は Description 削除 → IMPLEMENTATION_ONLY の
   * 検証（Reference Image 維持）に使う。
   */
  async function prepareWorkspace() {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-ref-viewer-')
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

    // LINKED fixture（device-capture-demo）: source + public + snapshot
    await fsp.copyFile(FIXTURE_SOURCE, path.join(pagesDir, 'demo.spec.json'));
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

    const dataDir = path.join(workspaceRoot, 'spec/sample/src/data');
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.writeFile(
      path.join(dataDir, 'device-capture-demo.json'),
      `${JSON.stringify(
        {
          schemaVersion: '1.2',
          screen: {
            id: 'device-capture-demo',
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

    // DESIGN_ONLY fixture（design-screen）: description のみ、実装なし
    await fsp.writeFile(
      path.join(dataDir, 'design-screen.json'),
      `${JSON.stringify(
        {
          schemaVersion: '1.2',
          screen: {
            id: 'design-screen',
            name: '設計画面',
            description: '',
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
      putReferenceImage: companion.putReferenceImage,
      deleteReferenceImage: companion.deleteReferenceImage,
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

  /** Viewer で screenId を開き、Preview provider を指定して reload する。 */
  async function openScreen(page, port, screenId, provider) {
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
      `[data-testid="reference-viewport-tabs"] [data-viewport="${viewport}"]`
    );
    await waitFor(
      async () =>
        (await page
          .locator(`[data-testid="reference-image-panel"][data-viewport="${viewport}"]`)
          .count()) > 0,
      { timeoutMs: 5000, label: `viewport panel switched to ${viewport}` }
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

  /** upload dialog が閉じるまで待つ（unchanged/created/updated の反映完了）。 */
  async function waitUploadDialogClosed(page, timeoutMs = 60000) {
    await waitFor(
      async () =>
        (await page
          .locator('[data-testid="reference-image-upload-dialog"]')
          .count()) === 0,
      { timeoutMs, label: 'upload dialog closed' }
    );
  }

  async function deleteViaDialog(page, timeoutMs = 60000) {
    await page.click('[data-testid="reference-image-delete"]');
    await page.waitForSelector('[data-testid="reference-image-delete-dialog"]', {
      timeout: 5000,
    });
    await page.click('[data-testid="reference-image-delete-confirm"]');
    await waitFor(
      async () =>
        (await page
          .locator('[data-testid="reference-image-delete-dialog"]')
          .count()) === 0,
      { timeoutMs, label: 'delete dialog closed' }
    );
  }

  async function putImage(port, screenId, viewport, png, expected) {
    const boundary = '----refviewer';
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
      timeoutMs: 15000,
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

  async function getDescriptionRevision(port, screenId) {
    const res = await httpRequest({
      port,
      path: `/_jskim/spec/descriptions/${screenId}`,
      headers: {
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      },
    });
    assert.equal(res.status, 200, res.body.toString('utf8'));
    return parseJson(res).revision;
  }

  async function deleteDescription(port, screenId, expectedRevision) {
    return httpRequest({
      port,
      method: 'DELETE',
      path: `/_jskim/spec/descriptions/${screenId}`,
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      },
      body: JSON.stringify({ expectedRevision }),
    });
  }

  it('1. DESIGN_ONLY PC upload via Viewer Dialog（アップロード中→created→build+1→画像表示→Description不変）', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startRuntime(workspaceRoot);
    const { port, counters } = session;
    const descriptionPath = path.join(
      workspaceRoot,
      'spec/sample/src/data/design-screen.json'
    );
    const descriptionBefore = await fsp.readFile(descriptionPath, 'utf8');

    const page = await browser.newPage();
    await openScreen(page, port, 'design-screen', 'reference');

    assert.match(
      await page.locator('[data-testid="reference-image-status-label"]').innerText(),
      /未登録/
    );
    assert.equal(
      await page.locator('[data-testid="reference-image-add"]').count(),
      1
    );

    const buildBefore = counters.build;
    const png = buildValidPng(40, 30, [220, 20, 20]);

    await openUploadDialog(page, 'add');
    await submitUploadDialog(page, png, 'pc.png');

    await waitFor(
      async () =>
        (await page.locator('[data-testid="reference-image-progress"]').count()) >
          0 ||
        (await page
          .locator('[data-testid="reference-image-upload-dialog"]')
          .count()) === 0,
      { timeoutMs: 5000, label: 'upload started' }
    );

    await waitUploadDialogClosed(page);
    await waitFor(
      () => counters.build >= buildBefore + 1 && counters.buildsInFlight === 0,
      { timeoutMs: 30000, label: 'upload build' }
    );

    assert.match(
      await page.locator('[data-testid="reference-image-status-label"]').innerText(),
      /登録済み/
    );
    const img = page.locator('[data-testid="reference-image"] img');
    await img.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await img.evaluate((el) => el.naturalWidth), 40);
    assert.equal(await img.evaluate((el) => el.naturalHeight), 30);

    const screen = await fetchScreenJson(port, 'design-screen');
    assert.equal(screen.hasReferenceImage, true);
    assert.equal(screen.referenceImages.pc.status, 'current');
    assert.equal(screen.referenceImages.pc.imageRevision, contentRevision(png));

    const descriptionAfter = await fsp.readFile(descriptionPath, 'utf8');
    assert.equal(descriptionAfter, descriptionBefore);

    await page.close();
  });

  it('2. SP upload → PC/SP 両方 current、PC は維持される', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startRuntime(workspaceRoot);
    const { port, counters } = session;

    const pngPc = buildValidPng(20, 20, [10, 200, 10]);
    const putPc = parseJson(await putImage(port, 'design-screen', 'pc', pngPc));
    assert.equal(putPc.result, 'created');
    await waitFor(
      () => counters.build >= 1 && counters.buildsInFlight === 0,
      { timeoutMs: 15000, label: 'pc setup build' }
    );

    const page = await browser.newPage();
    await openScreen(page, port, 'design-screen', 'reference');
    await selectReferenceViewport(page, 'sp');
    assert.match(
      await page.locator('[data-testid="reference-image-status-label"]').innerText(),
      /未登録/
    );

    const buildBefore = counters.build;
    const pngSp = buildValidPng(15, 25, [10, 10, 200]);
    await openUploadDialog(page, 'add');
    await submitUploadDialog(page, pngSp, 'sp.png');
    await waitUploadDialogClosed(page);
    await waitFor(
      () => counters.build >= buildBefore + 1 && counters.buildsInFlight === 0,
      { timeoutMs: 30000, label: 'sp upload build' }
    );

    const spImg = page.locator('[data-testid="reference-image"] img');
    await spImg.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await spImg.evaluate((el) => el.naturalWidth), 15);

    const screen = await fetchScreenJson(port, 'design-screen');
    assert.equal(screen.referenceImages.sp.status, 'current');
    assert.equal(screen.referenceImages.sp.imageRevision, contentRevision(pngSp));
    // PC 維持
    assert.equal(screen.referenceImages.pc.status, 'current');
    assert.equal(screen.referenceImages.pc.imageRevision, putPc.referenceImage.imageRevision);

    await selectReferenceViewport(page, 'pc');
    const pcImg = page.locator('[data-testid="reference-image"] img');
    await pcImg.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await pcImg.evaluate((el) => el.naturalWidth), 20);

    await page.close();
  });

  it('3. Replace via Dialog → updated、新しい画像に切り替わる', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startRuntime(workspaceRoot);
    const { port, counters } = session;

    const pngOld = buildValidPng(30, 30, [200, 200, 0]);
    const created = parseJson(await putImage(port, 'design-screen', 'pc', pngOld));
    await waitFor(
      () => counters.build >= 1 && counters.buildsInFlight === 0,
      { timeoutMs: 15000, label: 'initial build' }
    );

    const page = await browser.newPage();
    await openScreen(page, port, 'design-screen', 'reference');
    const imgBefore = page.locator('[data-testid="reference-image"] img');
    await imgBefore.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await imgBefore.evaluate((el) => el.naturalWidth), 30);
    assert.equal(
      await page.locator('[data-testid="reference-image-replace"]').count(),
      1
    );

    const buildBefore = counters.build;
    const pngNew = buildValidPng(50, 10, [0, 200, 200]);
    await openUploadDialog(page, 'replace');
    await submitUploadDialog(page, pngNew, 'replace.png');
    await waitUploadDialogClosed(page);
    await waitFor(
      () => counters.build >= buildBefore + 1 && counters.buildsInFlight === 0,
      { timeoutMs: 30000, label: 'replace build' }
    );

    const imgAfter = page.locator('[data-testid="reference-image"] img');
    await imgAfter.waitFor({ state: 'visible', timeout: 10000 });
    await waitFor(
      async () => (await imgAfter.evaluate((el) => el.naturalWidth)) === 50,
      { timeoutMs: 10000, label: 'replaced image rendered' }
    );
    assert.equal(await imgAfter.evaluate((el) => el.naturalHeight), 10);

    const screen = await fetchScreenJson(port, 'design-screen');
    assert.equal(screen.referenceImages.pc.imageRevision, contentRevision(pngNew));
    assert.notEqual(
      screen.referenceImages.pc.imageRevision,
      created.referenceImage.imageRevision
    );

    await page.close();
  });

  it('4. 同一 PNG の再アップロード（Replace）→ unchanged、build 0', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startRuntime(workspaceRoot);
    const { port, counters } = session;

    const png = buildValidPng(24, 24, [128, 64, 200]);
    parseJson(await putImage(port, 'design-screen', 'pc', png));
    await waitFor(
      () => counters.build >= 1 && counters.buildsInFlight === 0,
      { timeoutMs: 15000, label: 'initial build' }
    );

    const metaPath = path.join(
      workspaceRoot,
      'spec/sample/src/references/design-screen/pc/meta.json'
    );
    const metaBefore = await fsp.readFile(metaPath);

    const page = await browser.newPage();
    await openScreen(page, port, 'design-screen', 'reference');
    await page.locator('[data-testid="reference-image"] img').waitFor({
      state: 'visible',
      timeout: 10000,
    });

    const buildBefore = counters.build;
    await openUploadDialog(page, 'replace');
    await submitUploadDialog(page, png, 'same.png');
    await waitUploadDialogClosed(page);

    await waitFor(
      async () =>
        (await page.locator('[data-testid="reference-image-info"]').count()) > 0,
      { timeoutMs: 10000, label: 'unchanged info message' }
    );
    assert.match(
      await page.locator('[data-testid="reference-image-info"]').innerText(),
      /同じ参照画像/
    );

    await new Promise((r) => setTimeout(r, 500));
    assert.equal(counters.build, buildBefore);
    assert.ok((await fsp.readFile(metaPath)).equals(metaBefore));

    await page.close();
  });

  it('5. Delete PC → missing、SP は維持される', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startRuntime(workspaceRoot);
    const { port, counters } = session;

    const pngPc = buildValidPng(18, 18, [5, 5, 5]);
    const pngSp = buildValidPng(12, 12, [250, 250, 250]);
    parseJson(await putImage(port, 'design-screen', 'pc', pngPc));
    parseJson(await putImage(port, 'design-screen', 'sp', pngSp));
    // debounce により PC/SP の書き込みが 1 回の build にまとめられる場合がある
    await waitFor(
      () => counters.build >= 1 && counters.buildsInFlight === 0,
      { timeoutMs: 20000, label: 'pc/sp setup build' }
    );
    await waitFor(
      async () => {
        const screen = await fetchScreenJson(port, 'design-screen');
        return (
          screen?.referenceImages?.pc?.status === 'current' &&
          screen?.referenceImages?.sp?.status === 'current'
        );
      },
      { timeoutMs: 15000, label: 'pc/sp both current in manifest' }
    );

    const page = await browser.newPage();
    await openScreen(page, port, 'design-screen', 'reference');
    await page.locator('[data-testid="reference-image"] img').waitFor({
      state: 'visible',
      timeout: 10000,
    });

    const buildBefore = counters.build;
    await deleteViaDialog(page);
    await waitFor(
      () => counters.build >= buildBefore + 1 && counters.buildsInFlight === 0,
      { timeoutMs: 30000, label: 'delete build' }
    );

    await waitFor(
      async () =>
        /未登録/.test(
          await page.locator('[data-testid="reference-image-status-label"]').innerText()
        ),
      { timeoutMs: 10000, label: 'pc missing status' }
    );
    assert.equal(
      await page.locator('[data-testid="reference-image-add"]').count(),
      1
    );
    assert.equal(
      await page.locator('[data-testid="reference-image"]').count(),
      0
    );

    const screen = await fetchScreenJson(port, 'design-screen');
    assert.equal(screen.referenceImages.pc.status, 'missing');
    assert.equal(screen.referenceImages.sp.status, 'current');

    await selectReferenceViewport(page, 'sp');
    const spImg = page.locator('[data-testid="reference-image"] img');
    await spImg.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await spImg.evaluate((el) => el.naturalWidth), 12);

    await page.close();
  });

  it('6. PUT 失敗（failMetaAtomicReplace）: meta 不変・build 0 → 成功リトライ', async () => {
    const workspaceRoot = await prepareWorkspace();
    let failNext = false;
    const session = await startRuntime(workspaceRoot, {
      getReferenceImagePutHooks: () =>
        failNext ? { failMetaAtomicReplace: true } : {},
    });
    const { port, counters } = session;

    const pngOld = buildValidPng(28, 28, [90, 90, 200]);
    const created = parseJson(await putImage(port, 'design-screen', 'pc', pngOld));
    assert.equal(created.result, 'created');
    await waitFor(
      () => counters.build >= 1 && counters.buildsInFlight === 0,
      { timeoutMs: 15000, label: 'initial build' }
    );

    const page = await browser.newPage();
    await openScreen(page, port, 'design-screen', 'reference');
    const img = page.locator('[data-testid="reference-image"] img');
    await img.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await img.evaluate((el) => el.naturalWidth), 28);

    const metaPath = path.join(
      workspaceRoot,
      'spec/sample/src/references/design-screen/pc/meta.json'
    );
    const metaBefore = await fsp.readFile(metaPath);
    const buildBeforeFail = counters.build;

    failNext = true;
    const pngNew = buildValidPng(60, 60, [10, 250, 10]);
    const failRes = await putImage(
      port,
      'design-screen',
      'pc',
      pngNew,
      created.referenceImage.imageRevision
    );
    assert.equal(failRes.status, 500, failRes.body.toString('utf8'));
    assert.equal(parseJson(failRes).code, 'SPEC_REFERENCE_IMAGE_WRITE_FAILED');

    await new Promise((r) => setTimeout(r, 500));
    assert.equal(counters.build, buildBeforeFail);
    assert.ok((await fsp.readFile(metaPath)).equals(metaBefore));

    // Viewer を再読込 → 失敗状態を反映しつつ既存画像は維持
    await openScreen(page, port, 'design-screen', 'reference');
    await waitFor(
      async () =>
        (await page.locator('[data-testid="reference-image-error"]').count()) > 0,
      { timeoutMs: 10000, label: 'failed status shown' }
    );
    assert.match(
      await page.locator('[data-testid="reference-image-error"]').innerText(),
      /失敗/
    );
    const keptImg = page.locator('[data-testid="reference-image"] img');
    await keptImg.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await keptImg.evaluate((el) => el.naturalWidth), 28);

    // 成功リトライ（Viewer Dialog）
    failNext = false;
    const buildBeforeRetry = counters.build;
    await openUploadDialog(page, 'replace');
    await submitUploadDialog(page, pngNew, 'retry.png');
    await waitUploadDialogClosed(page);
    await waitFor(
      () =>
        counters.build >= buildBeforeRetry + 1 && counters.buildsInFlight === 0,
      { timeoutMs: 30000, label: 'retry build' }
    );
    const retriedImg = page.locator('[data-testid="reference-image"] img');
    await retriedImg.waitFor({ state: 'visible', timeout: 10000 });
    await waitFor(
      async () => (await retriedImg.evaluate((el) => el.naturalWidth)) === 60,
      { timeoutMs: 10000, label: 'retry image rendered' }
    );

    await page.close();
  });

  it('7. DELETE 失敗（failMetaUnlink）: 画像維持・build 0 → 成功リトライ', async () => {
    const workspaceRoot = await prepareWorkspace();
    let failNext = false;
    const session = await startRuntime(workspaceRoot, {
      getReferenceImageDeleteHooks: () =>
        failNext ? { failMetaUnlink: true } : {},
    });
    const { port, counters } = session;

    const png = buildValidPng(22, 22, [200, 100, 30]);
    const created = parseJson(await putImage(port, 'design-screen', 'pc', png));
    await waitFor(
      () => counters.build >= 1 && counters.buildsInFlight === 0,
      { timeoutMs: 15000, label: 'initial build' }
    );

    const page = await browser.newPage();
    await openScreen(page, port, 'design-screen', 'reference');
    const img = page.locator('[data-testid="reference-image"] img');
    await img.waitFor({ state: 'visible', timeout: 10000 });

    const metaPath = path.join(
      workspaceRoot,
      'spec/sample/src/references/design-screen/pc/meta.json'
    );
    const buildBeforeFail = counters.build;

    failNext = true;
    const failRes = await deleteImage(
      port,
      'design-screen',
      'pc',
      created.referenceImage.imageRevision
    );
    assert.equal(failRes.status, 500, failRes.body.toString('utf8'));
    assert.equal(parseJson(failRes).code, 'SPEC_REFERENCE_IMAGE_WRITE_FAILED');

    await new Promise((r) => setTimeout(r, 500));
    assert.equal(counters.build, buildBeforeFail);
    assert.equal(fs.existsSync(metaPath), true);

    await openScreen(page, port, 'design-screen', 'reference');
    await waitFor(
      async () =>
        (await page.locator('[data-testid="reference-image-error"]').count()) > 0,
      { timeoutMs: 10000, label: 'failed delete status shown' }
    );
    assert.match(
      await page.locator('[data-testid="reference-image-error"]').innerText(),
      /失敗/
    );
    const keptImg = page.locator('[data-testid="reference-image"] img');
    await keptImg.waitFor({ state: 'visible', timeout: 10000 });

    // 成功リトライ（Viewer Dialog）
    failNext = false;
    const buildBeforeRetry = counters.build;
    await deleteViaDialog(page);
    await waitFor(
      () =>
        counters.build >= buildBeforeRetry + 1 && counters.buildsInFlight === 0,
      { timeoutMs: 30000, label: 'retry delete build' }
    );
    await waitFor(
      async () =>
        /未登録/.test(
          await page.locator('[data-testid="reference-image-status-label"]').innerText()
        ),
      { timeoutMs: 10000, label: 'retry delete missing status' }
    );
    assert.equal(fs.existsSync(metaPath), false);

    await page.close();
  });

  it('8. LINKED Description 削除 → IMPLEMENTATION_ONLY でも Reference は Viewer に表示される', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startRuntime(workspaceRoot);
    const { port, counters } = session;

    const png = buildValidPng(33, 33, [30, 30, 30]);
    const putRes = parseJson(
      await putImage(port, 'device-capture-demo', 'pc', png)
    );
    assert.equal(putRes.result, 'created');
    await waitFor(
      () => counters.build >= 1 && counters.buildsInFlight === 0,
      { timeoutMs: 15000, label: 'linked reference build' }
    );

    const page = await browser.newPage();
    await openScreen(page, port, 'device-capture-demo', 'reference');
    assert.equal(
      await page.locator('.spec-page__status-badge').innerText(),
      '連携済み'
    );
    const linkedImg = page.locator('[data-testid="reference-image"] img');
    await linkedImg.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await linkedImg.evaluate((el) => el.naturalWidth), 33);

    const rev = await getDescriptionRevision(port, 'device-capture-demo');
    const buildBefore = counters.build;
    const del = await deleteDescription(port, 'device-capture-demo', rev);
    assert.equal(del.status, 200, del.body.toString('utf8'));
    await waitFor(
      () => counters.build >= buildBefore + 1 && counters.buildsInFlight === 0,
      { timeoutMs: 30000, label: 'description delete build' }
    );

    await openScreen(page, port, 'device-capture-demo', 'reference');
    assert.equal(
      await page.locator('.spec-page__status-badge').innerText(),
      '実装のみ'
    );
    const imgAfter = page.locator('[data-testid="reference-image"] img');
    await imgAfter.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await imgAfter.evaluate((el) => el.naturalWidth), 33);

    const screen = await fetchScreenJson(port, 'device-capture-demo');
    assert.equal(screen.status, 'implementation-only');
    assert.equal(screen.referenceImages.pc.status, 'current');

    await page.close();
  });

  it('9. DESIGN_ONLY orphan: Description 削除で画面は消えるが reference meta は残存 → PUT/status 404', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startRuntime(workspaceRoot);
    const { port, counters } = session;

    const png = buildValidPng(16, 16, [1, 2, 3]);
    parseJson(await putImage(port, 'design-screen', 'pc', png));
    await waitFor(
      () => counters.build >= 1 && counters.buildsInFlight === 0,
      { timeoutMs: 15000, label: 'orphan setup build' }
    );

    const metaPath = path.join(
      workspaceRoot,
      'spec/sample/src/references/design-screen/pc/meta.json'
    );
    const imagesDir = path.join(
      workspaceRoot,
      'spec/sample/src/references/design-screen/pc'
    );
    assert.equal(fs.existsSync(metaPath), true);
    const imageFiles = (await fsp.readdir(imagesDir)).filter((n) =>
      n.startsWith('reference-')
    );
    assert.equal(imageFiles.length, 1);

    const rev = await getDescriptionRevision(port, 'design-screen');
    const del = await deleteDescription(port, 'design-screen', rev);
    assert.equal(del.status, 200, del.body.toString('utf8'));

    await waitFor(() => {
      const project = companion.loadScreenSpecProject({
        rootDir: workspaceRoot,
        projectName: 'sample',
      });
      return !project.screens.some((s) => s.screenId === 'design-screen');
    }, { timeoutMs: 10000, label: 'screen removed from project' });

    // orphan: 画面は無くなったが reference ファイルは残る
    assert.equal(fs.existsSync(metaPath), true);
    assert.equal(
      (await fsp.readdir(imagesDir)).filter((n) => n.startsWith('reference-')).length,
      1
    );

    const putAfter = await putImage(
      port,
      'design-screen',
      'pc',
      buildValidPng(10, 10)
    );
    assert.equal(putAfter.status, 404, putAfter.body.toString('utf8'));
    assert.equal(
      parseJson(putAfter).code,
      'SPEC_REFERENCE_IMAGE_SCREEN_NOT_FOUND'
    );

    const statusAfter = await httpRequest({
      port,
      path: `${REFERENCE_IMAGE_STATUS_PATH}?screenId=design-screen&viewport=pc`,
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
      },
    });
    assert.equal(statusAfter.status, 404, statusAfter.body.toString('utf8'));
    assert.equal(
      parseJson(statusAfter).code,
      'SPEC_REFERENCE_IMAGE_SCREEN_NOT_FOUND'
    );
  });

  it('read-only smoke: 静的 build 出力は write API 非依存で Reference Image を提供する', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startRuntime(workspaceRoot);
    const png = buildValidPng(14, 14, [77, 88, 99]);
    parseJson(await putImage(session.port, 'design-screen', 'pc', png));
    await waitFor(
      () => session.counters.build >= 1 && session.counters.buildsInFlight === 0,
      { timeoutMs: 15000, label: 'static smoke setup build' }
    );
    await companion.buildScreenSpecViewer({
      rootDir: workspaceRoot,
      projectName: 'sample',
      base: '/spec/',
    });
    await session.close();
    sessions.pop();

    const port = await getFreePort();
    const server = createStaticServer({
      rootDir: path.join(workspaceRoot, 'spec/sample/dist'),
      host: '127.0.0.1',
      port,
    });
    await server.start();

    const screenPath = path.join(
      workspaceRoot,
      'spec/sample/dist/data/screens/design-screen.json'
    );
    const screen = JSON.parse(await fsp.readFile(screenPath, 'utf8'));
    assert.equal(screen.hasReferenceImage, true);
    assert.equal(screen.referenceImages.pc.status, 'current');
    const imgRes = await httpRequest({
      port,
      path: `/data/${screen.referenceImages.pc.imagePath}`,
    });
    assert.equal(imgRes.status, 200);
    assert.equal(contentRevision(imgRes.body), screen.referenceImages.pc.imageRevision);

    const writeAttempt = await httpRequest({
      port,
      method: 'PUT',
      path: '/_jskim/spec/reference-images/design-screen/pc',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
      body: '--x--\r\n',
    });
    assert.notEqual(writeAttempt.status, 200);

    await server.stop();
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
  });
});
