'use strict';

/**
 * Phase 7B-1 安定化: Description 新規作成 / 初回保存時の
 * collect / viewer build / reload(target=spec) 回数を live runtime で計測する。
 */

const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
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

describe('design-first Description create: watcher 回数', () => {
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
          `SPEC_V${counters.build + 1}`
        );
        return {
          outDir: path.join(workspaceRoot, 'spec', 'sample', 'dist'),
        };
      },
      classifyPath: companion.classifyScreenSpecWatchPath,
      mergeKinds: companion.mergeScreenSpecWatchKinds,
      createFileDescriptionStore: companion.createFileDescriptionStore,
      loadScreenSpecProject: companion.loadScreenSpecProject,
    });
    await runtime.start();
    const entry = {
      workspaceRoot,
      port,
      counters,
      runtime,
      close: () => runtime.close(),
      cleanup: () => fsp.rm(workspaceRoot, { recursive: true, force: true }),
    };
    sessions.push(entry);
    return entry;
  }

  async function createEmptyDesignWorkspace() {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-df-watch-empty-')
    );
    const pagesDir = path.join(workspaceRoot, 'src', 'sample', 'pages');
    const layoutsDir = path.join(workspaceRoot, 'src', 'sample', 'layouts');
    const dataDir = path.join(workspaceRoot, 'spec', 'sample', 'src', 'data');
    const themeDir = path.join(workspaceRoot, 'spec', 'sample', 'src', 'theme');
    const specDistDir = path.join(workspaceRoot, 'spec', 'sample', 'dist');
    const distDir = path.join(workspaceRoot, 'dist', 'sample');

    await fsp.mkdir(pagesDir, { recursive: true });
    await fsp.mkdir(layoutsDir, { recursive: true });
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.mkdir(themeDir, { recursive: true });
    await fsp.mkdir(specDistDir, { recursive: true });
    await fsp.mkdir(distDir, { recursive: true });

    await writeBaseConfig(workspaceRoot);
    await fsp.writeFile(
      path.join(layoutsDir, 'base.njk'),
      '<!DOCTYPE html><html><body>{% block body %}{% endblock %}</body></html>\n',
      'utf8'
    );
    await fsp.writeFile(
      path.join(pagesDir, 'index.html.njk'),
      '{% extends "base.njk" %}{% block body %}APP_OK{% endblock %}\n',
      'utf8'
    );
    await fsp.writeFile(path.join(themeDir, 'preview.css'), '/* theme */\n', 'utf8');
    await fsp.writeFile(
      path.join(distDir, 'index.html'),
      '<!DOCTYPE html><html><body>APP_OK</body></html>\n',
      'utf8'
    );
    await writeViewerDist(specDistDir, 'SPEC_V1');
    return workspaceRoot;
  }

  async function createImplOnlyWorkspace() {
    const workspaceRoot = await createEmptyDesignWorkspace();
    const pagesDir = path.join(workspaceRoot, 'src', 'sample', 'pages');
    const snapDir = path.join(
      workspaceRoot,
      'spec',
      'sample',
      'src',
      'snapshots',
      'impl-only'
    );
    await fsp.mkdir(snapDir, { recursive: true });
    await fsp.writeFile(
      path.join(pagesDir, 'impl-only.spec.json'),
      JSON.stringify(
        {
          schemaVersion: '1.0',
          screen: { id: 'impl-only', path: '/' },
          states: [
            {
              id: 'default',
              name: '初期',
              viewer: { visible: true, order: 1 },
            },
          ],
          interactions: [],
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
    await fsp.writeFile(
      path.join(snapDir, 'default.html'),
      '<div data-jskim-spec-item="title">title</div>\n',
      'utf8'
    );
    return workspaceRoot;
  }

  it(
    '0 画面 → POST 作成: collect:0 build:1 reload(spec):1',
    { timeout: 30000 },
    async () => {
      const workspaceRoot = await createEmptyDesignWorkspace();
      const { port, counters } = await startRuntime(workspaceRoot);
      const sse = await openSse({ port });
      await sleep(120);

      const beforeSpec = countReloadTarget(sse, 'spec');
      assert.equal(counters.collect, 0);
      assert.equal(counters.build, 0);

      const post = await httpRequest({
        port,
        method: 'POST',
        path: DESCRIPTION_API_PREFIX,
        headers: {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        },
        body: JSON.stringify({
          screenId: 'design-first',
          name: '設計先行',
          description: '',
        }),
      });
      assert.equal(post.status, 201);

      const filePath = path.join(
        workspaceRoot,
        'spec',
        'sample',
        'src',
        'data',
        'design-first.json'
      );
      await waitFor(
        async () => {
          try {
            await fsp.access(filePath);
            return true;
          } catch {
            return false;
          }
        },
        { timeoutMs: 5000, label: 'description file created' }
      );

      await waitFor(() => counters.build === 1, {
        timeoutMs: 10000,
        label: 'viewer build once after POST',
      });
      await sleep(350);

      assert.equal(counters.collect, 0);
      assert.equal(counters.build, 1);
      assert.equal(countReloadTarget(sse, 'spec'), beforeSpec + 1);
      sse.close();
    }
  );

  it(
    'IMPLEMENTATION_ONLY 初回 PUT: collect:0 build:1 reload(spec):1',
    { timeout: 30000 },
    async () => {
      const workspaceRoot = await createImplOnlyWorkspace();
      const { port, counters } = await startRuntime(workspaceRoot);
      const sse = await openSse({ port });
      await sleep(120);

      const beforeSpec = countReloadTarget(sse, 'spec');
      const getRes = await httpRequest({
        port,
        path: `${DESCRIPTION_API_PREFIX}/impl-only`,
      });
      assert.equal(getRes.status, 200);
      const getJson = JSON.parse(getRes.body.toString('utf8'));
      assert.equal(getJson.exists, false);

      const nextDoc = structuredClone(getJson.document);
      nextDoc.screen.name = '実装のみから連携';
      nextDoc.screen.description = '初回保存';

      const putRes = await httpRequest({
        port,
        method: 'PUT',
        path: `${DESCRIPTION_API_PREFIX}/impl-only`,
        headers: {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        },
        body: JSON.stringify({
          expectedRevision: getJson.revision,
          document: nextDoc,
        }),
      });
      assert.equal(putRes.status, 200);

      await waitFor(() => counters.build === 1, {
        timeoutMs: 10000,
        label: 'viewer build once after first PUT',
      });
      await sleep(350);

      assert.equal(counters.collect, 0);
      assert.equal(counters.build, 1);
      assert.equal(countReloadTarget(sse, 'spec'), beforeSpec + 1);

      const saved = JSON.parse(
        await fsp.readFile(
          path.join(
            workspaceRoot,
            'spec',
            'sample',
            'src',
            'data',
            'impl-only.json'
          ),
          'utf8'
        )
      );
      assert.equal(saved.screen.name, '実装のみから連携');
      sse.close();
    }
  );

  it(
    '重複 POST 409: collect:0 build:0 reload:0',
    { timeout: 30000 },
    async () => {
      const workspaceRoot = await createEmptyDesignWorkspace();
      const { port, counters } = await startRuntime(workspaceRoot);
      const sse = await openSse({ port });
      await sleep(120);

      const headers = {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      };
      const body = JSON.stringify({
        screenId: 'dup-watch',
        name: '重複',
        description: '',
      });

      const first = await httpRequest({
        port,
        method: 'POST',
        path: DESCRIPTION_API_PREFIX,
        headers,
        body,
      });
      assert.equal(first.status, 201);

      await waitFor(() => counters.build === 1, {
        timeoutMs: 10000,
        label: 'first create build',
      });
      await sleep(350);
      const afterFirstSpec = countReloadTarget(sse, 'spec');
      const buildAfterFirst = counters.build;
      const collectAfterFirst = counters.collect;

      const second = await httpRequest({
        port,
        method: 'POST',
        path: DESCRIPTION_API_PREFIX,
        headers,
        body,
      });
      assert.equal(second.status, 409);
      await sleep(500);

      assert.equal(counters.collect, collectAfterFirst);
      assert.equal(counters.build, buildAfterFirst);
      assert.equal(countReloadTarget(sse, 'spec'), afterFirstSpec);
      sse.close();
    }
  );
});
