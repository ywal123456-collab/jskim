'use strict';

/**
 * Phase 7G-4C: Group subtree 削除 Viewer Chromium E2E
 * （TEMP workspace + Companion spec dev + 実 HTTP / 実保存）。
 */

const LABEL_DELETE_GROUP = '\u30b0\u30eb\u30fc\u30d7\u3092\u524a\u9664';
const MSG_INITIAL = '\u521d\u56de\u767b\u9332';
const MSG_DELETED =
  '\u30b0\u30eb\u30fc\u30d7\u3092\u524a\u9664\u3057\u307e\u3057\u305f\u3002';
const NAME_PARENT = '\u89aa\u30b0\u30eb\u30fc\u30d7';
const NAME_DELETE_TARGET = '\u524a\u9664\u5bfe\u8c61';
const NAME_CHILD = '\u5b50\u30b0\u30eb\u30fc\u30d7';
const NAME_ITEM_A = 'Item A';
const NAME_ITEM_B = 'Item B';
const NAME_SURVIVING = '\u751f\u5b58\u9805\u76ee';
const NAME_COLLECTED_GROUP = 'Collected Group';
const NAME_COLLECTED_ITEM = 'Collected Item';
const NAME_MANUAL_ITEM = 'Manual Item';

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
/** 既存 Viewer E2E と同じ: companion node_modules/playwright（default cache） */
const PLAYWRIGHT = require(path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'node_modules',
  'playwright',
));

/** Bounding box 判定の subpixel 許容（px） */
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

/**
 * 判定可能な snapshot を書く。
 * snapshotItemIds=[] は存在する空 snapshot（collected 0・状態判定可能）。
 */
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

async function writeManualSubtreeFixtures(workspaceRoot) {
  await writeBaseConfig(workspaceRoot);
  // 空 snapshot = collected 判定可能かつ manual-only
  await writeLinkedScreen(workspaceRoot, 'subtree-manual', []);

  const dataDir = path.join(workspaceRoot, 'spec/sample/src/data');
  writeJson(path.join(dataDir, 'subtree-manual.json'), {
    schemaVersion: '1.3',
    screen: {
      id: 'subtree-manual',
      name: 'Subtree Manual',
      description: 'manual-only delete target',
    },
    rootNodes: [{ type: 'group', id: 'parent-section' }],
    groups: [
      {
        groupId: 'parent-section',
        name: NAME_PARENT,
        kind: 'SECTION',
        description: 'parent',
        children: [
          { type: 'group', id: 'delete-target' },
          { type: 'item', id: 'surviving-item' },
        ],
      },
      {
        groupId: 'delete-target',
        name: NAME_DELETE_TARGET,
        kind: 'CARD',
        description: 'to delete',
        children: [
          { type: 'item', id: 'item-a' },
          { type: 'group', id: 'child-group' },
        ],
      },
      {
        groupId: 'child-group',
        name: NAME_CHILD,
        kind: 'SECTION',
        description: 'nested',
        children: [{ type: 'item', id: 'item-b' }],
      },
    ],
    items: {
      'item-a': emptyItem(NAME_ITEM_A),
      'item-b': emptyItem(NAME_ITEM_B),
      'surviving-item': emptyItem(NAME_SURVIVING),
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
        screenIds: ['subtree-manual'],
      },
    ],
  });
}

