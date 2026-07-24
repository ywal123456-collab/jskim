'use strict';

/**
 * Phase 7G-6A-2: Item/Group 移動 Viewer Chromium E2E
 * （TEMP workspace + Companion spec dev + 実 HTTP / 実保存）。
 */

const MSG_INITIAL = '\u521d\u56de\u767b\u9332';
const NAME_GROUP_A = 'Group A';
const NAME_GROUP_B = 'Group B';
const NAME_SURVIVING = 'Surviving Item';
const NAME_DEST_GROUP = 'Destination Group';
const NAME_COLLECTED = 'Collected Item';
const NAME_SIBLING = 'Sibling Item';

const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSpecDevRuntime } = require('../scripts/lib/create-spec-dev-runtime');
const { getFreePort } = require('./helpers/get-free-port');

const REPO_ROOT = path.resolve(__dirname, '..');
const COMPANION_ENTRY = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js',
);
const PLAYWRIGHT = require(path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'node_modules',
  'playwright',
));

const GEOMETRY_EPS = 1;

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function emptyItem(name, overrides = {}) {
  return { name, type: 'text', description: '', note: '', ...overrides };
}

function dataPath(workspaceRoot, screenId) {
  return path.join(
    workspaceRoot,
    'spec',
    'sample',
    'src',
    'data',
    `${screenId}.json`,
  );
}

async function writeBaseConfig(workspaceRoot) {
  const pagesDir = path.join(workspaceRoot, 'src/sample/pages');
  await fsp.mkdir(pagesDir, { recursive: true });
  await fsp.mkdir(path.join(workspaceRoot, 'dist/sample'), { recursive: true });
  await fsp.mkdir(path.join(workspaceRoot, 'spec/sample/src/theme'), {
    recursive: true,
  });
  await fsp.writeFile(
    path.join(workspaceRoot, 'spec/sample/src/theme/preview.css'),
    '/* preview */\n',
    'utf8',
  );
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
}

