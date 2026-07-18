'use strict';

/**
 * Phase 7C-1A-3: same-port Viewer Live/PC/SP + 再収集 UX
 */

const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSpecDevRuntime } = require('../scripts/lib/create-spec-dev-runtime');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest, openSse } = require('./helpers/http-request');
const { waitFor } = require('./helpers/wait-for-output');
const {
  DEVICE_CAPTURE_COLLECT_PATH,
} = require('../scripts/lib/create-device-capture-api');

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

describe('Device Capture Viewer same-port integration', () => {
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

  async function prepareWorkspace() {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-dc-viewer-')
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
    await fsp.mkdir(path.join(workspaceRoot, 'spec/sample/src/captures'), {
      recursive: true,
    });
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
      collectFn: async () => {
        counters.collect += 1;
        return { screens: 1, states: 2, updated: 0, unchanged: 2 };
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
      collectDeviceCapture: companion.collectDeviceCapture,
      getDeviceCapturePublicInfo: companion.getDeviceCapturePublicInfo,
      ...extra,
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
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]),
      cleanup: () => fsp.rm(workspaceRoot, { recursive: true, force: true }),
    };
    sessions.push(entry);
    return entry;
  }

  it('Viewer PC/SP 再収集・unchanged・Description 削除後も Capture 維持', async () => {
    const workspaceRoot = await prepareWorkspace();
    const session = await startRuntime(workspaceRoot);
    const { port, counters } = session;
    const sse = await openSse({ port, timeoutMs: 10000 });
    const page = await browser.newPage();

    async function openScreen(provider) {
      await waitFor(() => counters.buildsInFlight === 0, {
        timeoutMs: 30000,
        label: 'builds idle before navigate',
      });
      let lastErr;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          // live-reload 中の abort を吸収
          // eslint-disable-next-line no-await-in-loop
          await page.goto(
            `http://127.0.0.1:${port}/spec/screens/device-capture-demo`,
            { waitUntil: 'domcontentloaded', timeout: 20000 }
          );
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
      await page.waitForSelector('[data-testid="preview-provider-tabs"]', {
        timeout: 20000,
      });
    }

    await openScreen('live');
    // Live/PC/SP/参照（参照内部 PC/SP は reference 選択時のみ追加）
    assert.equal(
      await page.locator('[data-testid="preview-provider-tabs"] [role="tab"]').count(),
      4
    );

    // PC 未収集 → 再収集
    await page.click('[data-provider="pc"]');
    await page.waitForSelector('[data-testid="device-capture-panel"]');
    assert.match(
      await page.locator('[data-testid="device-capture-status-label"]').innerText(),
      /未収集/
    );
    const buildBefore = counters.build;
    await page.click('[data-testid="device-capture-collect"]');
    await page.waitForSelector('[data-testid="device-capture-progress"]', {
      timeout: 5000,
    });
    await waitFor(
      () => counters.build >= buildBefore + 1 && counters.buildsInFlight === 0,
      { timeoutMs: 90000, label: 'PC capture build' }
    );
    await openScreen('pc');
    await page.waitForSelector('[data-testid="device-capture-panel"]');
    await waitFor(
      async () => {
        const text = await page
          .locator('[data-testid="device-capture-status-label"]')
          .innerText();
        return text.includes('最新');
      },
      { timeoutMs: 20000, label: 'PC current label' }
    );
    const pcImg = page.locator('[data-testid="device-capture-image"] img');
    await pcImg.waitFor({ state: 'visible', timeout: 10000 });
    const pcWidth = await pcImg.evaluate((el) => el.naturalWidth);
    assert.equal(pcWidth, 1440);

    // unchanged
    const buildMid = counters.build;
    await page.click('[data-testid="device-capture-collect"]');
    await waitFor(
      async () => {
        const info = page.locator('[data-testid="device-capture-info"]');
        return (await info.count()) > 0 && (await info.innerText()).includes('最新');
      },
      { timeoutMs: 60000, label: 'unchanged info' }
    );
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(counters.build, buildMid);

    // SP
    await page.click('[data-provider="sp"]');
    await page.waitForSelector('[data-viewport="sp"]');
    const buildSp = counters.build;
    await page.click('[data-testid="device-capture-collect"]');
    await waitFor(
      () => counters.build >= buildSp + 1 && counters.buildsInFlight === 0,
      { timeoutMs: 90000, label: 'SP capture build' }
    );
    await openScreen('sp');
    await page.waitForSelector('[data-viewport="sp"]');
    await waitFor(
      async () =>
        (await page.locator('[data-testid="device-capture-status-label"]').innerText()).includes(
          '最新'
        ),
      { timeoutMs: 20000, label: 'SP current' }
    );
    const spWidth = await page
      .locator('[data-testid="device-capture-image"] img')
      .evaluate((el) => el.naturalWidth);
    assert.equal(spWidth, 375);

    // PC 維持
    const screenJson = parseJson(
      await httpRequest({
        port,
        path: '/spec/data/screens/device-capture-demo.json',
      })
    );
    const st = screenJson.states.find((s) => s.id === 'default');
    assert.equal(st.deviceCaptures.pc.status, 'current');
    assert.equal(st.deviceCaptures.sp.status, 'current');

    // Description 削除 → IMPLEMENTATION_ONLY、Capture 維持
    const getDesc = await httpRequest({
      port,
      path: '/_jskim/spec/descriptions/device-capture-demo',
      headers: {
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      },
    });
    assert.equal(getDesc.status, 200);
    const rev = parseJson(getDesc).revision;
    const del = await httpRequest({
      port,
      method: 'DELETE',
      path: '/_jskim/spec/descriptions/device-capture-demo',
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      },
      body: JSON.stringify({ expectedRevision: rev }),
    });
    assert.equal(del.status, 200, del.body.toString('utf8'));
    await waitFor(
      () => counters.build >= buildSp + 2 && counters.buildsInFlight === 0,
      { timeoutMs: 30000, label: 'delete description build' }
    );

    await openScreen('pc');
    // Live/PC/SP/参照（参照内部 PC/SP は reference 選択時のみ追加）
    assert.equal(
      await page.locator('[data-testid="preview-provider-tabs"] [role="tab"]').count(),
      4
    );
    const statusBadge = await page.locator('.spec-page__status-badge').innerText();
    assert.match(statusBadge, /実装のみ/);
    await page.waitForSelector('[data-testid="device-capture-image"] img');
    const pcAfter = await httpRequest({
      port,
      path: `/spec/data/${st.deviceCaptures.pc.imagePath}`,
    });
    assert.equal(pcAfter.status, 200);

    // 再収集可能（Description 削除だけでは input 不変 → unchanged もあり得る）
    await page.click('[data-testid="device-capture-collect"]');
    await waitFor(
      async () => {
        const info = page.locator('[data-testid="device-capture-info"]');
        const progress = page.locator('[data-testid="device-capture-progress"]');
        if ((await info.count()) > 0) {
          const text = await info.innerText();
          if (text.includes('最新') || text.includes('更新')) {
            return true;
          }
        }
        // created/updated 後の reload 待ち中でもボタンが一度は反応している
        return (await progress.count()) > 0;
      },
      { timeoutMs: 90000, label: 'recollect after delete' }
    );

    // Description 再作成 → LINKED
    const create = await httpRequest({
      port,
      method: 'POST',
      path: '/_jskim/spec/descriptions',
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      },
      body: JSON.stringify({
        screenId: 'device-capture-demo',
        name: 'Device Capture Demo',
        description: 'restored',
      }),
    });
    assert.equal(create.status, 201, create.body.toString('utf8'));

    await page.close();
    sse.close();
  });

  it('read-only Viewer: タブと画像のみ（Capture API なし）', async () => {
    const workspaceRoot = await prepareWorkspace();
    // 先に Capture を作って静的 build
    const session = await startRuntime(workspaceRoot);
    const postPc = await httpRequest({
      port: session.port,
      method: 'POST',
      path: DEVICE_CAPTURE_COLLECT_PATH,
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${session.port}`,
        Host: `127.0.0.1:${session.port}`,
      },
      body: JSON.stringify({
        screenId: 'device-capture-demo',
        stateId: 'default',
        viewport: 'pc',
      }),
      timeoutMs: 60000,
    });
    assert.equal(postPc.status, 200);
    await waitFor(
      () => session.counters.build >= 1 && session.counters.buildsInFlight === 0,
      { timeoutMs: 60000, label: 'readonly prep build' }
    );
    await companion.buildScreenSpecViewer({
      rootDir: workspaceRoot,
      projectName: 'sample',
      base: '/spec/',
    });
    await session.close();
    sessions.pop();

    const { createStaticServer } = require('../scripts/lib/create-static-server');
    const port = await getFreePort();
    const server = createStaticServer({
      rootDir: path.join(workspaceRoot, 'spec/sample/dist'),
      host: '127.0.0.1',
      port,
    });
    await server.start();

    // 静的 Viewer 成果物契約（タブ UI は unit、ここは write API 非依存の build 出力）
    const screenPath = path.join(
      workspaceRoot,
      'spec/sample/dist/data/screens/device-capture-demo.json'
    );
    const screen = JSON.parse(await fsp.readFile(screenPath, 'utf8'));
    const state = screen.states.find((s) => s.id === 'default');
    assert.equal(state.deviceCaptures.pc.status, 'current');
    assert.ok(state.deviceCaptures.pc.imagePath);
    const imgPath = path.join(
      workspaceRoot,
      'spec/sample/dist/data',
      state.deviceCaptures.pc.imagePath
    );
    assert.ok(fs.existsSync(imgPath));
    const imgRes = await httpRequest({
      port,
      path: `/data/${state.deviceCaptures.pc.imagePath}`,
    });
    assert.equal(imgRes.status, 200);
    const collectMissing = await httpRequest({
      port,
      method: 'POST',
      path: DEVICE_CAPTURE_COLLECT_PATH,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        screenId: 'device-capture-demo',
        stateId: 'default',
        viewport: 'pc',
      }),
    });
    assert.notEqual(collectMissing.status, 200);

    await server.stop();
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
  });
});
