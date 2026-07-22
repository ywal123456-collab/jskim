'use strict';

/**
 * Phase 7E-4B: Viewer revision history modal E2E (TEMP + jskim spec dev).
 */

const XSS_COMMIT_MESSAGE =
  '</script><script>window.__JSKIM_REVISION_XSS__=1</script>';
const XSS_FEATURE_NAME =
  '<img src=x onerror=window.__JSKIM_REVISION_XSS__=2>';
const XSS_ITEM_LABEL = '<svg onload=window.__JSKIM_REVISION_XSS__=3>';
const LONG_NO_SPACE = '\u3042'.repeat(120);
const LONG_JA_LABEL = '\u65e5\u672c\u8a9e\u306e\u9577\u3044\u6539\u8a02\u5c65\u6b74\u30e9\u30d9\u30eb\u8868\u793a\u78ba\u8a8d\u7528\u30c6\u30ad\u30b9\u30c8'.repeat(
  8
);
const LABEL_REVISION_HISTORY = '\u6539\u8a02\u5c65\u6b74';
const LABEL_AUTHOR = '\u5c71\u7530 \u592a\u90ce';
const MSG_INITIAL = '\u521d\u56de\u767b\u9332';
const MSG_UPDATE = '\u8aac\u660e\u3092\u66f4\u65b0';

const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const { createSpecDevRuntime } = require('../scripts/lib/create-spec-dev-runtime');
const { getFreePort } = require('./helpers/get-free-port');

const companionRequire = createRequire(
  path.resolve(__dirname, '..', 'jskim-screen-spec', 'package.json'),
);
const PLAYWRIGHT = companionRequire('playwright');