async function writeLinkedScreen(workspaceRoot, screenId, snapshotItemIds) {
  const pagesDir = path.join(workspaceRoot, 'src/sample/pages');
  const snapDir = path.join(
    workspaceRoot,
    'spec/sample/src/snapshots',
    screenId,
  );
  await fsp.mkdir(snapDir, { recursive: true });
  await fsp.writeFile(
    path.join(pagesDir, `${screenId}.spec.json`),
    `${JSON.stringify(
      {
        schemaVersion: '1.0',
        screen: { id: screenId, path: `/${screenId}.html` },
        states: [
          {
            id: 'default',
            name: '\u521d\u671f',
            viewer: { visible: true, order: 1 },
          },
        ],
        interactions: [],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  const itemSpans = snapshotItemIds
    .map((id) => `<span data-jskim-spec-item="${id}">${id}</span>`)
    .join('');
  await fsp.writeFile(
    path.join(snapDir, 'default.html'),
    `<main data-jskim-spec-screen="${screenId}">${itemSpans}</main>\n`,
    'utf8',
  );
}

async function writeMoveFixtures(workspaceRoot) {
  await writeBaseConfig(workspaceRoot);
  await writeLinkedScreen(workspaceRoot, 'move-reorder', []);
  await writeLinkedScreen(workspaceRoot, 'move-collected', ['collected-item']);

  const dataDir = path.join(workspaceRoot, 'spec/sample/src/data');
  writeJson(path.join(dataDir, 'move-reorder.json'), {
    schemaVersion: '1.3',
    screen: {
      id: 'move-reorder',
      name: 'Move Reorder',
      description: 'group reorder e2e',
    },
    rootNodes: [
      { type: 'group', id: 'group-a' },
      { type: 'group', id: 'group-b' },
      { type: 'item', id: 'surviving-item' },
    ],
    groups: [
      {
        groupId: 'group-a',
        name: NAME_GROUP_A,
        kind: 'SECTION',
        description: '',
        children: [],
      },
      {
        groupId: 'group-b',
        name: NAME_GROUP_B,
        kind: 'CARD',
        description: '',
        children: [],
      },
    ],
    items: {
      'surviving-item': emptyItem(NAME_SURVIVING),
    },
    excludedItems: {},
  });

  writeJson(path.join(dataDir, 'move-collected.json'), {
    schemaVersion: '1.3',
    screen: {
      id: 'move-collected',
      name: 'Move Collected',
      description: 'collected indent/outdent e2e',
    },
    rootNodes: [
      { type: 'group', id: 'dest-group' },
      { type: 'item', id: 'collected-item' },
      { type: 'item', id: 'sibling-item' },
    ],
    groups: [
      {
        groupId: 'dest-group',
        name: NAME_DEST_GROUP,
        kind: 'SECTION',
        description: '',
        children: [],
      },
    ],
    items: {
      'collected-item': emptyItem(NAME_COLLECTED),
      'sibling-item': emptyItem(NAME_SIBLING),
    },
    excludedItems: {},
  });

  writeJson(path.join(workspaceRoot, 'spec/sample/src/features.json'), {
    schemaVersion: '1.0',
    features: [
      {
        featureId: 'main',
        name: '\u30e1\u30a4\u30f3',
        displayOrder: 1,
        screenIds: ['move-reorder', 'move-collected'],
      },
    ],
  });
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

function attachSpecRequestRecorder(page) {
  /** @type {Array<{ method: string, url: string, pathname: string }>} */
  const requests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.includes('/_jskim/spec/')) {
      return;
    }
    let pathname = url;
    try {
      pathname = new URL(url).pathname;
    } catch {
      // keep raw
    }
    requests.push({
      method: request.method(),
      url,
      pathname,
    });
  });
  return requests;
}

function reorderPostCount(requests, screenId) {
  const expected = `/_jskim/spec/description-tree/${encodeURIComponent(screenId)}/children/reorder`;
  return requests.filter(
    (entry) => entry.method === 'POST' && entry.pathname === expected,
  ).length;
}

function movePostCount(requests, screenId) {
  const expected = `/_jskim/spec/description-tree/${encodeURIComponent(screenId)}/nodes/move`;
  return requests.filter(
    (entry) => entry.method === 'POST' && entry.pathname === expected,
  ).length;
}

function isSuccessfulMutationStatus(status) {
  return status >= 200 && status < 300;
}

function waitForDescriptionTreeMutation(page, screenId, suffix, method = 'POST') {
  const encoded = encodeURIComponent(screenId);
  const expected = `/_jskim/spec/description-tree/${encoded}${suffix}`;
  return () =>
    page.waitForResponse((response) => {
      try {
        return (
          response.request().method() === method &&
          new URL(response.url()).pathname === expected &&
          isSuccessfulMutationStatus(response.status())
        );
      } catch {
        return false;
      }
    });
}

async function waitForEditorIdle(page) {
  await page.waitForFunction(
    () => {
      const status = document.querySelector('.spec-page__status');
      if (!status) {
        return true;
      }
      const value = status.getAttribute('data-status');
      return value !== 'saving';
    },
    null,
    { timeout: 45000 },
  );
}

async function runMutationStep(page, stepLabel, responsePromise, trigger) {
  const [response] = await Promise.all([responsePromise(), trigger()]);
  assert.ok(
    isSuccessfulMutationStatus(response.status()),
    `${stepLabel}: unexpected status ${response.status()}`,
  );
  await waitForEditorIdle(page);
  return response;
}

async function gotoScreen(page, port, screenId) {
  await page.goto(`http://127.0.0.1:${port}/spec/screens/${screenId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForSelector('.spec-page__workspace, .spec-page--empty', {
    timeout: 30000,
  });
}

async function selectTreeNodeByName(page, name) {
  const button = page.locator('.item-tree__select', { hasText: name }).first();
  await button.waitFor({ state: 'visible', timeout: 15000 });
  await button.click();
  await page.waitForSelector('[data-testid="tree-node-move-controls"]', {
    timeout: 15000,
  });
}

async function assertDocumentNoHorizontalOverflow(page) {
  const overflow = await page.evaluate((eps) => ({
    html:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + eps,
    body: document.body.scrollWidth > document.body.clientWidth + eps,
  }), GEOMETRY_EPS);
  assert.equal(overflow.html, false, 'documentElement horizontal overflow');
  assert.equal(overflow.body, false, 'document.body horizontal overflow');
}

async function readRootOrder(workspaceRoot, screenId) {
  const raw = await fsp.readFile(dataPath(workspaceRoot, screenId), 'utf8');
  const doc = JSON.parse(raw);
  return doc.rootNodes.map((n) => `${n.type}:${n.id}`);
}

