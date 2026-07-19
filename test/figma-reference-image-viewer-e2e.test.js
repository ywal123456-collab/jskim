'use strict';

/**
 * Phase 7D-3: Viewer Figma Import/Reimport E2E（mock Figma、実 PAT なし）。
 */

const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const { createSpecDevRuntime } = require('../scripts/lib/create-spec-dev-runtime');
const { getFreePort } = require('./helpers/get-free-port');
const { waitFor } = require('./helpers/wait-for-output');
const { buildPng } = require('./helpers/multipart');

const requireFromHere = createRequire(__filename);
const PLAYWRIGHT = requireFromHere('playwright');

const REPO_ROOT = path.resolve(__dirname, '..');
const COMPANION_ENTRY = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js'
);

const TOKEN = 'e2e-figma-token';
const FILE_KEY = 'FileKeyE2E';
const NODE_ID = '1:3';
const IMAGE_URL = 'https://images.example/e2e.png';

function boxesOverlap(a, b) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

describe('Figma Reference Image Viewer E2E', () => {
  /** @type {Array<{ close: Function, cleanup: Function }>} */
  const sessions = [];
  /** @type {import('playwright').Browser|null} */
  let browser = null;
  /** @type {object|null} */
  let companion = null;
  let previousToken;

  before(async () => {
    companion = await import(pathToFileURL(COMPANION_ENTRY).href);
    browser = await PLAYWRIGHT.chromium.launch({ headless: true });
    previousToken = process.env.JSKIM_FIGMA_TOKEN;
    process.env.JSKIM_FIGMA_TOKEN = TOKEN;
  });

  after(async () => {
    if (previousToken === undefined) {
      delete process.env.JSKIM_FIGMA_TOKEN;
    } else {
      process.env.JSKIM_FIGMA_TOKEN = previousToken;
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
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
    }
  });

  async function prepareWorkspace() {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-figma-e2e-')
    );
    const pagesDir = path.join(workspaceRoot, 'src/sample/pages');
    await fsp.mkdir(pagesDir, { recursive: true });
    await fsp.mkdir(path.join(workspaceRoot, 'dist/sample'), { recursive: true });
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
    await fsp.writeFile(
      path.join(pagesDir, 'index.html.njk'),
      '<!doctype html><html><body>ok</body></html>\n'
    );
    const dataDir = path.join(workspaceRoot, 'spec/sample/src/data');
    await fsp.mkdir(dataDir, { recursive: true });
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
          items: {},
          excludedItems: {},
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

  async function startRuntime(workspaceRoot, pngState) {
    const port = await getFreePort();
    const fetchImpl = async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes('/nodes')) {
        return new Response(
          JSON.stringify({
            name: 'File',
            nodes: {
              [NODE_ID]: {
                document: {
                  id: NODE_ID,
                  type: 'FRAME',
                  name: pngState.frameName || 'Hero',
                  absoluteBoundingBox: {
                    x: 0,
                    y: 0,
                    width: pngState.width ?? 1440,
                    height: pngState.height ?? 2000,
                  },
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/images/')) {
        return new Response(
          JSON.stringify({ images: { [NODE_ID]: IMAGE_URL } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.startsWith(IMAGE_URL)) {
        const png = pngState.png;
        return new Response(Uint8Array.from(png), {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': String(png.length),
          },
        });
      }
      throw new Error(`未設定の fetch: ${url}`);
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
      getFigmaHooks: () => ({
        env: { JSKIM_FIGMA_TOKEN: TOKEN },
        fetchImpl,
        sleep: async () => {},
      }),
      collectFn: async () => ({ screens: 0, statuses: 0 }),
      buildFn: async () => {
        await companion.buildScreenSpecViewer({
          rootDir: workspaceRoot,
          projectName: 'sample',
          base: '/spec/',
        });
        return { outDir: path.join(workspaceRoot, 'spec/sample/dist') };
      },
      classifyPath: companion.classifyScreenSpecWatchPath,
      mergeKinds: companion.mergeScreenSpecWatchKinds,
      createFileDescriptionStore: companion.createFileDescriptionStore,
      loadScreenSpecProject: companion.loadScreenSpecProject,
      withDescriptionScreenLock: companion.withDescriptionScreenLock,
      putReferenceImage: companion.putReferenceImage,
      deleteReferenceImage: companion.deleteReferenceImage,
      getReferenceImagePublicInfo: companion.getReferenceImagePublicInfo,
      importFigmaReferenceImage: companion.importFigmaReferenceImage,
      reimportFigmaReferenceImage: companion.reimportFigmaReferenceImage,
      collectDeviceCapture: companion.collectDeviceCapture,
      getDeviceCapturePublicInfo: companion.getDeviceCapturePublicInfo,
    });
    await runtime.start();
    await companion.buildScreenSpecViewer({
      rootDir: workspaceRoot,
      projectName: 'sample',
      base: '/spec/',
    });
    sessions.push({
      close: () =>
        Promise.race([
          runtime.close(),
          new Promise((resolve) => setTimeout(resolve, 8000)),
        ]),
      cleanup: () => fsp.rm(workspaceRoot, { recursive: true, force: true }),
    });
    return { port, runtime, workspaceRoot };
  }

  async function openDesignReference(page, port) {
    await page.goto(`http://127.0.0.1:${port}/spec/screens/design-screen`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.evaluate(() => {
      sessionStorage.setItem('jskim-spec-preview-provider:sample', 'reference');
    });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('[data-testid="reference-image-panel"]', {
      timeout: 20000,
    });
  }

  async function assertNoSecretsInDom(page) {
    const html = await page.content();
    assert.doesNotMatch(html, /FileKeyE2E/);
    assert.doesNotMatch(html, /e2e-figma-token/);
    assert.doesNotMatch(html, /images\.example\/e2e\.png/);
    assert.doesNotMatch(html, /"nodeId"\s*:/);
    assert.doesNotMatch(html, /"fileKey"\s*:/);
  }

  async function assertDialogInsideViewport(page) {
    const metrics = await page.evaluate(() => {
      const dialog = document.querySelector(
        '[data-testid="reference-image-figma-dialog"] .create-screen-dialog',
      );
      const panel = document.querySelector(
        '[data-testid="reference-image-panel"]',
      );
      if (!dialog || !panel) {
        return null;
      }
      const d = dialog.getBoundingClientRect();
      const actions = [
        ...panel.querySelectorAll('.reference-image-panel__actions button'),
      ].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const err = document.querySelector(
        '[data-testid="reference-image-figma-error"]',
      );
      return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
        dialog: { x: d.x, y: d.y, width: d.width, height: d.height },
        dialogScrollWidth: dialog.scrollWidth,
        dialogClientWidth: dialog.clientWidth,
        error: err
          ? {
              scrollWidth: err.scrollWidth,
              clientWidth: err.clientWidth,
              width: err.getBoundingClientRect().width,
            }
          : null,
        actions,
      };
    });
    assert.ok(metrics, 'dialog metrics');
    assert.ok(metrics.dialog.x >= -1);
    assert.ok(metrics.dialog.y >= -1);
    assert.ok(metrics.dialog.x + metrics.dialog.width <= metrics.vw + 2);
    assert.ok(metrics.dialog.y + metrics.dialog.height <= metrics.vh + 2);
    assert.ok(
      metrics.docScrollWidth <= metrics.docClientWidth + 1,
      `document horizontal overflow at ${metrics.vw}`,
    );
    assert.ok(
      metrics.dialogScrollWidth <= metrics.dialogClientWidth + 1,
      `dialog content overflow at ${metrics.vw}`,
    );
    if (metrics.error) {
      assert.ok(
        metrics.error.scrollWidth <= metrics.error.clientWidth + 1,
        `error text overflow at ${metrics.vw}`,
      );
      assert.ok(
        metrics.error.width <= metrics.dialog.width + 1,
        `error wider than dialog at ${metrics.vw}`,
      );
    }
    for (let i = 0; i < metrics.actions.length; i += 1) {
      for (let j = i + 1; j < metrics.actions.length; j += 1) {
        assert.equal(
          boxesOverlap(metrics.actions[i], metrics.actions[j]),
          false,
          `action buttons overlap at ${metrics.vw}`,
        );
      }
    }
  }

  async function assertPanelNoHorizontalOverflow(page) {
    const metrics = await page.evaluate(() => {
      const panel = document.querySelector(
        '[data-testid="reference-image-panel"]',
      );
      const source = document.querySelector(
        '[data-testid="reference-image-source"]',
      );
      if (!panel) {
        return null;
      }
      const p = panel.getBoundingClientRect();
      const actions = [
        ...panel.querySelectorAll('.reference-image-panel__actions button'),
      ].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      return {
        vw: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
        panel: {
          x: p.x,
          width: p.width,
          scrollWidth: panel.scrollWidth,
          clientWidth: panel.clientWidth,
        },
        source: source
          ? {
              scrollWidth: source.scrollWidth,
              clientWidth: source.clientWidth,
              width: source.getBoundingClientRect().width,
            }
          : null,
        actions,
      };
    });
    assert.ok(metrics, 'panel metrics');
    assert.ok(
      metrics.docScrollWidth <= metrics.docClientWidth + 1,
      'document horizontal overflow with long frameName',
    );
    assert.ok(
      metrics.panel.x + metrics.panel.width <= metrics.vw + 2,
      'panel exceeds viewport',
    );
    assert.ok(
      metrics.panel.scrollWidth <= metrics.panel.clientWidth + 1,
      'panel horizontal scroll overflow',
    );
    if (metrics.source) {
      assert.ok(
        metrics.source.scrollWidth <= metrics.source.clientWidth + 1,
        'source area horizontal overflow',
      );
      assert.ok(
        metrics.source.width <= metrics.panel.width + 1,
        'source wider than panel',
      );
    }
    for (let i = 0; i < metrics.actions.length; i += 1) {
      for (let j = i + 1; j < metrics.actions.length; j += 1) {
        assert.equal(
          boxesOverlap(metrics.actions[i], metrics.actions[j]),
          false,
          'action buttons overlap with long frameName',
        );
      }
    }
  }

  async function assertActiveTestId(page, testId) {
    const ok = await page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return Boolean(el && document.activeElement === el);
    }, testId);
    assert.equal(ok, true, `focus should be on ${testId}`);
  }

  it('Import → source 表示 → reload → Reimport / 幅不一致確認', async () => {
    const workspaceRoot = await prepareWorkspace();
    const pngState = {
      png: buildPng(1440, 2000, 1),
      frameName: 'Hero',
      width: 1440,
      height: 2000,
    };
    const { port } = await startRuntime(workspaceRoot, pngState);
    const page = await browser.newPage();
    /** @type {object[]} */
    const figmaBodies = [];
    page.on('request', (req) => {
      const u = req.url();
      if (
        (u.includes('/figma:import') || u.includes('/figma:reimport')) &&
        req.method() === 'POST'
      ) {
        try {
          figmaBodies.push(JSON.parse(req.postData() || '{}'));
        } catch {
          figmaBodies.push({});
        }
      }
    });

    try {
      await openDesignReference(page, port);
      // missing（upload でない）時点では Reimport 非表示（upload 非表示は panel unit）
      assert.equal(
        await page.locator('[data-testid="reference-image-figma-reimport"]').count(),
        0,
      );
      assert.equal(
        await page.locator('[data-testid="reference-image-figma-import"]').count(),
        1,
      );

      await page.click('[data-testid="reference-image-figma-import"]');
      await page.waitForSelector('[data-testid="reference-image-figma-dialog"]');
      await page.waitForFunction(() => {
        const el = document.querySelector(
          '[data-testid="reference-image-figma-url"]',
        );
        return el && document.activeElement === el;
      });
      // Escape → Import trigger へ focus 復帰
      await page.keyboard.press('Escape');
      await waitFor(
        async () =>
          (await page.locator('[data-testid="reference-image-figma-dialog"]').count()) ===
          0,
        { timeoutMs: 5000, label: 'Escape closes before import' },
      );
      await assertActiveTestId(page, 'reference-image-figma-import');

      await page.click('[data-testid="reference-image-figma-import"]');
      await page.waitForSelector('[data-testid="reference-image-figma-dialog"]');
      await page.waitForFunction(() => {
        const el = document.querySelector(
          '[data-testid="reference-image-figma-url"]',
        );
        return el && document.activeElement === el;
      });
      await page.fill(
        '[data-testid="reference-image-figma-url"]',
        `https://www.figma.com/design/${FILE_KEY}/Name?node-id=1-3`,
      );
      await page.click('[data-testid="reference-image-figma-submit"]');
      await waitFor(
        async () =>
          (await page.locator('[data-testid="reference-image-figma-dialog"]').count()) ===
          0,
        { timeoutMs: 60000, label: 'figma dialog closed after import' },
      );
      await waitFor(
        async () =>
          (await page.locator('[data-testid="reference-image-source"]').count()) >
          0,
        { timeoutMs: 30000, label: 'source visible' },
      );
      const sourceText = await page
        .locator('[data-testid="reference-image-source"]')
        .innerText();
      assert.match(sourceText, /Figma/);
      assert.match(sourceText, /Hero/);
      assert.doesNotMatch(sourceText, /FileKeyE2E/);
      await assertNoSecretsInDom(page);

      assert.ok(figmaBodies.length >= 1);
      assert.equal(figmaBodies[0].confirmWidthMismatch, false);
      assert.ok(figmaBodies[0].figmaUrl);
      assert.equal(figmaBodies[0].fileKey, undefined);
      assert.equal(figmaBodies[0].token, undefined);

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForSelector('[data-testid="reference-image-figma-reimport"]', {
        timeout: 20000,
      });
      assert.match(
        await page.locator('[data-testid="reference-image-source"]').innerText(),
        /Figma/,
      );
      await assertNoSecretsInDom(page);

      pngState.png = buildPng(1440, 2000, 2);
      pngState.frameName = 'Hero v2';
      const bodyCountBeforeReimport = figmaBodies.length;
      await page.click('[data-testid="reference-image-figma-reimport"]');
      await page.waitForSelector('[data-testid="reference-image-figma-dialog"]');
      await page.click('[data-testid="reference-image-figma-submit"]');
      await waitFor(
        async () =>
          (await page.locator('[data-testid="reference-image-figma-dialog"]').count()) ===
          0,
        { timeoutMs: 60000, label: 'reimport dialog closed' },
      );
      await waitFor(
        async () =>
          (
            await page.locator('[data-testid="reference-image-source"]').innerText()
          ).includes('Hero v2'),
        { timeoutMs: 30000, label: 'frame name updated' },
      );
      const reimportBody = figmaBodies[bodyCountBeforeReimport];
      assert.ok(reimportBody);
      assert.equal(reimportBody.confirmWidthMismatch, false);
      assert.equal(reimportBody.figmaUrl, undefined);
      assert.equal(reimportBody.fileKey, undefined);

      // 幅不一致 → キャンセルで不変
      const LONG_FRAME =
        'VeryLongFigmaFrameNameVeryLongFigmaFrameNameVeryLongFigmaFrameNameVeryLongFigmaFrameName';
      pngState.width = 1600;
      pngState.png = buildPng(1600, 2000, 3);
      pngState.frameName = LONG_FRAME;
      await page.click('[data-testid="reference-image-figma-reimport"]');
      await page.waitForSelector('[data-testid="reference-image-figma-dialog"]');
      await page.click('[data-testid="reference-image-figma-submit"]');
      await page.waitForSelector(
        '[data-testid="reference-image-figma-width-confirm"]',
        { timeout: 15000 },
      );
      assert.match(
        await page
          .locator('[data-testid="reference-image-figma-width-confirm"]')
          .innerText(),
        new RegExp(LONG_FRAME),
      );
      await page.click('[data-testid="reference-image-figma-cancel"]');
      await waitFor(
        async () =>
          (await page.locator('[data-testid="reference-image-figma-dialog"]').count()) ===
          0,
        { timeoutMs: 10000, label: 'cancel closes dialog' },
      );
      await assertActiveTestId(page, 'reference-image-figma-reimport');
      const afterCancel = await page
        .locator('[data-testid="reference-image-source"]')
        .innerText();
      assert.match(afterCancel, /Hero v2/);

      // 確認して取り込み
      const bodyCountBeforeConfirm = figmaBodies.length;
      await page.click('[data-testid="reference-image-figma-reimport"]');
      await page.waitForSelector('[data-testid="reference-image-figma-dialog"]');
      await page.click('[data-testid="reference-image-figma-submit"]');
      await page.waitForSelector(
        '[data-testid="reference-image-figma-width-confirm"]',
        { timeout: 15000 },
      );
      await page.click('[data-testid="reference-image-figma-submit"]');
      await waitFor(
        async () =>
          (
            await page.locator('[data-testid="reference-image-source"]').innerText()
          ).includes(LONG_FRAME),
        { timeoutMs: 60000, label: 'confirmed wide import' },
      );
      const confirmBodies = figmaBodies.slice(bodyCountBeforeConfirm);
      assert.ok(
        confirmBodies.some((b) => b.confirmWidthMismatch === true),
        'confirmWidthMismatch=true 再リクエスト',
      );
      await assertNoSecretsInDom(page);

      // 390px: 長い frameName の geometry
      await page.setViewportSize({ width: 390, height: 900 });
      await assertPanelNoHorizontalOverflow(page);

      // Escape で dialog を閉じ → Reimport へ focus 復帰
      await page.click('[data-testid="reference-image-figma-reimport"]');
      await page.waitForSelector('[data-testid="reference-image-figma-dialog"]');
      await page.keyboard.press('Escape');
      await waitFor(
        async () =>
          (await page.locator('[data-testid="reference-image-figma-dialog"]').count()) ===
          0,
        { timeoutMs: 5000, label: 'Escape closes dialog' },
      );
      await assertActiveTestId(page, 'reference-image-figma-reimport');

      // 390px: 長い日本語エラーの geometry（API を一時的に差し替え）
      const longError =
        `${'あ'.repeat(100)} Figma API の利用上限に達しました。（約 12 秒後に再試行できます）`;
      await page.route('**/figma:import', async (route) => {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'SPEC_FIGMA_LONG_ERROR_TEST',
            message: longError,
          }),
        });
      });
      await page.click('[data-testid="reference-image-figma-import"]');
      await page.waitForSelector('[data-testid="reference-image-figma-dialog"]');
      await page.fill(
        '[data-testid="reference-image-figma-url"]',
        `https://www.figma.com/design/${FILE_KEY}/Name?node-id=1-3`,
      );
      await page.click('[data-testid="reference-image-figma-submit"]');
      await page.waitForSelector('[data-testid="reference-image-figma-error"]', {
        timeout: 15000,
      });
      assert.match(
        await page.locator('[data-testid="reference-image-figma-error"]').innerText(),
        /利用上限/,
      );
      await assertDialogInsideViewport(page);
      await page.unroute('**/figma:import');
      await page.keyboard.press('Escape');
      await waitFor(
        async () =>
          (await page.locator('[data-testid="reference-image-figma-dialog"]').count()) ===
          0,
        { timeoutMs: 5000, label: 'Escape after long error' },
      );

      // responsive: dialog / action overlap
      for (const width of [1440, 1024, 768, 390]) {
        // eslint-disable-next-line no-await-in-loop
        await page.setViewportSize({ width, height: 900 });
        // eslint-disable-next-line no-await-in-loop
        await page.click('[data-testid="reference-image-figma-import"]');
        // eslint-disable-next-line no-await-in-loop
        await page.waitForSelector('[data-testid="reference-image-figma-dialog"]');
        // eslint-disable-next-line no-await-in-loop
        await assertDialogInsideViewport(page);
        // eslint-disable-next-line no-await-in-loop
        await page.keyboard.press('Escape');
        // eslint-disable-next-line no-await-in-loop
        await waitFor(
          async () =>
            (await page.locator('[data-testid="reference-image-figma-dialog"]').count()) ===
            0,
          { timeoutMs: 5000, label: `Escape at ${width}` },
        );
        // eslint-disable-next-line no-await-in-loop
        await assertActiveTestId(page, 'reference-image-figma-import');
      }
    } finally {
      await page.close().catch(() => {});
    }
  });
});
