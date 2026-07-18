'use strict';

/**
 * Phase 7B-3B-3: same-port Viewer 削除 UI（random port spec dev + Playwright）
 */

const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
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
  'index.js'
);
const PLAYWRIGHT = require(path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'node_modules',
  'playwright'
));

async function writeDesc(filePath, screenId, name) {
  const doc = {
    schemaVersion: '1.2',
    screen: { id: screenId, name, description: `${name}の説明` },
    itemOrder: ['title'],
    excludedItems: {},
    items: {
      title: {
        name: 'タイトル',
        type: 'text',
        description: '',
        note: '',
      },
    },
  };
  await fsp.writeFile(filePath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

async function writeBaseConfig(workspaceRoot) {
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
}

describe('same-port Viewer 画面設計削除 UI', () => {
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
      await entry.close().catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await entry.cleanup().catch(() => {});
    }
  });

  async function startRuntime(workspaceRoot) {
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
      collectFn: async () => ({
        screens: 0,
        states: 0,
        updated: 0,
        unchanged: 0,
      }),
      buildFn: async () => {
        await companion.buildScreenSpecViewerAtomic({
          rootDir: workspaceRoot,
          projectName: 'sample',
        });
      },
      classifyPath: companion.classifyScreenSpecWatchPath,
      mergeKinds: companion.mergeScreenSpecWatchKinds,
      createFileDescriptionStore: companion.createFileDescriptionStore,
      loadScreenSpecProject: companion.loadScreenSpecProject,
      withDescriptionScreenLock: companion.withDescriptionScreenLock,
    });
    await runtime.start();
    sessions.push({
      close: () => runtime.close(),
      cleanup: () => fsp.rm(workspaceRoot, { recursive: true, force: true }),
    });
    return { port, runtime };
  }

  it(
    'DESIGN_ONLY: 中間→次 / 最後→前 / 唯一→empty',
    { timeout: 240000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-del-ui-')
      );
      await writeBaseConfig(workspaceRoot);
      await fsp.mkdir(path.join(workspaceRoot, 'src', 'sample', 'pages'), {
        recursive: true,
      });
      const dataDir = path.join(workspaceRoot, 'spec', 'sample', 'src', 'data');
      await fsp.mkdir(dataDir, { recursive: true });
      await writeDesc(path.join(dataDir, 'screen-a.json'), 'screen-a', '画面A');
      await writeDesc(path.join(dataDir, 'screen-b.json'), 'screen-b', '画面B');
      await writeDesc(path.join(dataDir, 'screen-c.json'), 'screen-c', '画面C');
      await companion.buildScreenSpecViewerAtomic({
        rootDir: workspaceRoot,
        projectName: 'sample',
      });

      const { port } = await startRuntime(workspaceRoot);
      const page = await browser.newPage();

      await page.goto(`http://127.0.0.1:${port}/spec/screens/screen-b`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('[data-action="delete-screen"]', {
        timeout: 30000,
      });
      await page.click('[data-action="delete-screen"]');
      await page.waitForSelector('[data-action="confirm-delete-screen"]');
      assert.match(await page.textContent('body'), /画面設計を削除しますか？/);
      await page.click('[data-action="confirm-delete-screen"]');
      await page.waitForURL(/\/screens\/screen-c(?:\?|$)/, { timeout: 45000 });
      await page.waitForFunction(
        () => !document.body.innerText.includes('screen-b'),
        null,
        { timeout: 45000 }
      );

      await page.goto(`http://127.0.0.1:${port}/spec/screens/screen-c`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('[data-action="delete-screen"]', {
        timeout: 30000,
      });
      await page.click('[data-action="delete-screen"]');
      await page.click('[data-action="confirm-delete-screen"]');
      await page.waitForURL(/\/screens\/screen-a(?:\?|$)/, { timeout: 45000 });

      await page.goto(`http://127.0.0.1:${port}/spec/screens/screen-a`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('[data-action="delete-screen"]', {
        timeout: 30000,
      });
      await page.click('[data-action="delete-screen"]');
      await page.click('[data-action="confirm-delete-screen"]');
      await page.waitForURL(/\/screens\/_empty(?:\?|$)/, { timeout: 45000 });
      await page.waitForSelector('text=画面がまだありません');
      assert.match(await page.textContent('body'), /＋ 画面を作成/);
      assert.equal(await page.locator('[data-action="delete-screen"]').count(), 0);

      await page.close();
    }
  );

  it(
    'LINKED: 同じ route・実装のみ・Preview 維持・再 collect で再生成なし',
    { timeout: 240000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-del-linked-ui-')
      );
      await writeBaseConfig(workspaceRoot);
      const pagesDir = path.join(workspaceRoot, 'src', 'sample', 'pages');
      const dataDir = path.join(workspaceRoot, 'spec', 'sample', 'src', 'data');
      const snapDir = path.join(
        workspaceRoot,
        'spec',
        'sample',
        'src',
        'snapshots',
        'linked-ui'
      );
      await fsp.mkdir(pagesDir, { recursive: true });
      await fsp.mkdir(dataDir, { recursive: true });
      await fsp.mkdir(snapDir, { recursive: true });
      await fsp.writeFile(
        path.join(pagesDir, 'linked-ui.spec.json'),
        `${JSON.stringify(
          {
            schemaVersion: '1.0',
            screen: { id: 'linked-ui', path: '/' },
            states: [{ id: 'default', name: '初期' }],
            interactions: [],
          },
          null,
          2
        )}\n`
      );
      await fsp.writeFile(
        path.join(snapDir, 'default.html'),
        '<main data-jskim-spec-screen="linked-ui"><span data-jskim-spec-item="title">t</span></main>\n'
      );
      await fsp.writeFile(
        path.join(dataDir, 'linked-ui.json'),
        `${JSON.stringify(
          {
            schemaVersion: '1.2',
            screen: {
              id: 'linked-ui',
              name: '連携UI',
              description: '手動説明',
            },
            itemOrder: ['title', 'manual-only'],
            excludedItems: {
              old: {
                name: '旧',
                type: 'text',
                description: '除外',
                note: '',
              },
            },
            items: {
              title: {
                name: 'Title',
                type: 'text',
                description: '手動項目説明',
                note: '',
              },
              'manual-only': {
                name: '手動のみ',
                type: 'text',
                description: 'manual',
                note: '',
              },
            },
          },
          null,
          2
        )}\n`
      );

      await companion.buildScreenSpecViewerAtomic({
        rootDir: workspaceRoot,
        projectName: 'sample',
      });
      const { port } = await startRuntime(workspaceRoot);
      const page = await browser.newPage();

      await page.goto(`http://127.0.0.1:${port}/spec/screens/linked-ui`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('[data-action="delete-screen"]', {
        timeout: 30000,
      });
      await page.click('[data-action="delete-screen"]');
      await page.waitForSelector('[data-action="confirm-delete-screen"]');
      const dialogText = await page.textContent('body');
      assert.match(dialogText, /画面設計書のみ削除しますか？/);
      assert.match(
        dialogText,
        /実装画面やソースファイル、Previewは削除されません/
      );
      await page.click('[data-action="confirm-delete-screen"]');

      await page.waitForFunction(
        () =>
          document.body.innerText.includes('実装のみ') &&
          !document.querySelector('[data-action="delete-screen"]'),
        null,
        { timeout: 60000 }
      );
      assert.match(page.url(), /\/screens\/linked-ui/);
      assert.equal(await page.locator('[data-testid="no-preview"]').count(), 0);
      const body = await page.textContent('body');
      assert.doesNotMatch(body, /手動説明/);
      assert.doesNotMatch(body, /manual-only/);

      const loaded = companion.loadScreenSpecProject({
        rootDir: workspaceRoot,
        projectName: 'sample',
      });
      const screen = loaded.screens.find((s) => s.screenId === 'linked-ui');
      assert.equal(screen.status, 'implementation-only');

      const descPath = path.join(dataDir, 'linked-ui.json');
      const collectResult = companion.writeCollectedDescription({
        filePath: descPath,
        screenId: 'linked-ui',
        foundItemIds: ['title'],
      });
      assert.equal(collectResult.written, false);
      await assert.rejects(() => fsp.access(descPath));

      await page.close();
    }
  );
});