const REPO_ROOT = path.resolve(__dirname, '..');
const COMPANION_ENTRY = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js'
);

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('Version History Viewer E2E', () => {
  /** @type {Array<{ close: Function, cleanup: Function }>} */
  const sessions = [];
  /** @type {import('playwright').Browser|null} */
  let browser = null;
  /** @type {object|null} */
  let companion = null;

  before(async () => {
    companion = await import(pathToFileURL(COMPANION_ENTRY).href);
    browser = await PLAYWRIGHT.chromium.launch({ headless: true });
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
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
    }
  });

  async function prepareWorkspace() {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-vh-e2e-')
    );
    const pagesDir = path.join(workspaceRoot, 'src/sample/pages');
    await fsp.mkdir(pagesDir, { recursive: true });
    await fsp.mkdir(path.join(workspaceRoot, 'dist/sample'), {
      recursive: true,
    });
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
    await fsp.writeFile(
      path.join(pagesDir, 'index.html.njk'),
      '<!doctype html><html><body><h1>ok</h1></body></html>\n',
      'utf8'
    );
    await fsp.mkdir(path.join(workspaceRoot, 'src/sample/layouts'), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(workspaceRoot, 'src/sample/layouts/base.njk'),
      '{% block body %}{% endblock %}\n',
      'utf8'
    );

    writeJson(path.join(workspaceRoot, 'spec/sample/src/data/welcome.json'), {
      schemaVersion: '1.2',
      screen: {
        id: 'welcome',
        name: '\u3088\u3046\u3053\u305d',
        description: '\u6982\u8981',
      },
      itemOrder: ['title'],
      excludedItems: {},
      items: {
        title: {
          name: '\u30bf\u30a4\u30c8\u30eb',
          type: 'text',
          description: '\u898b\u51fa\u3057',
          note: '',
        },
      },
    });
    writeJson(path.join(workspaceRoot, 'spec/sample/src/features.json'), {
      schemaVersion: '1.0',
      features: [
        {
          featureId: 'main',
          name: '\u30e1\u30a4\u30f3\u6a5f\u80fd',
          displayOrder: 1,
          screenIds: ['welcome'],
        },
      ],
    });

    companion.initVersionRepository({
      rootDir: workspaceRoot,
      projectName: 'sample',
    });
    companion.persistVersionAuthorConfig({
      rootDir: workspaceRoot,
      projectName: 'sample',
      config: {
        schemaVersion: '1.0',
        user: { name: LABEL_AUTHOR, email: 'secret-author@example.com' },
      },
    });
    companion.stageProject({ rootDir: workspaceRoot, projectName: 'sample' });
    companion.commitVersion({
      rootDir: workspaceRoot,
      projectName: 'sample',
      message: MSG_INITIAL,
    });

    writeJson(path.join(workspaceRoot, 'spec/sample/src/data/welcome.json'), {
      schemaVersion: '1.2',
      screen: {
        id: 'welcome',
        name: '\u3088\u3046\u3053\u305d',
        description: '\u66f4\u65b0\u5f8c',
      },
      itemOrder: ['title'],
      excludedItems: {},
      items: {
        title: {
          name: '\u30bf\u30a4\u30c8\u30eb\u66f4\u65b0',
          type: 'text',
          description: '\u898b\u51fa\u3057\u66f4\u65b0',
          note: '',
        },
      },
    });
    companion.stageProject({ rootDir: workspaceRoot, projectName: 'sample' });
    companion.commitVersion({
      rootDir: workspaceRoot,
      projectName: 'sample',
      message: MSG_UPDATE,
    });

    writeJson(path.join(workspaceRoot, 'spec/sample/src/features.json'), {
      schemaVersion: '1.0',
      features: [
        {
          featureId: 'main',
          name: '\u30e1\u30a4\u30f3\u6a5f\u80fd',
          displayOrder: 1,
          screenIds: [],
        },
        {
          featureId: 'sub',
          name: '\u30b5\u30d6\u6a5f\u80fd',
          displayOrder: 2,
          screenIds: ['welcome'],
        },
      ],
    });
    companion.stageProject({ rootDir: workspaceRoot, projectName: 'sample' });
    companion.commitVersion({
      rootDir: workspaceRoot,
      projectName: 'sample',
      message: '\u6a5f\u80fd\u6240\u5c5e\u3092\u5909\u66f4',
    });

    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const hex = crypto.createHash('sha256').update(png).digest('hex');
    const refDir = path.join(
      workspaceRoot,
      'spec/sample/src/references/welcome/pc'
    );
    fs.mkdirSync(refDir, { recursive: true });
    fs.writeFileSync(path.join(refDir, `reference-${hex}.png`), png);
    writeJson(path.join(refDir, 'meta.json'), {
      schemaVersion: '1.0',
      screenId: 'welcome',
      viewport: { id: 'pc', width: 1, height: 1 },
      format: 'png',
      imageFile: `reference-${hex}.png`,
      imageRevision: `sha256:${hex}`,
      imageWidth: 1,
      imageHeight: 1,
      uploadedAt: '2026-07-20T01:02:03.000Z',
      source: {
        type: 'figma',
        fileKey: 'SECRET_FILE_KEY',
        nodeId: '1:3',
        frameName: 'HomeFrame',
        importedAt: '2026-07-20T01:02:03.000Z',
        exportScale: 1,
      },
    });
    companion.stageProject({ rootDir: workspaceRoot, projectName: 'sample' });
    companion.commitVersion({
      rootDir: workspaceRoot,
      projectName: 'sample',
      message: '\u53c2\u7167\u753b\u50cf\u3092\u8ffd\u52a0',
    });

    writeJson(path.join(workspaceRoot, 'spec/sample/src/data/welcome.json'), {
      schemaVersion: '1.2',
      screen: { id: 'welcome', name: 'welcome', description: 'XSS check' },
      itemOrder: ['title', 'xss'],
      excludedItems: {},
      items: {
        title: {
          name: XSS_ITEM_LABEL,
          type: 'text',
          description: LONG_NO_SPACE,
          note: '',
        },
        xss: {
          name: LONG_JA_LABEL,
          type: 'text',
          description: 'desc',
          note: '',
        },
      },
    });
    writeJson(path.join(workspaceRoot, 'spec/sample/src/features.json'), {
      schemaVersion: '1.0',
      features: [
        {
          featureId: 'main',
          name: XSS_FEATURE_NAME,
          displayOrder: 1,
          screenIds: ['welcome'],
        },
      ],
    });
    companion.stageProject({ rootDir: workspaceRoot, projectName: 'sample' });
    companion.commitVersion({
      rootDir: workspaceRoot,
      projectName: 'sample',
      message: XSS_COMMIT_MESSAGE,
    });

    return workspaceRoot;
  }

  async function startSession(workspaceRoot) {
    const port = await getFreePort();
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
      collectFn: async () => ({ screens: 0, states: 0 }),
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
      getBrowserVersionStatus: companion.getBrowserVersionStatus,
      listBrowserVersionRevisions: companion.listBrowserVersionRevisions,
      getBrowserVersionRevisionDetail: companion.getBrowserVersionRevisionDetail,
      getBrowserVersionRevisionDiff: companion.getBrowserVersionRevisionDiff,
      listBrowserVersionFeatures: companion.listBrowserVersionFeatures,
      listBrowserVersionBranches: companion.listBrowserVersionBranches,
      listBrowserVersionTags: companion.listBrowserVersionTags,
      getScreenFeatureWorkingState: companion.getScreenFeatureWorkingState,
      createScreenFeature: companion.createScreenFeature,
      updateScreenFeature: companion.updateScreenFeature,
      deleteScreenFeature: companion.deleteScreenFeature,
      reorderScreenFeatures: companion.reorderScreenFeatures,
      moveScreenToFeature: companion.moveScreenToFeature,
      reorderFeatureScreens: companion.reorderFeatureScreens,
      moveFeatureDirection: companion.moveFeatureDirection,
      moveScreenFeatureDirection: companion.moveScreenFeatureDirection,
    });
    await runtime.start();
    await companion.buildScreenSpecViewer({
      rootDir: workspaceRoot,
      projectName: 'sample',
      base: '/spec/',
    });
    const entry = {
      close: async () => {
        await runtime.close();
      },
      cleanup: async () => {
        await fsp.rm(workspaceRoot, { recursive: true, force: true });
      },
      port,
      workspaceRoot,
    };
    sessions.push(entry);
    return entry;
  }

  it('revision history modal lifecycle and secret hiding', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startSession(workspaceRoot);
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`http://127.0.0.1:${session.port}/spec/screens/welcome`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForSelector('[data-testid="revision-history-open"]', {
        timeout: 20000,
      });
      const trigger = page.locator('[data-testid="revision-history-open"]');
      await trigger.click();
      await page.waitForSelector('[data-testid="revision-history-dialog"]');
      await page.waitForSelector('[data-testid="revision-history-body"]');

      const bodyText = await page.locator('body').innerText();
      assert.doesNotMatch(bodyText, /SECRET_FILE_KEY/);
      assert.doesNotMatch(bodyText, /secret-author@example\.com/);
      assert.doesNotMatch(bodyText, /nodeId/);
      assert.ok(bodyText.includes(MSG_UPDATE) || bodyText.includes(MSG_INITIAL));

      await page
        .locator('[data-testid="revision-history-scope-project"]')
        .click();
      await page.waitForTimeout(300);
      await page
        .locator('[data-testid="revision-history-scope-feature"]')
        .click();
      await page.waitForTimeout(300);

      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-testid="revision-history-dialog"]', {
        state: 'detached',
      });
      await page.waitForTimeout(100);
      const focused = await page.evaluate(() =>
        document.activeElement
          ? document.activeElement.getAttribute('data-testid')
          : null
      );
      assert.equal(focused, 'revision-history-open');

      for (const width of [1440, 1024, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await trigger.click();
        await page.waitForSelector('[data-testid="revision-history-dialog"]');
        const box = await page
          .locator(
            '[data-testid="revision-history-dialog"] .revision-history-dialog'
          )
          .boundingBox();
        assert.ok(box);
        assert.ok(box.x >= 0);
        assert.ok(box.width <= width);
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          return doc.scrollWidth > doc.clientWidth + 1;
        });
        assert.equal(overflow, false);
        await page.keyboard.press('Escape');
        await page.waitForSelector('[data-testid="revision-history-dialog"]', {
          state: 'detached',
        });
      }
    } finally {
      await context.close();
    }
  });

  async function assertRevisionDialogSafe(page, trigger, width) {
    await page.setViewportSize({ width, height: 900 });
    await trigger.click();
    await page.waitForSelector('[data-testid="revision-history-dialog"]');
    await page.waitForSelector('[data-testid="revision-history-body"]');

    const xssFlag = await page.evaluate(() => window.__JSKIM_REVISION_XSS__);
    assert.equal(xssFlag, undefined);

    const injection = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script')].filter((node) =>
        (node.textContent || '').includes('__JSKIM_REVISION_XSS__')
      );
      const imgs = [...document.querySelectorAll('img')].filter((node) =>
        node.getAttribute('onerror')?.includes('__JSKIM_REVISION_XSS__')
      );
      const svgs = [...document.querySelectorAll('svg')].filter((node) =>
        node.getAttribute('onload')?.includes('__JSKIM_REVISION_XSS__')
      );
      return {
        scripts: scripts.length,
        imgs: imgs.length,
        svgs: svgs.length,
      };
    });
    assert.equal(injection.scripts, 0);
    assert.equal(injection.imgs, 0);
    assert.equal(injection.svgs, 0);

    const dialogText = await page
      .locator('[data-testid="revision-history-dialog"]')
      .innerText();
    assert.ok(dialogText.includes(LABEL_REVISION_HISTORY));
    assert.ok(dialogText.includes(LABEL_AUTHOR));

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth > doc.clientWidth + 1;
    });
    assert.equal(overflow, false);

    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="revision-history-dialog"]', {
      state: 'detached',
    });
  }

  it('revision history modal does not execute DOM XSS payloads', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startSession(workspaceRoot);
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`http://127.0.0.1:${session.port}/spec/screens/welcome`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForSelector('[data-testid="revision-history-open"]', {
        timeout: 20000,
      });
      const trigger = page.locator('[data-testid="revision-history-open"]');

      await assertRevisionDialogSafe(page, trigger, 1440);
      await assertRevisionDialogSafe(page, trigger, 390);
    } finally {
      await context.close();
    }
  });
});
