'use strict';

/**
 * Phase 7B-3B-2: Description DELETE API + watcher build-only 回数。
 */

const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSpecDevRuntime } = require('../scripts/lib/create-spec-dev-runtime');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest, openSse } = require('./helpers/http-request');
const { waitFor, sleep } = require('./helpers/wait-for-output');
const {
  DESCRIPTION_API_PREFIX,
} = require('../scripts/lib/create-description-edit-api');

const REPO_ROOT = path.resolve(__dirname, '..');
const COMPANION_ENTRY = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js'
);

describe('Description DELETE API: watcher 回数', () => {
  /** @type {Array<{ close: Function, cleanup: Function }>} */
  const sessions = [];
  /** @type {object|null} */
  let companion = null;

  before(async () => {
    companion = await import(pathToFileURL(COMPANION_ENTRY).href);
  });

  after(async () => {
    for (const entry of sessions) {
      // eslint-disable-next-line no-await-in-loop
      await entry.close().catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await entry.cleanup().catch(() => {});
    }
  });

  function countReloadTarget(sse, target) {
    return sse.typedEvents.filter((event) => {
      if (event.name !== 'reload') {
        return false;
      }
      try {
        const payload = JSON.parse(event.data);
        return (payload.target || 'all') === target;
      } catch {
        return false;
      }
    }).length;
  }

  async function writeViewerDist(specDistDir, marker) {
    await fsp.mkdir(specDistDir, { recursive: true });
    await fsp.writeFile(
      path.join(specDistDir, 'index.html'),
      `<!DOCTYPE html><html><body>${marker}</body></html>\n`,
      'utf8'
    );
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

  async function startRuntime(workspaceRoot) {
    const port = await getFreePort();
    const counters = { collect: 0, build: 0 };
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
        return { screens: 0, states: 0, updated: 0, unchanged: 0 };
      },
      buildFn: async () => {
        counters.build += 1;
        await writeViewerDist(
          path.join(workspaceRoot, 'spec', 'sample', 'dist'),
          `SPEC_V${counters.build}`
        );
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
    return { port, counters, runtime };
  }

  async function createDesignOnlyWorkspace() {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-del-design-')
    );
    await writeBaseConfig(workspaceRoot);
    await fsp.mkdir(path.join(workspaceRoot, 'src', 'sample', 'pages'), {
      recursive: true,
    });
    await fsp.mkdir(path.join(workspaceRoot, 'spec', 'sample', 'src', 'data'), {
      recursive: true,
    });
    await writeViewerDist(
      path.join(workspaceRoot, 'spec', 'sample', 'dist'),
      'SPEC_V0'
    );
    return workspaceRoot;
  }

  async function createLinkedWorkspace() {
    const workspaceRoot = await createDesignOnlyWorkspace();
    const pagesDir = path.join(workspaceRoot, 'src', 'sample', 'pages');
    const dataDir = path.join(workspaceRoot, 'spec', 'sample', 'src', 'data');
    const snapDir = path.join(
      workspaceRoot,
      'spec',
      'sample',
      'src',
      'snapshots',
      'linked-screen'
    );
    await fsp.mkdir(snapDir, { recursive: true });
    await fsp.writeFile(
      path.join(pagesDir, 'linked-screen.spec.json'),
      `${JSON.stringify(
        {
          schemaVersion: '1.0',
          screen: { id: 'linked-screen', path: '/' },
          states: [{ id: 'default', name: '初期' }],
          interactions: [],
        },
        null,
        2
      )}\n`
    );
    await fsp.writeFile(
      path.join(snapDir, 'default.html'),
      '<main data-jskim-spec-screen="linked-screen"><span data-jskim-spec-item="title">t</span></main>\n'
    );
    await fsp.writeFile(
      path.join(dataDir, 'linked-screen.json'),
      `${JSON.stringify(
        {
          schemaVersion: '1.2',
          screen: {
            id: 'linked-screen',
            name: '連携画面',
            description: '削除対象',
          },
          itemOrder: ['title'],
          excludedItems: {},
          items: {
            title: {
              name: 'Title',
              type: 'text',
              description: '説明',
              note: '',
            },
          },
        },
        null,
        2
      )}\n`
    );
    return workspaceRoot;
  }

  it(
    'DESIGN_ONLY DELETE: collect:0 build:1 reload(spec):1 / 一覧から消える',
    { timeout: 30000 },
    async () => {
      const workspaceRoot = await createDesignOnlyWorkspace();
      const { port, counters } = await startRuntime(workspaceRoot);
      const sse = await openSse({ port });
      await sleep(120);

      const headers = {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      };

      const post = await httpRequest({
        port,
        method: 'POST',
        path: DESCRIPTION_API_PREFIX,
        headers,
        body: JSON.stringify({
          screenId: 'to-delete',
          name: '削除対象',
          description: '',
        }),
      });
      assert.equal(post.status, 201);
      await waitFor(() => counters.build === 1, {
        timeoutMs: 10000,
        label: 'create build',
      });
      await sleep(350);

      const beforeBuild = counters.build;
      const beforeCollect = counters.collect;
      const beforeSpec = countReloadTarget(sse, 'spec');

      const getRes = await httpRequest({
        port,
        path: `${DESCRIPTION_API_PREFIX}/to-delete`,
      });
      assert.equal(getRes.status, 200);
      const getJson = JSON.parse(getRes.body.toString('utf8'));

      const del = await httpRequest({
        port,
        method: 'DELETE',
        path: `${DESCRIPTION_API_PREFIX}/to-delete`,
        headers,
        body: JSON.stringify({ expectedRevision: getJson.revision }),
      });
      assert.equal(del.status, 200);
      assert.deepEqual(JSON.parse(del.body.toString('utf8')), {
        screenId: 'to-delete',
        deleted: true,
      });

      const filePath = path.join(
        workspaceRoot,
        'spec',
        'sample',
        'src',
        'data',
        'to-delete.json'
      );
      await waitFor(
        async () => {
          try {
            await fsp.access(filePath);
            return false;
          } catch {
            return true;
          }
        },
        { timeoutMs: 5000, label: 'description removed' }
      );

      await waitFor(() => counters.build === beforeBuild + 1, {
        timeoutMs: 10000,
        label: 'delete build once',
      });
      await sleep(350);

      assert.equal(counters.collect, beforeCollect);
      assert.equal(counters.build, beforeBuild + 1);
      assert.equal(countReloadTarget(sse, 'spec'), beforeSpec + 1);

      const loaded = companion.loadScreenSpecProject({
        rootDir: workspaceRoot,
        projectName: 'sample',
      });
      assert.equal(
        loaded.screens.some((s) => s.screenId === 'to-delete'),
        false
      );

      const getAfter = await httpRequest({
        port,
        path: `${DESCRIPTION_API_PREFIX}/to-delete`,
      });
      assert.equal(getAfter.status, 404);

      const dup = await httpRequest({
        port,
        method: 'DELETE',
        path: `${DESCRIPTION_API_PREFIX}/to-delete`,
        headers,
        body: JSON.stringify({ expectedRevision: getJson.revision }),
      });
      assert.equal(dup.status, 404);
      await sleep(350);
      assert.equal(counters.build, beforeBuild + 1);
      assert.equal(counters.collect, beforeCollect);
      sse.close();
    }
  );

  it(
    'LINKED DELETE: IMPLEMENTATION_ONLY / source 維持 / collect:0 build:1',
    { timeout: 30000 },
    async () => {
      const workspaceRoot = await createLinkedWorkspace();
      const { port, counters } = await startRuntime(workspaceRoot);
      const sse = await openSse({ port });
      await sleep(120);

      const beforeSpec = countReloadTarget(sse, 'spec');
      const headers = {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      };

      const getRes = await httpRequest({
        port,
        path: `${DESCRIPTION_API_PREFIX}/linked-screen`,
      });
      assert.equal(getRes.status, 200);
      const getJson = JSON.parse(getRes.body.toString('utf8'));
      assert.equal(getJson.exists, true);

      const del = await httpRequest({
        port,
        method: 'DELETE',
        path: `${DESCRIPTION_API_PREFIX}/linked-screen`,
        headers,
        body: JSON.stringify({ expectedRevision: getJson.revision }),
      });
      assert.equal(del.status, 200);

      await waitFor(() => counters.build === 1, {
        timeoutMs: 10000,
        label: 'linked delete build',
      });
      await sleep(350);

      assert.equal(counters.collect, 0);
      assert.equal(counters.build, 1);
      assert.equal(countReloadTarget(sse, 'spec'), beforeSpec + 1);

      const descPath = path.join(
        workspaceRoot,
        'spec',
        'sample',
        'src',
        'data',
        'linked-screen.json'
      );
      assert.equal(fs.existsSync(descPath), false);
      assert.equal(
        fs.existsSync(
          path.join(
            workspaceRoot,
            'src',
            'sample',
            'pages',
            'linked-screen.spec.json'
          )
        ),
        true
      );
      assert.equal(
        fs.existsSync(
          path.join(
            workspaceRoot,
            'spec',
            'sample',
            'src',
            'snapshots',
            'linked-screen',
            'default.html'
          )
        ),
        true
      );

      const loaded = companion.loadScreenSpecProject({
        rootDir: workspaceRoot,
        projectName: 'sample',
      });
      const screen = loaded.screens.find((s) => s.screenId === 'linked-screen');
      assert.ok(screen);
      assert.equal(screen.status, 'implementation-only');

      const getAfter = await httpRequest({
        port,
        path: `${DESCRIPTION_API_PREFIX}/linked-screen`,
      });
      assert.equal(getAfter.status, 200);
      const afterJson = JSON.parse(getAfter.body.toString('utf8'));
      assert.equal(afterJson.exists, false);
      assert.equal(afterJson.document.schemaVersion, '1.2');
      assert.ok(afterJson.collectedItemIds.includes('title'));
      sse.close();
    }
  );

  it(
    'IMPLEMENTATION_ONLY DELETE は 404 / build:0',
    { timeout: 30000 },
    async () => {
      const workspaceRoot = await createDesignOnlyWorkspace();
      const pagesDir = path.join(workspaceRoot, 'src', 'sample', 'pages');
      await fsp.writeFile(
        path.join(pagesDir, 'impl-only.spec.json'),
        `${JSON.stringify(
          {
            schemaVersion: '1.0',
            screen: { id: 'impl-only', path: '/' },
            states: [{ id: 'default', name: '初期' }],
            interactions: [],
          },
          null,
          2
        )}\n`
      );
      const { port, counters } = await startRuntime(workspaceRoot);
      await sleep(120);

      const del = await httpRequest({
        port,
        method: 'DELETE',
        path: `${DESCRIPTION_API_PREFIX}/impl-only`,
        headers: {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        },
        body: JSON.stringify({ expectedRevision: 'sha256:anything' }),
      });
      assert.equal(del.status, 404);
      assert.equal(
        JSON.parse(del.body.toString('utf8')).code,
        'SPEC_DESCRIPTION_NOT_FOUND'
      );
      await sleep(350);
      assert.equal(counters.collect, 0);
      assert.equal(counters.build, 0);
    }
  );

  it(
    'stale revision DELETE は 409 / build:0 / ファイル維持',
    { timeout: 30000 },
    async () => {
      const workspaceRoot = await createLinkedWorkspace();
      const { port, counters } = await startRuntime(workspaceRoot);
      await sleep(120);

      const headers = {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      };
      const get1 = await httpRequest({
        port,
        path: `${DESCRIPTION_API_PREFIX}/linked-screen`,
      });
      const rev1 = JSON.parse(get1.body.toString('utf8')).revision;
      const doc = JSON.parse(get1.body.toString('utf8')).document;
      doc.screen.description = 'updated';
      const put = await httpRequest({
        port,
        method: 'PUT',
        path: `${DESCRIPTION_API_PREFIX}/linked-screen`,
        headers,
        body: JSON.stringify({ expectedRevision: rev1, document: doc }),
      });
      assert.equal(put.status, 200);
      await waitFor(() => counters.build === 1, {
        timeoutMs: 10000,
        label: 'put build',
      });
      await sleep(350);

      const beforeBuild = counters.build;
      const del = await httpRequest({
        port,
        method: 'DELETE',
        path: `${DESCRIPTION_API_PREFIX}/linked-screen`,
        headers,
        body: JSON.stringify({ expectedRevision: rev1 }),
      });
      assert.equal(del.status, 409);
      await sleep(350);
      assert.equal(counters.build, beforeBuild);
      assert.equal(
        fs.existsSync(
          path.join(
            workspaceRoot,
            'spec',
            'sample',
            'src',
            'data',
            'linked-screen.json'
          )
        ),
        true
      );
    }
  );
});
