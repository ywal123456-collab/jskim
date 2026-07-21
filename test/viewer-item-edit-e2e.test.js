'use strict';

/**
 * Phase 7F-1D-2: Viewer Item 編集 v1.3 接続 push 検証 E2E（TEMP workspace + spec dev）。
 */

const LABEL_SAVE_ITEM = '\u9805\u76ee\u3092\u4fdd\u5b58';
const LABEL_SAVE_SCREEN = '\u57fa\u672c\u60c5\u5831\u3092\u4fdd\u5b58';
const LABEL_RELOAD_LATEST = '\u6700\u65b0\u5185\u5bb9\u3092\u518d\u8aad\u307f\u8fbc\u307f';
const LABEL_RELOAD = '\u518d\u8aad\u307f\u8fbc\u307f';
const LABEL_ADD_ITEM = '\uff0b \u9805\u76ee\u3092\u8ffd\u52a0';
const MSG_CONFLICT =
  '\u4ed6\u306e\u64cd\u4f5c\u306b\u3088\u3063\u3066\u753b\u9762\u8a2d\u8a08\u66f8\u304c\u66f4\u65b0\u3055\u308c\u307e\u3057\u305f\u3002';
const MSG_RELOAD_FAILED =
  '\u4fdd\u5b58\u3055\u308c\u307e\u3057\u305f\u304c\u3001\u6700\u65b0\u5185\u5bb9\u3092\u518d\u8aad\u307f\u8fbc\u307f\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002';
const MSG_INITIAL = '\u521d\u56de\u767b\u9332';
const NAME_SECTION = '\u5951\u7d04\u60c5\u5831';
const NAME_CARDS = '\u5951\u7d04\u30ab\u30fc\u30c9';
const NAME_ROOT_ITEM = 'Root Item';
const NAME_NESTED_ITEM = 'Nested Item';
const NAME_CARD_ITEM = 'Card Item';
const NAME_MANUAL_IN_GROUP = '\u624b\u52d5\u30b0\u30eb\u30fc\u30d7\u5185';
const NAME_SCREEN_B = '\u753b\u9762 B';
const NAME_SCREEN_B_ITEM = 'B\u9805\u76ee';

const XSS_ITEM_NAME =
  '<img src=x onerror=window.__JSKIM_ITEM_EDIT_XSS__=1>';
const XSS_ITEM_DESC =
  '</script><script>window.__JSKIM_ITEM_EDIT_XSS__=2</script>';
const XSS_ITEM_NOTE = '<svg onload=window.__JSKIM_ITEM_EDIT_XSS__=3>';

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

/**
 * @param {string} workspaceRoot
 */
async function writeEditFixtures(workspaceRoot) {
  await writeBaseConfig(workspaceRoot);

  await writeLinkedScreen(workspaceRoot, 'edit-v12-flat', ['collected-title']);
  await writeLinkedScreen(workspaceRoot, 'edit-v13-nested', [
    'item-root',
    'item-nested',
  ]);

  const dataDir = path.join(workspaceRoot, 'spec/sample/src/data');

  writeJson(path.join(dataDir, 'edit-v12-flat.json'), {
    schemaVersion: '1.2',
    screen: {
      id: 'edit-v12-flat',
      name: 'v1.2 \u5e73\u9762\u7de8\u96c6',
      description: 'lazy migration \u691c\u8a3c',
    },
    itemOrder: ['collected-title', 'manual-only', 'xss-item'],
    excludedItems: {
      'excluded-restored': emptyItem('\u9664\u5916\u5fa9\u5143', {
        description: 'excluded',
      }),
    },
    items: {
      'collected-title': emptyItem('\u53ce\u96c6\u30bf\u30a4\u30c8\u30eb', {
        description: 'collected',
      }),
      'manual-only': emptyItem('\u624b\u52d5\u306e\u307f', {
        description: 'manual',
      }),
      'xss-item': emptyItem(XSS_ITEM_NAME, {
        description: XSS_ITEM_DESC,
        note: XSS_ITEM_NOTE,
      }),
    },
  });

  writeJson(path.join(dataDir, 'edit-v13-nested.json'), {
    schemaVersion: '1.3',
    screen: {
      id: 'edit-v13-nested',
      name: 'v1.3 \u968e\u5c64\u7de8\u96c6',
      description: 'nested lifecycle',
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
          { type: 'item', id: 'manual-in-group' },
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
      'item-card': emptyItem(NAME_CARD_ITEM, {
        description: XSS_ITEM_DESC,
        note: XSS_ITEM_NOTE,
      }),
      'manual-in-group': emptyItem(NAME_MANUAL_IN_GROUP),
    },
    excludedItems: {
      'excluded-nested': emptyItem('\u9664\u5916\u9805\u76ee', {
        description: 'excluded nested',
      }),
    },
  });

  writeJson(path.join(dataDir, 'edit-screen-b.json'), {
    schemaVersion: '1.2',
    screen: {
      id: 'edit-screen-b',
      name: NAME_SCREEN_B,
      description: 'stale switch',
    },
    itemOrder: ['b-item'],
    excludedItems: {},
    items: {
      'b-item': emptyItem(NAME_SCREEN_B_ITEM),
    },
  });

  writeJson(path.join(workspaceRoot, 'spec/sample/src/features.json'), {
    schemaVersion: '1.0',
    features: [
      {
        featureId: 'main',
        name: '\u30e1\u30a4\u30f3',
        displayOrder: 1,
        screenIds: ['edit-v12-flat', 'edit-v13-nested', 'edit-screen-b'],
      },
    ],
  });
}

