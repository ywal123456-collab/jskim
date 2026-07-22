'use strict';

/**
 * Feature sidebar / management Viewer E2E（TEMP workspace + spec dev + static build）。
 */

const XSS_FEATURE_NAME =
  '<img src=x onerror=window.__JSKIM_FEATURE_XSS__=1>';
const LABEL_MANAGE_FEATURES = '\u6a5f\u80fd\u3092\u7ba1\u7406';
const LABEL_FEATURE_MANAGEMENT = '\u6a5f\u80fd\u7ba1\u7406';
const LABEL_ADD_FEATURE = '\u6a5f\u80fd\u3092\u8ffd\u52a0';
const LABEL_SUBMIT_ADD = '\u8ffd\u52a0';
const LABEL_UNGROUPED = '\u672a\u5206\u985e';
const LABEL_MOVE_DOWN = '\u4e0b\u3078';
const LABEL_DELETE = '\u524a\u9664';
const NAME_FEATURE_A = '\u6a5f\u80fdA';
const NAME_FEATURE_B = '\u6a5f\u80fdB';
const NAME_SCREEN_A = '\u753b\u9762A';
const NAME_SCREEN_B = '\u753b\u9762B';
const NAME_SCREEN_C = '\u753b\u9762C';
const MSG_INITIAL = '\u521d\u56de\u767b\u9332';

const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const { createSpecDevRuntime } = require('../scripts/lib/create-spec-dev-runtime');
const { createStaticServer } = require('../scripts/lib/create-static-server');
const { createSpecMount } = require('../scripts/lib/create-spec-mount');
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
  'index.js',
);

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeScreenDescription(dataDir, screenId, name) {
  writeJson(path.join(dataDir, `${screenId}.json`), {
    schemaVersion: '1.2',
    screen: { id: screenId, name, description: `${name}\u306e\u6982\u8981` },
    itemOrder: ['title'],
    excludedItems: {},
    items: {
      title: {
        name: '\u30bf\u30a4\u30c8\u30eb',
        type: 'text',
        description: '',
        note: '',
      },
    },
  });
}

