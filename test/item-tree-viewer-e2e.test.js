'use strict';

/**
 * Phase 7F-1D-1: Viewer Item Tree 読み取り専用 UI E2E（TEMP workspace + spec dev）。
 */

const LABEL_ITEM_TREE = '\u9805\u76ee\u30c4\u30ea\u30fc';
const LABEL_RELOAD = '\u518d\u8aad\u307f\u8fbc\u307f';
const LABEL_GROUP_INFO = '\u30b0\u30eb\u30fc\u30d7\u60c5\u5831';
const NAME_SECTION = '\u5951\u7d04\u60c5\u5831';
const NAME_CARDS = '\u5951\u7d04\u30ab\u30fc\u30c9';
const NAME_ROOT_ITEM = 'Root Item';
const NAME_NESTED_ITEM = 'Nested Item';
const NAME_CARD_ITEM = 'Card Item';
const NAME_FLAT_A = 'Flat A';
const NAME_FLAT_B = 'Flat B';
const NAME_FLAT_C = 'Flat C';
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
const { getFreePort } = require('./helpers/get-free-port');

const requireFromHere = createRequire(__filename);
const PLAYWRIGHT = requireFromHere('playwright');

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

function emptyItem(name) {
  return { name, type: 'text', description: '', note: '' };
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
  const themeDir = path.join(workspaceRoot, 'spec/sample/src/theme');
  await fsp.mkdir(themeDir, { recursive: true });
  await fsp.writeFile(path.join(themeDir, 'preview.css'), '/* preview */\n', 'utf8');

  writeJson(path.join(dataDir, 'tree-nested.json'), {
    schemaVersion: '1.3',
    screen: {
      id: 'tree-nested',
      name: '\u30c4\u30ea\u30fc\u691c\u8a3c\uff08\u968e\u5c64\uff09',
      description: '',
    },
    rootNodes: [
      { type: 'group', id: 'section' },
      { type: 'item', id: 'item-root' },
    ],
    groups: [
      {
        groupId: 'section',
        name: NAME_SECTION,
        kind: 'SECTION',
        description: '\u30bb\u30af\u30b7\u30e7\u30f3\u8aac\u660e',
        children: [
          { type: 'group', id: 'cards' },
          { type: 'item', id: 'item-nested' },
        ],
      },
      {
        groupId: 'cards',
        name: NAME_CARDS,
        kind: 'CARD',
        description: '',
        children: [{ type: 'item', id: 'item-card' }],
      },
    ],
    items: {
      'item-root': emptyItem(NAME_ROOT_ITEM),
      'item-nested': emptyItem(NAME_NESTED_ITEM),
      'item-card': emptyItem(NAME_CARD_ITEM),
    },
    excludedItems: {},
  });

  writeJson(path.join(dataDir, 'tree-flat.json'), {
    schemaVersion: '1.2',
    screen: {
      id: 'tree-flat',
      name: '\u30c4\u30ea\u30fc\u691c\u8a3c\uff08\u5e73\u9762\uff09',
      description: '',
    },
    itemOrder: ['item-a', 'item-b', 'item-c'],
    excludedItems: {},
    items: {
      'item-a': emptyItem(NAME_FLAT_A),
      'item-b': emptyItem(NAME_FLAT_B),
      'item-c': emptyItem(NAME_FLAT_C),
    },
  });

  writeJson(path.join(workspaceRoot, 'spec/sample/src/features.json'), {
    schemaVersion: '1.0',
    features: [
      {
        featureId: 'main',
        name: '\u30e1\u30a4\u30f3',
        displayOrder: 1,
        screenIds: ['tree-nested', 'tree-flat'],
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

describe('Item Tree Viewer E2E', () => {
  /** @type {Array<{ close: Function, cleanup: Function, port: number }>} */
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
      readDescriptionTreeState: companion.readDescriptionTreeState,
      readDescriptionRevision: companion.readDescriptionRevision,
      createDescriptionGroup: companion.createDescriptionGroup,
      updateDescriptionGroup: companion.updateDescriptionGroup,
      moveDescriptionNode: companion.moveDescriptionNode,
      reorderDescriptionChildren: companion.reorderDescriptionChildren,
      deleteDescriptionGroup: companion.deleteDescriptionGroup,
      deleteDescriptionGroupSubtree: companion.deleteDescriptionGroupSubtree,
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
    };
    sessions.push(entry);
    return entry;
  }

  it(
    'nested tree: 表示・展開・選択・再読み込み・mutation 非呼び出し',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-item-tree-e2e-'),
      );
      await writeBaseWorkspace(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await startSession(workspaceRoot);
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();

      /** @type {Array<{ method: string, url: string }>} */
      const treeRequests = [];
      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('/_jskim/spec/description-tree/')) {
          treeRequests.push({ method: request.method(), url });
        }
      });

      try {
        await page.goto(`http://127.0.0.1:${session.port}/spec/screens/tree-nested`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForSelector('.item-tree-panel', { timeout: 30000 });
        const panelText = await page.locator('.item-tree-panel').innerText();
        assert.match(panelText, new RegExp(LABEL_ITEM_TREE));
        assert.match(panelText, new RegExp(NAME_SECTION));
        assert.match(panelText, /\u30bb\u30af\u30b7\u30e7\u30f3/);
        assert.match(panelText, new RegExp(NAME_ROOT_ITEM));
        assert.match(panelText, new RegExp(NAME_NESTED_ITEM));

        const cardsRow = page.locator('.item-tree__row', {
          has: page.locator('.item-tree__select', { hasText: NAME_CARDS }),
        });
        await cardsRow.locator('.item-tree__toggle').click();
        await page.waitForSelector('.item-tree__select', {
          hasText: NAME_CARD_ITEM,
          timeout: 10000,
        });

        await page.locator('.item-tree__select', { hasText: NAME_NESTED_ITEM }).click();
        await page.waitForSelector('#item-row-item-nested.is-selected', {
          timeout: 10000,
        });

        await page.locator('.item-tree__select', { hasText: NAME_SECTION }).click();
        await page.waitForSelector('[data-testid="group-info-panel"]', {
          timeout: 10000,
        });
        assert.match(
          await page.locator('[data-testid="group-info-panel"]').innerText(),
          new RegExp(LABEL_GROUP_INFO),
        );

        const beforeReloadGets = treeRequests.filter((entry) => entry.method === 'GET').length;
        const reloadResponse = page.waitForResponse(
          (response) =>
            response.url().includes('/_jskim/spec/description-tree/tree-nested') &&
            response.request().method() === 'GET',
        );
        await page.locator('.item-tree-panel__reload', { hasText: LABEL_RELOAD }).click();
        await reloadResponse;
        assert.ok(
          treeRequests.filter((entry) => entry.method === 'GET').length > beforeReloadGets,
        );
        await page.waitForSelector('[data-testid="group-info-panel"]', {
          timeout: 10000,
        });

        const mutation = treeRequests.find(
          (entry) =>
            entry.method !== 'GET' ||
            entry.url.includes('/groups') ||
            entry.url.includes('/nodes/move') ||
            entry.url.includes('/children/reorder') ||
            entry.url.includes('/delete'),
        );
        assert.equal(mutation, undefined);
      } finally {
        await context.close();
      }
    },
  );

  it(
    'flat v1.2: itemOrder 順と Screen 切替後の tree 分離',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-item-tree-flat-e2e-'),
      );
      await writeBaseWorkspace(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await startSession(workspaceRoot);
      const context = await browser.newContext({ viewport: { width: 420, height: 720 } });
      const page = await context.newPage();

      try {
        await page.goto(`http://127.0.0.1:${session.port}/spec/screens/tree-flat`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForSelector('.item-tree-panel', { timeout: 30000 });
        const labels = await page.locator('.item-tree__select .item-tree__label').allTextContents();
        assert.deepEqual(labels.slice(0, 3), [NAME_FLAT_A, NAME_FLAT_B, NAME_FLAT_C]);

        await page.goto(`http://127.0.0.1:${session.port}/spec/screens/tree-nested`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForSelector('.item-tree-panel', { timeout: 30000 });
        const nestedText = await page.locator('.item-tree-panel').innerText();
        assert.match(nestedText, new RegExp(NAME_SECTION));
        assert.doesNotMatch(nestedText, new RegExp(NAME_FLAT_A));
      } finally {
        await context.close();
      }
    },
  );
});