async function startSession(deps, workspaceRoot) {
  const { companion, sessions } = deps;
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
    skipMetadataWatch: true,
    injectSpecLiveReload: false,
    debounceMs: 80,
    log: false,
    initialDevLog: false,
    injectDescriptionEditing: true,
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
    readDescriptionTreeState: companion.readDescriptionTreeState,
    readDescriptionRevision: companion.readDescriptionRevision,
    createDescriptionGroup: companion.createDescriptionGroup,
    updateDescriptionGroup: companion.updateDescriptionGroup,
    moveDescriptionNode: companion.moveDescriptionNode,
    reorderDescriptionChildren: companion.reorderDescriptionChildren,
    deleteDescriptionGroup: companion.deleteDescriptionGroup,
    deleteDescriptionGroupSubtree: companion.deleteDescriptionGroupSubtree,
    createDescriptionItem: companion.createDescriptionItem,
    updateDescriptionItem: companion.updateDescriptionItem,
    deleteDescriptionItem: companion.deleteDescriptionItem,
    excludeDescriptionItem: companion.excludeDescriptionItem,
    restoreDescriptionItem: companion.restoreDescriptionItem,
    updateDescriptionScreen: companion.updateDescriptionScreen,
    collectCollectedItemIdsForScreen: companion.collectCollectedItemIdsForScreen,
    formatDescriptionTreeForApi: companion.formatDescriptionTreeForApi,
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

describe('Node move Viewer E2E (Phase 7G-6A-2)', () => {
  /** @type {Array<{ close: Function, cleanup: Function, port: number, workspaceRoot: string }>} */
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

  it(
    'A: Group reorder \u30dc\u30bf\u30f3 / selection \u7dad\u6301 / reload \u6c38\u7d9a\u5316',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-node-move-reorder-e2e-'),
      );
      await writeMoveFixtures(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await startSession({ companion, sessions }, workspaceRoot);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      page.on('pageerror', (error) => {
        pageErrors.push(error);
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });
      const requests = attachSpecRequestRecorder(page);

      try {
        await gotoScreen(page, session.port, 'move-reorder');
        await page.waitForSelector('.item-tree-panel', { timeout: 30000 });
        await selectTreeNodeByName(page, NAME_GROUP_B);

        await runMutationStep(
          page,
          'reorder-up',
          waitForDescriptionTreeMutation(
            page,
            'move-reorder',
            '/children/reorder',
          ),
          () => page.locator('[data-testid="tree-node-move-up"]').click(),
        );

        await page.waitForFunction(
          (name) => {
            const labels = [
              ...document.querySelectorAll('.item-tree__select'),
            ].map((el) => el.textContent || '');
            const b = labels.findIndex((t) => t.includes(name));
            const a = labels.findIndex((t) => t.includes('Group A'));
            return b >= 0 && a >= 0 && b < a;
          },
          NAME_GROUP_B,
          { timeout: 15000 },
        );

        assert.match(
          await page.locator('[data-testid="group-info-panel"]').innerText(),
          new RegExp(NAME_GROUP_B),
        );
        assert.equal(reorderPostCount(requests, 'move-reorder'), 1);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.item-tree-panel', { timeout: 30000 });
        await page.waitForFunction(
          (name) => {
            const labels = [
              ...document.querySelectorAll('.item-tree__select'),
            ].map((el) => el.textContent || '');
            const b = labels.findIndex((t) => t.includes(name));
            const a = labels.findIndex((t) => t.includes('Group A'));
            return b >= 0 && a >= 0 && b < a;
          },
          NAME_GROUP_B,
          { timeout: 15000 },
        );

        assert.deepEqual(await readRootOrder(workspaceRoot, 'move-reorder'), [
          'group:group-b',
          'group:group-a',
          'item:surviving-item',
        ]);
        assert.equal(pageErrors.length, 0, String(pageErrors[0]));
        assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
      } finally {
        await context.close().catch(() => {});
      }
    },
  );

  it(
    'B: Collected Item indent/outdent keyboard / input \u7121\u8996',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-node-move-collected-e2e-'),
      );
      await writeMoveFixtures(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await startSession({ companion, sessions }, workspaceRoot);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      page.on('pageerror', (error) => {
        pageErrors.push(error);
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });
      const requests = attachSpecRequestRecorder(page);

      try {
        await gotoScreen(page, session.port, 'move-collected');
        await page.waitForSelector('.item-tree-panel', { timeout: 30000 });
        await selectTreeNodeByName(page, NAME_COLLECTED);

        // input focus 中は移動しない
        await page.locator('.spec-field input').first().focus();
        const beforeInput = movePostCount(requests, 'move-collected');
        await page.keyboard.down('Alt');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.up('Alt');
        await page.waitForTimeout(300);
        assert.equal(
          movePostCount(requests, 'move-collected'),
          beforeInput,
          'input focus must block Alt+Arrow',
        );

        // tree 選択を戻して indent
        await selectTreeNodeByName(page, NAME_COLLECTED);
        await runMutationStep(
          page,
          'indent',
          waitForDescriptionTreeMutation(page, 'move-collected', '/nodes/move'),
          async () => {
            await page.keyboard.down('Alt');
            await page.keyboard.press('ArrowRight');
            await page.keyboard.up('Alt');
          },
        );

        await page.waitForFunction(
          () => {
            const panel = document.querySelector(
              '[data-testid="tree-node-move-controls"]',
            );
            const outdent = document.querySelector(
              '[data-testid="tree-node-move-outdent"]',
            );
            return (
              panel &&
              outdent &&
              !outdent.hasAttribute('disabled')
            );
          },
          null,
          { timeout: 15000 },
        );
        assert.match(
          await page.locator('.item-tree-panel').innerText(),
          new RegExp(NAME_COLLECTED),
        );

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.item-tree-panel', { timeout: 30000 });
        // Destination Group を展開して Collected を選択
        const destToggle = page
          .locator('.item-tree__row', { hasText: NAME_DEST_GROUP })
          .locator('.item-tree__toggle')
          .first();
        if ((await destToggle.getAttribute('aria-expanded')) === 'false') {
          await destToggle.click();
        }
        await selectTreeNodeByName(page, NAME_COLLECTED);

        await runMutationStep(
          page,
          'outdent',
          waitForDescriptionTreeMutation(page, 'move-collected', '/nodes/move'),
          async () => {
            await page.keyboard.down('Alt');
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.up('Alt');
          },
        );

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.item-tree-panel', { timeout: 30000 });

        assert.deepEqual(await readRootOrder(workspaceRoot, 'move-collected'), [
          'group:dest-group',
          'item:collected-item',
          'item:sibling-item',
        ]);
        assert.equal(movePostCount(requests, 'move-collected'), 2);
        assert.equal(pageErrors.length, 0, String(pageErrors[0]));
        assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
      } finally {
        await context.close().catch(() => {});
      }
    },
  );

  it(
    'C: 390\u00d7844 controls smoke',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-node-move-smoke-e2e-'),
      );
      await writeMoveFixtures(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await startSession({ companion, sessions }, workspaceRoot);
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      page.on('pageerror', (error) => {
        pageErrors.push(error);
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      try {
        await gotoScreen(page, session.port, 'move-reorder');
        await page.waitForSelector('.item-tree-panel', { timeout: 30000 });
        await selectTreeNodeByName(page, NAME_GROUP_B);

        const controls = page.locator('[data-testid="tree-node-move-controls"]');
        await controls.waitFor({ state: 'visible', timeout: 15000 });
        for (const testId of [
          'tree-node-move-up',
          'tree-node-move-down',
          'tree-node-move-indent',
          'tree-node-move-outdent',
        ]) {
          const btn = page.locator(`[data-testid="${testId}"]`);
          await btn.waitFor({ state: 'visible', timeout: 5000 });
          const box = await btn.boundingBox();
          assert.ok(box, `${testId} missing box`);
          assert.ok(box.x >= -GEOMETRY_EPS, `${testId} left overflow`);
          assert.ok(
            box.x + box.width <= 390 + GEOMETRY_EPS,
            `${testId} right overflow`,
          );
          assert.ok(await btn.getAttribute('aria-label'));
          assert.ok(await btn.getAttribute('title'));
        }

        await assertDocumentNoHorizontalOverflow(page);

        // disabled 識別: root 直下 Group は上位不可
        assert.equal(
          await page.locator('[data-testid="tree-node-move-outdent"]').isDisabled(),
          true,
        );
        assert.equal(
          await page.locator('[data-testid="tree-node-move-up"]').isDisabled(),
          false,
        );

        await runMutationStep(
          page,
          'smoke-up',
          waitForDescriptionTreeMutation(
            page,
            'move-reorder',
            '/children/reorder',
          ),
          () => page.locator('[data-testid="tree-node-move-up"]').click(),
        );

        const focusInside = await page.evaluate(() => {
          const root = document.querySelector(
            '[data-testid="tree-node-move-controls"]',
          );
          return Boolean(
            root &&
              document.activeElement &&
              root.contains(document.activeElement),
          );
        });
        assert.equal(focusInside, true, 'focus should stay in move controls');

        // Alt+Arrow shortcut
        await selectTreeNodeByName(page, NAME_GROUP_A);
        await runMutationStep(
          page,
          'smoke-keyboard-up',
          waitForDescriptionTreeMutation(
            page,
            'move-reorder',
            '/children/reorder',
          ),
          async () => {
            await page.keyboard.down('Alt');
            await page.keyboard.press('ArrowUp');
            await page.keyboard.up('Alt');
          },
        );

        // dialog open 中は shortcut 無視
        await selectTreeNodeByName(page, NAME_GROUP_A);
        await page.locator('[data-testid="group-edit-open"]').click();
        await page.waitForSelector('[data-testid="group-edit-dialog"]', {
          timeout: 15000,
        });

        const beforeDialog = await readRootOrder(workspaceRoot, 'move-reorder');
        await page.keyboard.down('Alt');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.up('Alt');
        await page.waitForTimeout(400);
        assert.deepEqual(
          await readRootOrder(workspaceRoot, 'move-reorder'),
          beforeDialog,
        );

        assert.equal(pageErrors.length, 0, String(pageErrors[0]));
        assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
      } finally {
        await context.close().catch(() => {});
      }
    },
  );
});