/**
 * @param {object} companion
 * @param {string} workspaceRoot
 */
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

/**
 * @param {import('playwright').Page} page
 * @returns {Array<{ method: string, url: string, pathname: string }>}
 */
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
      // keep raw url
    }
    requests.push({
      method: request.method(),
      url,
      pathname,
    });
  });
  return requests;
}

/**
 * @param {Array<{ method: string, pathname: string }>} requests
 */
function legacyDescriptionPutCount(requests) {
  return requests.filter(
    (entry) =>
      entry.method === 'PUT' &&
      /^\/_jskim\/spec\/descriptions\/[^/]+$/.test(entry.pathname),
  ).length;
}

/**
 * @param {Array<{ method: string, pathname: string }>} requests
 */
function groupMutationCount(requests) {
  return requests.filter((entry) => {
    if (entry.method === 'GET') {
      return false;
    }
    if (!entry.pathname.includes('/description-tree/')) {
      return false;
    }
    return (
      /\/groups(\/|$)/.test(entry.pathname) ||
      /\/nodes\/move$/.test(entry.pathname)
    );
  }).length;
}

function isSuccessfulMutationStatus(status) {
  return status >= 200 && status < 300;
}

/**
 * @param {import('playwright').Page} page
 * @returns {Array<{ method: string, pathname: string, status: number|null }>}
 */
function attachRecentSpecResponses(page) {
  /** @type {Array<{ method: string, pathname: string, status: number|null }>} */
  const recent = [];
  page.on('response', (response) => {
    const url = response.url();
    if (!url.includes('/_jskim/spec/')) {
      return;
    }
    let pathname = url;
    try {
      pathname = new URL(url).pathname;
    } catch {
      // keep raw url
    }
    recent.push({
      method: response.request().method(),
      pathname,
      status: response.status(),
    });
    if (recent.length > 12) {
      recent.shift();
    }
  });
  return recent;
}

/**
 * @param {import('playwright').Page} page
 */
async function readEditorStepContext(page) {
  return page.evaluate(() => {
    const route = location.pathname;
    const selectedRow = document.querySelector('tr.is-selected code');
    const selectedItemId = selectedRow?.textContent?.trim() || null;
    const statusEl = document.querySelector('.spec-page__status');
    const status = statusEl?.getAttribute('data-status') || null;
    const statusText = statusEl?.textContent?.trim().slice(0, 160) || '';
    const banner = document.querySelector('.spec-page__banner');
    const bannerStatus = banner?.getAttribute('data-status') || null;
    const bannerText = banner?.textContent?.trim().slice(0, 160) || '';
    const dialogOpen = Boolean(
      document.querySelector('.create-screen-dialog[role="dialog"]'),
    );
    const dialogErrors = [...document.querySelectorAll('.create-screen-dialog [data-error]')]
      .map((node) => node.textContent?.trim())
      .filter(Boolean)
      .slice(0, 4);
    const mutationPending = [...document.querySelectorAll('.spec-page__edit-bar button')].some(
      (button) =>
        (button.textContent || '').includes('\u9805\u76ee\u3092\u4fdd\u5b58') &&
        button.disabled &&
        status === 'dirty',
    );
    return {
      route,
      selectedItemId,
      status,
      statusText,
      mutationPendingHint: mutationPending,
      dialogOpen,
      dialogErrors,
      bannerStatus,
      bannerText,
    };
  });
}

/**
 * @param {import('playwright').Page} page
 * @param {string} stepLabel
 * @param {Array<{ method: string, pathname: string, status: number|null }>} recentResponses
 * @param {unknown} err
 */
async function formatStepFailure(page, stepLabel, recentResponses, err) {
  const ctx = await readEditorStepContext(page).catch(() => ({}));
  const recent = recentResponses
    .slice(-6)
    .map((entry) => `${entry.method} ${entry.pathname} ${entry.status ?? ''}`)
    .join(' | ');
  const message = err instanceof Error ? err.message : String(err);
  return new Error(
    `${stepLabel}: ${message}\n` +
      `context=${JSON.stringify(ctx)}\n` +
      `recentDescriptionTreeResponses=${recent || '(none)'}`,
  );
}

/**
 * @param {import('playwright').Page} page
 * @param {string} stepLabel
 * @param {Array<{ method: string, pathname: string, status: number|null }>} recentResponses
 * @param {() => Promise<import('playwright').Response>} responsePromise
 * @param {() => Promise<unknown>} trigger
 */