async function writeCollectedSubtreeFixtures(workspaceRoot) {
  await writeBaseConfig(workspaceRoot);
  await writeLinkedScreen(workspaceRoot, 'subtree-collected', [
    'collected-item',
  ]);

  const dataDir = path.join(workspaceRoot, 'spec/sample/src/data');
  writeJson(path.join(dataDir, 'subtree-collected.json'), {
    schemaVersion: '1.3',
    screen: {
      id: 'subtree-collected',
      name: 'Subtree Collected',
      description: 'collected protection',
    },
    rootNodes: [{ type: 'group', id: 'collected-group' }],
    groups: [
      {
        groupId: 'collected-group',
        name: NAME_COLLECTED_GROUP,
        kind: 'SECTION',
        description: '',
        children: [
          { type: 'item', id: 'manual-item' },
          { type: 'item', id: 'collected-item' },
        ],
      },
    ],
    items: {
      'manual-item': emptyItem(NAME_MANUAL_ITEM),
      'collected-item': emptyItem(NAME_COLLECTED_ITEM),
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
        screenIds: ['subtree-collected'],
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

function deleteSubtreePostCount(requests, screenId, groupId) {
  const expected = `/_jskim/spec/description-tree/${encodeURIComponent(screenId)}/groups/${encodeURIComponent(groupId)}/delete-subtree`;
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

async function selectTreeGroupByName(page, name) {
  const button = page.locator('.item-tree__select', { hasText: name }).first();
  await button.waitFor({ state: 'visible', timeout: 15000 });
  await button.click();
  await page.waitForSelector('[data-testid="group-info-panel"]', {
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

async function assertDialogInViewport(page) {
  const dialog = page.locator('[data-testid="group-delete-subtree-dialog"]');
  await dialog.waitFor({ state: 'visible', timeout: 15000 });
  const metrics = await dialog.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  });
  const viewport = page.viewportSize();
  assert.ok(viewport, 'viewport missing');
  assert.ok(
    metrics.left >= -GEOMETRY_EPS,
    `dialog left overflow: ${metrics.left}`,
  );
  assert.ok(
    metrics.right <= viewport.width + GEOMETRY_EPS,
    `dialog right overflow: ${metrics.right} > ${viewport.width}`,
  );
  return { metrics, viewport };
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

describe('Group subtree delete Viewer E2E (Phase 7G-4C)', () => {
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
    'A: manual-only nested subtree \u524a\u9664 / selection fallback / reload \u6c38\u7d9a\u5316',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-subtree-delete-manual-e2e-'),
      );
      await writeManualSubtreeFixtures(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await startSession({ companion, sessions }, workspaceRoot);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => {
        pageErrors.push(error);
      });
      const requests = attachSpecRequestRecorder(page);

      try {
        await gotoScreen(page, session.port, 'subtree-manual');
        await page.waitForSelector('.item-tree-panel', { timeout: 30000 });

        await selectTreeGroupByName(page, NAME_DELETE_TARGET);
        await page.locator('[data-testid="group-delete-subtree-open"]').click();
        await page.waitForSelector('[data-testid="group-delete-subtree-dialog"]', {
          timeout: 15000,
        });

        const dialog = page.locator('[data-testid="group-delete-subtree-dialog"]');
        assert.match(
          ((await dialog.getByRole('heading').textContent()) || '').trim(),
          /^\u30b0\u30eb\u30fc\u30d7\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f$/,
        );
        assert.match(await dialog.innerText(), new RegExp(NAME_DELETE_TARGET));
        assert.match(await dialog.innerText(), /delete-target/);
        assert.match(
          await page.locator('[data-testid="group-delete-subtree-descendant-count"]').innerText(),
          /1/,
        );
        assert.match(
          await page.locator('[data-testid="group-delete-subtree-item-count"]').innerText(),
          /2/,
        );
        assert.match(
          await page.locator('[data-testid="group-delete-subtree-warning"]').innerText(),
          /\u5143\u306b\u623b\u305b\u307e\u305b\u3093/,
        );

        const focusedIsCancel = await page.evaluate(() => {
          const cancel = document.querySelector(
            '[data-testid="group-delete-subtree-cancel"]',
          );
          return document.activeElement === cancel;
        });
        assert.equal(focusedIsCancel, true, 'cancel button should have initial focus');

        await runMutationStep(
          page,
          'delete-subtree',
          waitForDescriptionTreeMutation(
            page,
            'subtree-manual',
            '/groups/delete-target/delete-subtree',
          ),
          () =>
            page.locator('[data-testid="group-delete-subtree-confirm"]').click(),
        );

        await page.waitForSelector(
          '[data-testid="group-delete-subtree-dialog"]',
          { state: 'detached', timeout: 15000 },
        );
        await page.waitForFunction(
          (msg) => document.body.innerText.includes(msg),
          MSG_DELETED,
          { timeout: 15000 },
        );

        assert.equal(
          await page.locator('.item-tree__select', { hasText: NAME_DELETE_TARGET }).count(),
          0,
        );
        assert.equal(
          await page.locator('.item-tree__select', { hasText: NAME_CHILD }).count(),
          0,
        );
        assert.equal(
          await page.locator('.item-tree__select', { hasText: NAME_ITEM_A }).count(),
          0,
        );
        assert.equal(
          await page.locator('.item-tree__select', { hasText: NAME_ITEM_B }).count(),
          0,
        );
        assert.ok(
          await page.locator('.item-tree__select', { hasText: NAME_SURVIVING }).count(),
        );
        assert.match(
          await page.locator('[data-testid="group-info-panel"]').innerText(),
          new RegExp(NAME_PARENT),
        );

        assert.equal(
          deleteSubtreePostCount(requests, 'subtree-manual', 'delete-target'),
          1,
        );

        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('.item-tree-panel', { timeout: 30000 });
        assert.equal(
          await page.locator('.item-tree__select', { hasText: NAME_DELETE_TARGET }).count(),
          0,
        );
        assert.equal(
          await page.locator('.item-tree__select', { hasText: NAME_CHILD }).count(),
          0,
        );
        assert.ok(
          await page.locator('.item-tree__select', { hasText: NAME_SURVIVING }).count(),
        );
        assert.ok(
          await page.locator('.item-tree__select', { hasText: NAME_PARENT }).count(),
        );

        const saved = JSON.parse(
          fs.readFileSync(dataPath(workspaceRoot, 'subtree-manual'), 'utf8'),
        );
        assert.equal(saved.schemaVersion, '1.3');
        const groupIds = (saved.groups || []).map((group) => group.groupId);
        assert.ok(!groupIds.includes('delete-target'));
        assert.ok(!groupIds.includes('child-group'));
        assert.ok(groupIds.includes('parent-section'));
        assert.equal(saved.items['item-a'], undefined);
        assert.equal(saved.items['item-b'], undefined);
        assert.ok(saved.items['surviving-item']);
        assert.equal(pageErrors.length, 0, `pageerror count=${pageErrors.length}`);
      } finally {
        await context.close();
      }
    },
  );

  it(
    'B: collected Item \u542b\u3080 subtree \u306f Dialog \u958b\u304f\u304c\u524a\u9664\u4e0d\u53ef\u30fbPOST 0',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-subtree-delete-collected-e2e-'),
      );
      await writeCollectedSubtreeFixtures(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await startSession({ companion, sessions }, workspaceRoot);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => {
        pageErrors.push(error);
      });
      const requests = attachSpecRequestRecorder(page);

      const jsonPath = dataPath(workspaceRoot, 'subtree-collected');
      const beforeBytes = fs.readFileSync(jsonPath);

      try {
        await gotoScreen(page, session.port, 'subtree-collected');
        await page.waitForSelector('.item-tree-panel', { timeout: 30000 });

        const treeBefore = await page.evaluate(async () => {
          const response = await fetch(
            '/_jskim/spec/description-tree/subtree-collected',
          );
          return response.json();
        });
        const revisionBefore = treeBefore.revision;
        assert.ok(
          Array.isArray(treeBefore.collectedItemIds) &&
            treeBefore.collectedItemIds.includes('collected-item'),
        );

        await selectTreeGroupByName(page, NAME_COLLECTED_GROUP);
        await page.locator('[data-testid="group-delete-subtree-open"]').click();
        await page.waitForSelector('[data-testid="group-delete-subtree-dialog"]', {
          timeout: 15000,
        });

        const block = page.locator(
          '[data-testid="group-delete-subtree-collected-block"]',
        );
        await block.waitFor({ state: 'visible', timeout: 5000 });
        assert.equal(await block.getAttribute('role'), 'alert');
        assert.match(
          await block.innerText(),
          /\u5b9f\u88c5\u753b\u9762\u3068\u9023\u643a/,
        );

        const confirm = page.locator(
          '[data-testid="group-delete-subtree-confirm"]',
        );
        assert.equal(await confirm.isDisabled(), true);

        // disabled confirm は click しても mutation を起こさない
        await confirm.click({ force: false }).catch(() => undefined);
        assert.equal(
          deleteSubtreePostCount(requests, 'subtree-collected', 'collected-group'),
          0,
        );

        assert.ok(
          await page.locator('.item-tree__select', {
            hasText: NAME_COLLECTED_GROUP,
          }).count(),
        );
        assert.ok(
          await page.locator('.item-tree__select', {
            hasText: NAME_COLLECTED_ITEM,
          }).count(),
        );
        assert.ok(
          await page.locator('.item-tree__select', {
            hasText: NAME_MANUAL_ITEM,
          }).count(),
        );

        const treeAfter = await page.evaluate(async () => {
          const response = await fetch(
            '/_jskim/spec/description-tree/subtree-collected',
          );
          return response.json();
        });
        assert.equal(treeAfter.revision, revisionBefore);
        assert.equal(
          fs.readFileSync(jsonPath).equals(beforeBytes),
          true,
          'description bytes must be unchanged',
        );
        assert.equal(pageErrors.length, 0, `pageerror count=${pageErrors.length}`);
      } finally {
        await context.close();
      }
    },
  );

  it(
    'C: 390x844 Dialog smoke / Esc / focus / overflow',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-subtree-delete-390-e2e-'),
      );
      await writeManualSubtreeFixtures(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await startSession({ companion, sessions }, workspaceRoot);
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => {
        pageErrors.push(error);
      });

      try {
        await gotoScreen(page, session.port, 'subtree-manual');
        await page.waitForSelector('.item-tree-panel', { timeout: 30000 });
        await selectTreeGroupByName(page, NAME_DELETE_TARGET);
        await page.locator('[data-testid="group-delete-subtree-open"]').click();
        await page.waitForSelector('[data-testid="group-delete-subtree-dialog"]', {
          timeout: 15000,
        });

        const { metrics } = await assertDialogInViewport(page);
        await assertDocumentNoHorizontalOverflow(page);

        const dialogText = await page
          .locator('[data-testid="group-delete-subtree-dialog"]')
          .innerText();
        assert.match(dialogText, new RegExp(NAME_DELETE_TARGET));
        assert.match(dialogText, /delete-target/);
        assert.match(dialogText, /\u524a\u9664\u3055\u308c\u308b\u4e0b\u4f4d/);
        assert.match(dialogText, /\u5143\u306b\u623b\u305b\u307e\u305b\u3093/);

        const cancel = page.locator('[data-testid="group-delete-subtree-cancel"]');
        const confirm = page.locator(
          '[data-testid="group-delete-subtree-confirm"]',
        );
        await cancel.waitFor({ state: 'visible' });
        await confirm.waitFor({ state: 'visible' });
        assert.equal(await cancel.isEnabled(), true);
        assert.equal(await confirm.isEnabled(), true);

        // 長い内容でも Dialog 内部 scroll が可能（必要なら）
        if (metrics.scrollHeight > metrics.clientHeight + GEOMETRY_EPS) {
          const scrolled = await page
            .locator('[data-testid="group-delete-subtree-dialog"]')
            .evaluate((el) => {
              const before = el.scrollTop;
              el.scrollTop = Math.min(el.scrollHeight, before + 40);
              return el.scrollTop > before;
            });
          assert.equal(scrolled, true, 'dialog should allow internal scroll');
        }

        const focusedIsCancel = await page.evaluate(() => {
          const el = document.querySelector(
            '[data-testid="group-delete-subtree-cancel"]',
          );
          return document.activeElement === el;
        });
        assert.equal(focusedIsCancel, true);

        await page.keyboard.press('Escape');
        await page.waitForSelector(
          '[data-testid="group-delete-subtree-dialog"]',
          { state: 'detached', timeout: 15000 },
        );

        // smoke では削除しない
        assert.ok(
          await page.locator('.item-tree__select', {
            hasText: NAME_DELETE_TARGET,
          }).count(),
        );
        assert.equal(pageErrors.length, 0, `pageerror count=${pageErrors.length}`);
      } finally {
        await context.close();
      }
    },
  );
});