async function writeBaseWorkspace(workspaceRoot) {
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
`,
    'utf8',
  );
  await fsp.writeFile(
    path.join(pagesDir, 'index.html.njk'),
    '<!doctype html><html><body><h1>ok</h1></body></html>\n',
    'utf8',
  );
  const dataDir = path.join(workspaceRoot, 'spec/sample/src/data');
  await fsp.mkdir(dataDir, { recursive: true });
  writeScreenDescription(dataDir, 'screen-a', NAME_SCREEN_A);
  writeScreenDescription(dataDir, 'screen-b', NAME_SCREEN_B);
  writeScreenDescription(dataDir, 'screen-c', NAME_SCREEN_C);
}

async function initVersionRepo(companion, workspaceRoot) {
  companion.initVersionRepository({
    rootDir: workspaceRoot,
    projectName: 'sample',
  });
  companion.persistVersionAuthorConfig({
    rootDir: workspaceRoot,
    projectName: 'sample',
    config: {
      schemaVersion: '1.0',
      user: { name: '\u5c71\u7530 \u592a\u90ce', email: 'author@example.com' },
    },
  });
  companion.stageProject({ rootDir: workspaceRoot, projectName: 'sample' });
  companion.commitVersion({
    rootDir: workspaceRoot,
    projectName: 'sample',
    message: MSG_INITIAL,
  });
}

describe('Feature Viewer E2E', () => {
  /** @type {Array<{ close: Function, cleanup: Function, port?: number, workspaceRoot?: string }>} */
  const sessions = [];
  /** @type {Array<{ stop: Function, cleanup: Function, port: number }>} */
  const staticServers = [];
  /** @type {import('playwright').Browser|null} */
  let browser = null;
  /** @type {object|null} */
  let companion = null;

  before(async () => {
    companion = await import(pathToFileURL(COMPANION_ENTRY).href);
    browser = await PLAYWRIGHT.chromium.launch({ headless: true });
  });

  after(async () => {
    for (const entry of staticServers) {
      // eslint-disable-next-line no-await-in-loop
      await entry.stop().catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await entry.cleanup().catch(() => {});
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

  async function startDevSession(workspaceRoot) {
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

  async function startStaticSession(workspaceRoot) {
    const port = await getFreePort();
    const specDistDir = path.join(workspaceRoot, 'spec/sample/dist');
    const specMount = createSpecMount({
      workspaceRoot,
      projectName: 'sample',
      specDistDir,
    });
    const server = createStaticServer({
      rootDir: path.join(workspaceRoot, 'dist/sample'),
      host: '127.0.0.1',
      port,
      projectName: 'sample',
      handleInternalRequest: specMount.handleRequest,
    });
    await server.start();
    const entry = {
      port,
      stop: () => server.stop(),
      cleanup: () => fsp.rm(workspaceRoot, { recursive: true, force: true }),
    };
    staticServers.push(entry);
    return entry;
  }

  async function openFeatureDialog(page, port) {
    await page.goto(`http://127.0.0.1:${port}/spec/screens/screen-a`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForSelector('.spec-sidebar', { timeout: 30000 });
    const manageBtn = page.locator('.spec-sidebar__manage-btn');
    await manageBtn.waitFor({ state: 'visible', timeout: 20000 });
    await manageBtn.click();
    await page.waitForSelector('.feature-management-dialog', { timeout: 20000 });
    const dialogText = await page.locator('.feature-management-dialog').innerText();
    assert.match(dialogText, new RegExp(LABEL_FEATURE_MANAGEMENT));
  }

  async function createFeature(page, featureId, name) {
    await page.locator('.feature-management-dialog__toolbar button', {
      hasText: LABEL_ADD_FEATURE,
    }).click();
    const form = page.locator('.feature-management-dialog__create');
    await form.locator('input').nth(0).fill(featureId);
    await form.locator('input').nth(1).fill(name);
    await form.locator('button[type="submit"]', { hasText: LABEL_SUBMIT_ADD }).click();
    await page.waitForFunction(
      (expected) =>
        [...document.querySelectorAll('.feature-management-dialog__feature-title strong')]
          .some((node) => node.textContent === expected),
      name,
      { timeout: 30000 },
    );
  }

  async function moveScreenToFeature(page, screenName, featureName) {
    const row = page.locator('.feature-management-dialog__screen-row', {
      has: page.locator('.feature-management-dialog__screen-name', { hasText: screenName }),
    });
    const select = row.locator('select');
    await select.selectOption({ label: featureName });
    await page.waitForTimeout(400);
  }

  async function waitForHierarchy(page) {
    await page.waitForSelector('.spec-sidebar__hierarchy', { timeout: 30000 });
    await page.waitForSelector('.spec-sidebar__feature-toggle', { timeout: 30000 });
  }

  it(
    'dev lifecycle: flat viewer → 機能管理 → create/move/reorder/delete → reload 永続化',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-feat-e2e-'),
      );
      await writeBaseWorkspace(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await startDevSession(workspaceRoot);
      const context = await browser.newContext();
      const page = await context.newPage();

      try {
        await page.goto(`http://127.0.0.1:${session.port}/spec/screens/screen-a`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForSelector('.spec-sidebar', { timeout: 30000 });
        assert.equal(await page.locator('.spec-sidebar__hierarchy').count(), 0);
        assert.equal(await page.locator('.spec-sidebar__list > li').count(), 3);
        assert.match(
          await page.locator('.spec-sidebar__manage-btn').innerText(),
          new RegExp(LABEL_MANAGE_FEATURES),
        );

        await openFeatureDialog(page, session.port);
        await createFeature(page, 'feature-a', NAME_FEATURE_A);
        await createFeature(page, 'feature-b', NAME_FEATURE_B);

        await moveScreenToFeature(page, NAME_SCREEN_A, NAME_FEATURE_A);
        await moveScreenToFeature(page, NAME_SCREEN_B, NAME_FEATURE_B);

        const featureAHead = page.locator('.feature-management-dialog__feature', {
          has: page.locator('strong', { hasText: NAME_FEATURE_A }),
        });
        await featureAHead
          .locator('.feature-management-dialog__feature-head .feature-management-dialog__actions button', {
            hasText: LABEL_MOVE_DOWN,
          })
          .click();
        await page.waitForTimeout(400);

        const featureBHead = page.locator('.feature-management-dialog__feature', {
          has: page.locator('strong', { hasText: NAME_FEATURE_B }),
        });
        await featureBHead
          .locator('.feature-management-dialog__feature-head .feature-management-dialog__actions button', {
            hasText: LABEL_DELETE,
          })
          .click();
        await page.locator('.spec-dialog--confirm button', { hasText: LABEL_DELETE }).click();
        await page.waitForFunction(
          (name) =>
            ![...document.querySelectorAll('.feature-management-dialog__feature-title strong')]
              .some((node) => node.textContent === name),
          NAME_FEATURE_B,
          { timeout: 30000 },
        );

        await page.locator('.spec-dialog__close', { hasText: '\u9589\u3058\u308b' }).click();
        await page.waitForSelector('.feature-management-dialog', { state: 'detached' });

        const featuresPath = path.join(workspaceRoot, 'spec/sample/src/features.json');
        await fsp.access(featuresPath);
        const featuresDoc = JSON.parse(await fsp.readFile(featuresPath, 'utf8'));
        assert.ok(Array.isArray(featuresDoc.features));
        assert.equal(featuresDoc.features.length, 1);
        assert.equal(featuresDoc.features[0].featureId, 'feature-a');

        await companion.buildScreenSpecViewer({
          rootDir: workspaceRoot,
          projectName: 'sample',
          base: '/spec/',
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForHierarchy(page);
        assert.match(await page.locator('.spec-sidebar').innerText(), new RegExp(NAME_FEATURE_A));
        assert.match(await page.locator('.spec-sidebar').innerText(), new RegExp(LABEL_UNGROUPED));
        assert.match(await page.locator('.spec-sidebar').innerText(), new RegExp(NAME_SCREEN_B));
        assert.match(await page.locator('.spec-sidebar').innerText(), new RegExp(NAME_SCREEN_C));

        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForHierarchy(page);
        assert.match(await page.locator('.spec-sidebar').innerText(), new RegExp(NAME_FEATURE_A));
        assert.doesNotMatch(
          await page.locator('.spec-sidebar').innerText(),
          new RegExp(NAME_FEATURE_B),
        );
        assert.match(await page.locator('.spec-sidebar').innerText(), new RegExp(NAME_SCREEN_B));

        const status = companion.getVersionStatus({
          rootDir: workspaceRoot,
          projectName: 'sample',
        });
        assert.equal(status.clean, false);
        assert.ok(
          status.unstagedChanges.some((change) => change.path === 'features.json'),
          'features.json が unstagedChanges に含まれること',
        );
      } finally {
        await context.close();
      }
    },
  );

  it(
    'static build: hierarchy 表示・機能を管理ボタンなし・XSS feature 名安全',
    { timeout: 240000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-feat-static-'),
      );
      await writeBaseWorkspace(workspaceRoot);
      writeJson(path.join(workspaceRoot, 'spec/sample/src/features.json'), {
        schemaVersion: '1.0',
        features: [
          {
            featureId: 'feature-a',
            name: NAME_FEATURE_A,
            displayOrder: 10,
            screenIds: ['screen-a'],
          },
          {
            featureId: 'feature-xss',
            name: XSS_FEATURE_NAME,
            displayOrder: 20,
            screenIds: ['screen-b'],
          },
        ],
      });
      await companion.buildScreenSpecViewerAtomic({
        rootDir: workspaceRoot,
        projectName: 'sample',
        base: '/spec/',
      });
      const staticSession = await startStaticSession(workspaceRoot);
      const context = await browser.newContext();
      const page = await context.newPage();

      try {
        await page.goto(`http://127.0.0.1:${staticSession.port}/spec/screens/screen-a`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await waitForHierarchy(page);
        assert.equal(await page.locator('.spec-sidebar__manage-btn').count(), 0);
        assert.match(await page.locator('.spec-sidebar').innerText(), new RegExp(NAME_FEATURE_A));

        const xssFlag = await page.evaluate(() => window.__JSKIM_FEATURE_XSS__);
        assert.equal(xssFlag, undefined);
        const injection = await page.evaluate(() => ({
          imgs: [...document.querySelectorAll('img')].filter((node) =>
            node.getAttribute('onerror')?.includes('__JSKIM_FEATURE_XSS__'),
          ).length,
        }));
        assert.equal(injection.imgs, 0);
        assert.doesNotMatch(
          await page.content(),
          /<img[^>]+onerror=/i,
        );
      } finally {
        await context.close();
      }
    },
  );

  it(
    'responsive: sidebar geometry at 1440/1024/768/390 viewports',
    { timeout: 240000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-feat-responsive-'),
      );
      await writeBaseWorkspace(workspaceRoot);
      writeJson(path.join(workspaceRoot, 'spec/sample/src/features.json'), {
        schemaVersion: '1.0',
        features: [
          {
            featureId: 'feature-a',
            name: NAME_FEATURE_A,
            displayOrder: 10,
            screenIds: ['screen-a', 'screen-b'],
          },
        ],
      });
      await companion.buildScreenSpecViewerAtomic({
        rootDir: workspaceRoot,
        projectName: 'sample',
        base: '/spec/',
      });
      const staticSession = await startStaticSession(workspaceRoot);
      const context = await browser.newContext();
      const page = await context.newPage();

      try {
        for (const width of [1440, 1024, 768, 390]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`http://127.0.0.1:${staticSession.port}/spec/screens/screen-a`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          await waitForHierarchy(page);
          const sidebar = page.locator('.spec-sidebar');
          const box = await sidebar.boundingBox();
          assert.ok(box, `viewport ${width}: sidebar bounding box`);
          assert.ok(box.x >= 0, `viewport ${width}: sidebar x`);
          assert.ok(box.width <= width, `viewport ${width}: sidebar width`);
          const overflow = await page.evaluate(() => {
            const doc = document.documentElement;
            return doc.scrollWidth > doc.clientWidth + 1;
          });
          assert.equal(overflow, false, `viewport ${width}: horizontal overflow`);
        }
      } finally {
        await context.close();
      }
    },
  );
});