async function runMutationStep(page, stepLabel, recentResponses, responsePromise, trigger) {
  try {
    const [response] = await Promise.all([responsePromise(), trigger()]);
    assert.ok(
      isSuccessfulMutationStatus(response.status()),
      `${stepLabel}: unexpected status ${response.status()}`,
    );
    await waitForEditorIdle(page);
    return response;
  } catch (err) {
    throw await formatStepFailure(page, stepLabel, recentResponses, err);
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} screenId
 * @param {string} suffix
 * @param {string} [method='POST']
 */
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

function isDescriptionTreeItemCreateResponse(response, screenId) {
  if (response.request().method() !== 'POST') {
    return false;
  }
  try {
    const pathname = new URL(response.url()).pathname;
    return pathname === `/_jskim/spec/description-tree/${encodeURIComponent(screenId)}/items`;
  } catch {
    return false;
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} screenId
 */
function waitForItemCreate(page, screenId) {
  return () =>
    page.waitForResponse(
      (response) =>
        isDescriptionTreeItemCreateResponse(response, screenId) &&
        isSuccessfulMutationStatus(response.status()),
    );
}

/**
 * @param {import('playwright').Page} page
 * @param {string} screenId
 */
function waitForScreenPatch(page, screenId) {
  return () =>
    page.waitForResponse((response) => {
      try {
        return (
          response.request().method() === 'PATCH' &&
          new URL(response.url()).pathname ===
            `/_jskim/spec/description-tree/${encodeURIComponent(screenId)}/screen` &&
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

/**
 * @param {Record<string, unknown>} doc
 * @returns {string[]}
 */
function rootItemIds(doc) {
  const rootNodes = /** @type {Array<{ type: string, id: string }>} */ (
    doc.rootNodes || []
  );
  return rootNodes.filter((node) => node.type === 'item').map((node) => node.id);
}

/**
 * @param {Record<string, unknown>} doc
 * @param {string} itemId
 * @returns {number}
 */
function countItemRefsInTree(doc, itemId) {
  /** @type {string[]} */
  const refs = [];
  /** @param {Array<{ type: string, id: string }>} nodes */
  function walk(nodes) {
    for (const node of nodes) {
      if (node.type === 'item') {
        refs.push(node.id);
        continue;
      }
      const groups = /** @type {Array<{ groupId: string, children: unknown[] }>} */ (
        doc.groups || []
      );
      const group = groups.find((entry) => entry.groupId === node.id);
      if (group && Array.isArray(group.children)) {
        walk(/** @type {Array<{ type: string, id: string }>} */ (group.children));
      }
    }
  }
  walk(/** @type {Array<{ type: string, id: string }>} */ (doc.rootNodes || []));
  return refs.filter((id) => id === itemId).length;
}

/**
 * @param {import('playwright').Page} page
 * @param {string} screenId
 * @param {string} itemId
 */
async function assertCollectedItemIdsInclude(page, screenId, itemId) {
  const collectedItemIds = await page.evaluate(async (sid) => {
    const response = await fetch(
      `/_jskim/spec/description-tree/${encodeURIComponent(sid)}`,
    );
    const payload = await response.json();
    return payload.collectedItemIds;
  }, screenId);
  assert.ok(
    Array.isArray(collectedItemIds) && collectedItemIds.includes(itemId),
    `collectedItemIds must include ${itemId}: ${JSON.stringify(collectedItemIds)}`,
  );
}

/**
 * @param {import('playwright').Page} page
 * @param {number} port
 * @param {string} screenId
 */
async function gotoScreen(page, port, screenId) {
  await page.goto(`http://127.0.0.1:${port}/spec/screens/${screenId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForSelector('.spec-page__workspace, .spec-page--empty', {
    timeout: 30000,
  });
}

/**
 * @param {import('playwright').Page} page
 */
async function assertDocumentNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    body: document.body.scrollWidth > document.body.clientWidth + 1,
  }));
  assert.equal(overflow.html, false, 'documentElement horizontal overflow');
  assert.equal(overflow.body, false, 'document.body horizontal overflow');
}

/**
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {{ allowInternalScroll?: boolean, requireVerticalViewportFit?: boolean }} [options]
 */
async function assertElementGeometry(page, selector, options = {}) {
  const { allowInternalScroll = false, requireVerticalViewportFit = false } =
    options;
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 15000 });
  await locator.evaluate((el) => {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  const metrics = await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    };
  });
  const viewport = page.viewportSize();
  assert.ok(viewport, `viewport missing for ${selector}`);
  assert.ok(metrics.left >= -1, `${selector} left overflow: ${metrics.left}`);
  assert.ok(
    metrics.right <= viewport.width + 1,
    `${selector} right overflow: ${metrics.right} > ${viewport.width}`,
  );
  if (requireVerticalViewportFit) {
    assert.ok(metrics.top >= -1, `${selector} top overflow: ${metrics.top}`);
    assert.ok(
      metrics.bottom <= viewport.height + 1,
      `${selector} bottom overflow: ${metrics.bottom} > ${viewport.height}`,
    );
  }
  if (!allowInternalScroll) {
    assert.ok(
      metrics.scrollWidth <= metrics.clientWidth + 2,
      `${selector} horizontal overflow: scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth}`,
    );
  }
}

/**
 * @param {import('playwright').Page} page
 */
async function assertDialogActionButtonsNoOverlap(page) {
  const overlap = await page.locator('.create-screen-dialog__actions button').evaluateAll(
    (buttons) => {
      const rects = buttons.map((button) => button.getBoundingClientRect());
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i];
          const b = rects[j];
          const separated =
            a.right <= b.left + 1 ||
            b.right <= a.left + 1 ||
            a.bottom <= b.top + 1 ||
            b.bottom <= a.top + 1;
          if (!separated) {
            return true;
          }
        }
      }
      return false;
    },
  );
  assert.equal(overlap, false, 'dialog action buttons overlap');
}

/**
 * @param {import('playwright').Page} page
 */
async function assertViewportNoHorizontalOverflow(page) {
  await assertDocumentNoHorizontalOverflow(page);
}

/**
 * @param {import('playwright').Page} page
 * @param {string} selector
 */
async function assertNoHorizontalOverflow(page, selector) {
  await assertElementGeometry(page, selector);
}

/**
 * @param {import('playwright').Page} page
 */
async function assertItemEditXssSafe(page) {
  const xssFlag = await page.evaluate(() => window.__JSKIM_ITEM_EDIT_XSS__);
  assert.equal(xssFlag, undefined);

  const injection = await page.evaluate(() => {
    const marker = '__JSKIM_ITEM_EDIT_XSS__';
    const scripts = [...document.querySelectorAll('script')].filter((node) =>
      (node.textContent || '').includes(marker),
    );
    const imgs = [...document.querySelectorAll('img')].filter((node) =>
      node.getAttribute('onerror')?.includes(marker),
    );
    const svgs = [...document.querySelectorAll('svg')].filter((node) =>
      node.getAttribute('onload')?.includes(marker),
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
}

/**
 * @param {object} deps
 * @param {object} deps.companion
 * @param {Array<{ close: Function, cleanup: Function, port: number }>} deps.sessions
 * @param {object} [options]
 * @param {boolean} [options.injectDescriptionEditing]
 */
async function startSession(deps, workspaceRoot, options = {}) {
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
    injectDescriptionEditing:
      options.injectDescriptionEditing === undefined
        ? true
        : options.injectDescriptionEditing,
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

describe('Viewer Item Edit E2E (Phase 7F-1D-2)', () => {
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

  /**
   * @param {string} workspaceRoot
   * @param {object} [options]
   */
  async function openSession(workspaceRoot, options = {}) {
    return startSession({ companion, sessions }, workspaceRoot, options);
  }

  it(
    'v1.2 lazy migration: PATCH item / legacy PUT なし / v1.3 永続化 / 再読込',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-item-edit-v12-e2e-'),
      );
      await writeEditFixtures(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await openSession(workspaceRoot);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      const requests = attachSpecRequestRecorder(page);
      const recentResponses = attachRecentSpecResponses(page);

      try {
        await gotoScreen(page, session.port, 'edit-v12-flat');
        await page.waitForSelector('.item-table', { timeout: 30000 });

        const row = page.locator('#item-row-collected-title');
        await row.click();
        const nameInput = row.locator('input[type="text"]').first();
        await nameInput.fill('\u6539\u540d\u5f8c\u30bf\u30a4\u30c8\u30eb');

        await runMutationStep(
          page,
          'patch collected-title',
          recentResponses,
          () =>
            page.waitForResponse(
              (response) =>
                response.request().method() === 'PATCH' &&
                response
                  .url()
                  .includes(
                    '/_jskim/spec/description-tree/edit-v12-flat/items/collected-title',
                  ) &&
                response.status() === 200,
            ),
          () => page.getByRole('button', { name: LABEL_SAVE_ITEM }).click(),
        );

        assert.equal(legacyDescriptionPutCount(requests), 0);
        assert.equal(groupMutationCount(requests), 0);

        const saved = JSON.parse(
          await fsp.readFile(dataPath(workspaceRoot, 'edit-v12-flat'), 'utf8'),
        );
        assert.equal(saved.schemaVersion, '1.3');
        assert.equal(saved.items['collected-title'].name, '\u6539\u540d\u5f8c\u30bf\u30a4\u30c8\u30eb');
        assert.ok(Array.isArray(saved.rootNodes));

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.item-table', { timeout: 30000 });
        const reloadedText = await page.locator('#item-row-collected-title').innerText();
        assert.match(reloadedText, /\u6539\u540d\u5f8c\u30bf\u30a4\u30c8\u30eb/);
      } finally {
        await context.close();
      }
    },
  );

  it(
    'v1.3 nested lifecycle: metadata / create / duplicate / reorder / delete / exclude / restore',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-item-edit-v13-e2e-'),
      );
      await writeEditFixtures(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await openSession(workspaceRoot);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      const page = await context.newPage();
      const requests = attachSpecRequestRecorder(page);
      const recentResponses = attachRecentSpecResponses(page);

      try {
        await gotoScreen(page, session.port, 'edit-v13-nested');
        await page.waitForSelector('.item-tree-panel', { timeout: 30000 });
        await page.waitForSelector('#section-basic .spec-field input[type="text"]', {
          timeout: 45000,
        });

        await page.locator('#section-basic .spec-field input[type="text"]').fill(
          'v1.3 \u66f4\u65b0\u540d',
        );
        await page.locator('#section-basic .spec-field textarea').fill(
          '\u8aac\u660e\u3092\u66f4\u65b0',
        );
        await runMutationStep(
          page,
          'patch screen metadata',
          recentResponses,
          waitForScreenPatch(page, 'edit-v13-nested'),
          () => page.getByRole('button', { name: LABEL_SAVE_SCREEN }).click(),
        );

        let saved = JSON.parse(
          await fsp.readFile(dataPath(workspaceRoot, 'edit-v13-nested'), 'utf8'),
        );
        assert.equal(saved.screen.name, 'v1.3 \u66f4\u65b0\u540d');
        assert.equal(saved.screen.description, '\u8aac\u660e\u3092\u66f4\u65b0');

        await page.getByRole('button', { name: LABEL_ADD_ITEM }).click();
        await page.waitForSelector('[data-field="item-id"]');
        await page.locator('[data-field="item-id"]').fill('created-item');
        await page.locator('[data-field="item-name"]').fill('\u65b0\u898f\u9805\u76ee');
        await page.locator('[data-field="item-type"]').fill('button');
        await runMutationStep(
          page,
          'create created-item',
          recentResponses,
          waitForItemCreate(page, 'edit-v13-nested'),
          () =>
            page
              .locator('.create-screen-dialog form')
              .getByRole('button', { name: '\u8ffd\u52a0' })
              .click(),
        );
        await page.waitForSelector('#item-row-created-item', { timeout: 15000 });
        await page.locator('#item-row-created-item').click();
        await waitForEditorIdle(page);

        saved = JSON.parse(
          await fsp.readFile(dataPath(workspaceRoot, 'edit-v13-nested'), 'utf8'),
        );
        assert.ok(saved.items['created-item']);
        const rootIdsBeforeDuplicate = rootItemIds(saved);
        const sourceIndex = rootIdsBeforeDuplicate.indexOf('created-item');
        assert.ok(sourceIndex >= 0, 'created-item missing from rootNodes before duplicate');

        const createdRow = page.locator('#item-row-created-item');
        await createdRow.getByRole('button', { name: '\u8907\u88fd' }).click();
        const duplicateDialog = page.getByRole('dialog', {
          name: '\u9805\u76ee\u3092\u8907\u88fd',
        });
        await duplicateDialog.waitFor({ state: 'visible' });
        const duplicateIdField = duplicateDialog.locator('[data-field="item-id"]');
        await duplicateIdField.fill('created-item-copy');
        const duplicateSubmit = duplicateDialog.getByRole('button', {
          name: '\u8907\u88fd',
        });
        await duplicateSubmit.waitFor({ state: 'visible' });
        await runMutationStep(
          page,
          'duplicate created-item',
          recentResponses,
          waitForItemCreate(page, 'edit-v13-nested'),
          () => duplicateSubmit.click(),
        );
        await duplicateDialog.waitFor({ state: 'hidden', timeout: 15000 });
        saved = JSON.parse(
          await fsp.readFile(dataPath(workspaceRoot, 'edit-v13-nested'), 'utf8'),
        );
        assert.ok(saved.items['created-item-copy']);
        assert.equal(countItemRefsInTree(saved, 'created-item-copy'), 1);
        assert.equal(countItemRefsInTree(saved, 'created-item'), 1);
        const rootIdsAfterDuplicate = rootItemIds(saved);
        assert.equal(
          rootIdsAfterDuplicate.indexOf('created-item-copy'),
          sourceIndex + 1,
          'duplicate must follow source at root tail',
        );
        assert.deepEqual(
          rootIdsAfterDuplicate.slice(0, sourceIndex + 1),
          rootIdsBeforeDuplicate.slice(0, sourceIndex + 1),
        );

        const rootIdsBeforeReorder = rootIdsAfterDuplicate;
        await runMutationStep(
          page,
          'reorder created-item down',
          recentResponses,
          waitForDescriptionTreeMutation(
            page,
            'edit-v13-nested',
            '/children/reorder',
          ),
          () =>
            page
              .locator('#item-row-created-item')
              .getByRole('button', { name: '\u4e0b\u3078' })
              .click(),
        );
        saved = JSON.parse(
          await fsp.readFile(dataPath(workspaceRoot, 'edit-v13-nested'), 'utf8'),
        );
        const rootIdsAfterReorder = rootItemIds(saved);
        const reorderIndex = rootIdsBeforeReorder.indexOf('created-item');
        assert.ok(reorderIndex >= 0);
        assert.deepEqual(rootIdsAfterReorder, [
          ...rootIdsBeforeReorder.slice(0, reorderIndex),
          'created-item-copy',
          'created-item',
          ...rootIdsBeforeReorder.slice(reorderIndex + 2),
        ]);
        await waitForEditorIdle(page);

        const manualRow = page.locator('#item-row-manual-in-group');
        await manualRow.getByRole('button', { name: '\u524a\u9664' }).click();
        const deleteDialog = page.getByRole('dialog', {
          name: '\u9805\u76ee\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f',
        });
        await deleteDialog.waitFor({ state: 'visible' });
        await runMutationStep(
          page,
          'delete manual-in-group',
          recentResponses,
          waitForDescriptionTreeMutation(
            page,
            'edit-v13-nested',
            '/items/manual-in-group/delete',
          ),
          () => deleteDialog.locator('[data-action="confirm-delete"]').click(),
        );
        await deleteDialog.waitFor({ state: 'hidden', timeout: 15000 });
        await page.waitForSelector('#item-row-manual-in-group', { state: 'detached' });
        saved = JSON.parse(
          await fsp.readFile(dataPath(workspaceRoot, 'edit-v13-nested'), 'utf8'),
        );
        assert.equal(saved.items['manual-in-group'], undefined);

        await assertCollectedItemIdsInclude(page, 'edit-v13-nested', 'item-nested');
        const nestedRow = page.locator('#item-row-item-nested');
        await nestedRow.waitFor({ state: 'visible' });
        const excludeBtn = nestedRow.locator('[data-action="exclude-item"]');
        await excludeBtn.waitFor({ state: 'visible', timeout: 15000 });
        await excludeBtn.click();
        const excludeDialog = page.getByRole('dialog', {
          name: '\u9805\u76ee\u3092\u8a2d\u8a08\u5bfe\u8c61\u304b\u3089\u9664\u5916\u3057\u307e\u3059\u304b\uff1f',
        });
        await excludeDialog.waitFor({ state: 'visible' });
        await runMutationStep(
          page,
          'exclude item-nested',
          recentResponses,
          waitForDescriptionTreeMutation(
            page,
            'edit-v13-nested',
            '/items/item-nested/exclude',
          ),
          () => excludeDialog.locator('[data-action="confirm-exclude"]').click(),
        );
        await excludeDialog.waitFor({ state: 'hidden', timeout: 15000 });
        await page.waitForSelector('#item-row-item-nested', { state: 'detached' });
        saved = JSON.parse(
          await fsp.readFile(dataPath(workspaceRoot, 'edit-v13-nested'), 'utf8'),
        );
        assert.ok(saved.excludedItems['item-nested']);
        assert.equal(saved.items['item-nested'], undefined);
        assert.equal(countItemRefsInTree(saved, 'item-nested'), 0);

        await page.locator('.excluded-items-panel__toggle').click();
        await page.waitForSelector('#excluded-item-row-excluded-nested', {
          timeout: 15000,
        });
        const restoreBtn = page.locator('#excluded-item-row-excluded-nested button', {
          hasText: '\u8a2d\u8a08\u5bfe\u8c61\u306b\u623b\u3059',
        });
        await restoreBtn.waitFor({ state: 'visible' });
        await runMutationStep(
          page,
          'restore excluded-nested',
          recentResponses,
          waitForDescriptionTreeMutation(
            page,
            'edit-v13-nested',
            '/items/excluded-nested/restore',
          ),
          () => restoreBtn.click(),
        );
        await page.waitForSelector('#item-row-excluded-nested', { timeout: 15000 });
        saved = JSON.parse(
          await fsp.readFile(dataPath(workspaceRoot, 'edit-v13-nested'), 'utf8'),
        );
        assert.ok(saved.items['excluded-nested']);
        assert.equal(saved.excludedItems['excluded-nested'], undefined);
        const restoredRootIds = rootItemIds(saved);
        assert.equal(
          restoredRootIds[restoredRootIds.length - 1],
          'excluded-nested',
          'restored item must append to root tail',
        );

        await page.locator('#section-basic .spec-field textarea').fill(
          '\u6700\u7d42\u8aac\u660e',
        );
        const saveScreenBtn = page.getByRole('button', { name: LABEL_SAVE_SCREEN });
        await saveScreenBtn.waitFor({ state: 'visible' });
        assert.equal(await saveScreenBtn.isEnabled(), true);
        await runMutationStep(
          page,
          'patch final screen metadata',
          recentResponses,
          waitForScreenPatch(page, 'edit-v13-nested'),
          () => saveScreenBtn.click(),
        );
        saved = JSON.parse(
          await fsp.readFile(dataPath(workspaceRoot, 'edit-v13-nested'), 'utf8'),
        );
        assert.equal(saved.screen.description, '\u6700\u7d42\u8aac\u660e');
        assert.equal(legacyDescriptionPutCount(requests), 0);
        assert.equal(groupMutationCount(requests), 0);
      } finally {
        await context.close();
      }
    },
  );

  it(
    '409 conflict: stale draft / conflict banner / \u6700\u65b0\u5185\u5bb9\u3092\u518d\u8aad\u307f\u8fbc\u307f',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-item-edit-conflict-e2e-'),
      );
      await writeEditFixtures(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await openSession(workspaceRoot);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();

      try {
        await gotoScreen(page, session.port, 'edit-v12-flat');
        await page.waitForSelector('.item-table', { timeout: 30000 });

        const revision = await page.evaluate(async () => {
          const res = await fetch('/_jskim/spec/description-tree/edit-v12-flat');
          const data = await res.json();
          return data.revision;
        });

        const row = page.locator('#item-row-manual-only');
        await row.click();
        const draftName = '\u8349\u6848\u540d\u79f0';
        await row.locator('input[type="text"]').first().fill(draftName);

        await page.evaluate(
          async ({ rev }) => {
            await fetch('/_jskim/spec/description-tree/edit-v12-flat/items/manual-only', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                expectedRevision: rev,
                name: '\u30b5\u30fc\u30d0\u5074\u66f4\u65b0',
              }),
            });
          },
          { rev: revision },
        );

        await page.getByRole('button', { name: LABEL_SAVE_ITEM }).click();
        await page.waitForSelector('.spec-page__banner[data-status="conflict"]', {
          timeout: 30000,
        });
        const bannerText = await page.locator('.spec-page__banner').innerText();
        assert.match(bannerText, new RegExp(MSG_CONFLICT));
        assert.match(bannerText, new RegExp(LABEL_RELOAD_LATEST));

        const draftValue = await row.locator('input[type="text"]').first().inputValue();
        assert.equal(draftValue, draftName);

        await Promise.all([
          page.waitForResponse(
            (response) =>
              response.request().method() === 'GET' &&
              response.url().includes('/description-tree/edit-v12-flat') &&
              response.status() === 200,
          ),
          page.getByRole('button', { name: LABEL_RELOAD_LATEST }).click(),
        ]);
        await waitForEditorIdle(page);
        await page.waitForFunction(
          async (expectedName) => {
            const res = await fetch('/_jskim/spec/description-tree/edit-v12-flat');
            const payload = await res.json();
            return payload.description?.items?.['manual-only']?.name === expectedName;
          },
          '\u30b5\u30fc\u30d0\u5074\u66f4\u65b0',
          { timeout: 15000 },
        );

        const displayedName = await row.locator('input[type="text"]').first().inputValue();
        assert.equal(displayedName, '\u30b5\u30fc\u30d0\u5074\u66f4\u65b0');
      } finally {
        await context.close();
      }
    },
  );

  it(
    'Screen \u5207\u66ff stale: \u9045\u5ef6 PATCH \u4e2d\u306e\u5207\u66ff\u3067\u5148\u753b\u9762\u304c\u7834\u58ca\u3057\u306a\u3044',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-item-edit-switch-e2e-'),
      );
      await writeEditFixtures(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await openSession(workspaceRoot);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();

      /** @type {(() => void)|null} */
      let releasePatch = null;
      const patchGate = new Promise((resolve) => {
        releasePatch = resolve;
      });

      await page.route(
        '**/_jskim/spec/description-tree/edit-v12-flat/items/**',
        async (route) => {
          if (route.request().method() === 'PATCH') {
            await patchGate;
          }
          await route.continue();
        },
      );

      try {
        await gotoScreen(page, session.port, 'edit-v12-flat');
        await page.waitForSelector('.item-table', { timeout: 30000 });

        const row = page.locator('#item-row-manual-only');
        await row.click();
        await row.locator('input[type="text"]').first().fill('\u5207\u66ff\u4e2d\u8349\u6848');

        const saveClick = page.getByRole('button', { name: LABEL_SAVE_ITEM }).click();
        await page.waitForTimeout(200);

        await page.locator('.spec-sidebar__link', { hasText: NAME_SCREEN_B }).click();
        await page.waitForURL(/\/screens\/edit-screen-b(?:\?|$)/, {
          timeout: 30000,
        });
        await page.waitForSelector('#item-row-b-item', { timeout: 30000 });

        releasePatch();
        await saveClick;

        const bText = await page.locator('#item-row-b-item').innerText();
        assert.match(bText, new RegExp(NAME_SCREEN_B_ITEM));
        assert.doesNotMatch(bText, /\u5207\u66ff\u4e2d\u8349\u6848/);

        const bSaved = JSON.parse(
          await fsp.readFile(dataPath(workspaceRoot, 'edit-screen-b'), 'utf8'),
        );
        assert.equal(bSaved.items['b-item'].name, NAME_SCREEN_B_ITEM);
      } finally {
        await context.close();
      }
    },
  );

  it(
    'reload-failed: PATCH \u6210\u529f\u5f8c\u306e GET \u5931\u6557\u3067\u518d\u8aad\u307f\u8fbc\u307f\u6848\u5185',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-item-edit-reload-fail-e2e-'),
      );
      await writeEditFixtures(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await openSession(workspaceRoot);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();

      let abortNextTreeGet = false;
      await page.route('**/_jskim/spec/description-tree/**', async (route) => {
        const req = route.request();
        if (req.method() === 'GET' && abortNextTreeGet) {
          abortNextTreeGet = false;
          await route.abort('failed');
          return;
        }
        await route.continue();
      });

      try {
        await gotoScreen(page, session.port, 'edit-v12-flat');
        await page.waitForSelector('.item-table', { timeout: 30000 });

        const row = page.locator('#item-row-manual-only');
        await row.click();
        await row.locator('input[type="text"]').first().fill('\u518d\u8aad\u8fbc\u307f\u5931\u6557\u691c\u8a3c');

        abortNextTreeGet = true;
        await page.getByRole('button', { name: LABEL_SAVE_ITEM }).click();
        await page.waitForSelector('.spec-page__banner[data-status="reload-failed"]', {
          timeout: 30000,
        });
        const bannerText = await page.locator('.spec-page__banner').innerText();
        assert.match(bannerText, new RegExp(MSG_RELOAD_FAILED));

        const saved = JSON.parse(
          await fsp.readFile(dataPath(workspaceRoot, 'edit-v12-flat'), 'utf8'),
        );
        assert.equal(
          saved.items['manual-only'].name,
          '\u518d\u8aad\u8fbc\u307f\u5931\u6557\u691c\u8a3c',
        );

        const reloadResponse = page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' &&
            response.url().includes('/description-tree/edit-v12-flat') &&
            response.status() === 200,
        );
        await page
          .locator('.spec-page__banner[data-status="reload-failed"] button')
          .filter({ hasText: LABEL_RELOAD })
          .click();
        await reloadResponse;
      } finally {
        await context.close();
      }
    },
  );

  it(
    'XSS: item \u30d5\u30a3\u30fc\u30eb\u30c9 payload \u304c\u5b9f\u884c\u3055\u308c\u306a\u3044',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-item-edit-xss-e2e-'),
      );
      await writeEditFixtures(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await openSession(workspaceRoot);
      const context = await browser.newContext();
      const page = await context.newPage();

      try {
        /** @type {Error[]} */
        const pageErrors = [];
        page.on('pageerror', (error) => {
          pageErrors.push(error);
        });

        for (const width of [1440, 390]) {
          const height = width === 390 ? 844 : 900;
          await page.setViewportSize({ width, height });
          await gotoScreen(page, session.port, 'edit-v12-flat');
          await page.waitForSelector('#item-row-xss-item', { timeout: 30000 });
          await assertItemEditXssSafe(page);

          await gotoScreen(page, session.port, 'edit-v13-nested');
          await page.waitForSelector('.item-tree-panel', { timeout: 30000 });
          await assertItemEditXssSafe(page);
        }
        assert.equal(pageErrors.length, 0, `pageerror count=${pageErrors.length}`);
      } finally {
        await context.close();
      }
    },
  );

  it(
    '390x844 geometry: document / tree / table / editor / dialog \u306e\u914d\u7f6e\u5951\u7d04',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-item-edit-390-e2e-'),
      );
      await writeEditFixtures(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await openSession(workspaceRoot);
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();

      try {
        await gotoScreen(page, session.port, 'edit-v13-nested');
        await page.waitForSelector('.item-tree-panel', { timeout: 30000 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.locator('#item-row-item-nested').click();

        await assertDocumentNoHorizontalOverflow(page);
        await assertElementGeometry(page, '.item-tree-panel', {
          allowInternalScroll: true,
        });
        await assertElementGeometry(page, '.item-tree-panel__body', {
          allowInternalScroll: true,
        });
        await assertElementGeometry(page, '.spec-page__items-workspace');
        await assertElementGeometry(page, '.spec-page__items-detail');
        await assertElementGeometry(page, '.item-table-wrap', {
          allowInternalScroll: true,
        });
        await assertElementGeometry(page, '.spec-page__doc-pane');

        await page.getByRole('button', { name: LABEL_ADD_ITEM }).click();
        await page.waitForSelector('.create-screen-dialog');
        await assertElementGeometry(page, '.create-screen-dialog', {
          requireVerticalViewportFit: true,
        });
        await assertElementGeometry(page, '.create-screen-dialog__actions', {
          requireVerticalViewportFit: true,
        });
        await assertDialogActionButtonsNoOverlap(page);
        await page.keyboard.press('Escape');
      } finally {
        await context.close();
      }
    },
  );

  it(
    'static/read-only: \u7de8\u96c6 UI \u306a\u3057 / mutation POST\u30fbPATCH \u306a\u3057',
    { timeout: 300000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-item-edit-readonly-e2e-'),
      );
      await writeEditFixtures(workspaceRoot);
      await initVersionRepo(companion, workspaceRoot);
      const session = await openSession(workspaceRoot, {
        injectDescriptionEditing: false,
      });
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      const requests = attachSpecRequestRecorder(page);

      try {
        await gotoScreen(page, session.port, 'edit-v12-flat');
        await page.waitForSelector('.item-table', { timeout: 30000 });

        assert.equal(await page.getByRole('button', { name: LABEL_SAVE_ITEM }).count(), 0);
        assert.equal(await page.getByRole('button', { name: LABEL_SAVE_SCREEN }).count(), 0);
        assert.equal(await page.getByRole('button', { name: LABEL_ADD_ITEM }).count(), 0);

        const row = page.locator('#item-row-collected-title');
        assert.equal(await row.locator('input').count(), 0);

        const mutations = requests.filter(
          (entry) =>
            entry.method !== 'GET' &&
            !entry.url.includes('/_jskim/live-reload'),
        );
        assert.equal(mutations.length, 0);
      } finally {
        await context.close();
      }
    },
  );
});

module.exports = {
  writeEditFixtures,
  initVersionRepo,
  startSession,
  attachSpecRequestRecorder,
  legacyDescriptionPutCount,
  groupMutationCount,
};
