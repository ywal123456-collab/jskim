'use strict';

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

const REPO_ROOT = path.resolve(__dirname, '..');
const COMPANION_ENTRY = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js'
);

describe('spec dev orchestration', () => {
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

  async function createFixtureWorkspace() {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-spec-dev-')
    );

    const pagesDir = path.join(workspaceRoot, 'src', 'sample', 'pages');
    const layoutsDir = path.join(workspaceRoot, 'src', 'sample', 'layouts');
    const dataDir = path.join(workspaceRoot, 'spec', 'sample', 'src', 'data');
    const themeDir = path.join(workspaceRoot, 'spec', 'sample', 'src', 'theme');
    const snapDir = path.join(
      workspaceRoot,
      'spec',
      'sample',
      'src',
      'snapshots',
      'demo'
    );
    const resourcesDir = path.join(
      workspaceRoot,
      'spec',
      'sample',
      'src',
      'resources'
    );
    const specDistDir = path.join(workspaceRoot, 'spec', 'sample', 'dist');

    await fsp.mkdir(pagesDir, { recursive: true });
    await fsp.mkdir(layoutsDir, { recursive: true });
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.mkdir(themeDir, { recursive: true });
    await fsp.mkdir(snapDir, { recursive: true });
    await fsp.mkdir(resourcesDir, { recursive: true });
    await fsp.mkdir(specDistDir, { recursive: true });
    await fsp.mkdir(path.join(pagesDir, 'assets', 'css'), { recursive: true });

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
      path.join(layoutsDir, 'base.njk'),
      '<!DOCTYPE html><html><body>{% block body %}{% endblock %}</body></html>\n',
      'utf8'
    );
    await fsp.writeFile(
      path.join(pagesDir, 'index.html.njk'),
      '{% extends "base.njk" %}{% block body %}APP_OK{% endblock %}\n',
      'utf8'
    );
    await fsp.writeFile(
      path.join(pagesDir, 'demo.spec.json'),
      JSON.stringify(
        {
          schemaVersion: '1.0',
          screen: { id: 'demo', path: '/' },
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
      path.join(pagesDir, 'assets', 'css', 'app.css'),
      'body { color: #111; }\n',
      'utf8'
    );
    await fsp.writeFile(
      path.join(dataDir, 'demo.json'),
      JSON.stringify(
        {
          schemaVersion: '1.0',
          screen: { id: 'demo', name: 'Demo', description: '' },
          items: {
            title: {
              name: 'Title',
              type: 'text',
              description: '',
              note: '',
            },
          },
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
    await fsp.writeFile(
      path.join(themeDir, 'preview.css'),
      '/* theme */\n',
      'utf8'
    );
    await fsp.writeFile(
      path.join(snapDir, 'default.html'),
      '<div>snap</div>\n',
      'utf8'
    );
    await writeViewerDist(specDistDir, 'SPEC_V1');

    return workspaceRoot;
  }

  async function writeViewerDist(specDistDir, marker) {
    await fsp.mkdir(specDistDir, { recursive: true });
    await fsp.writeFile(
      path.join(specDistDir, 'index.html'),
      `<!DOCTYPE html><html><body>${marker}</body></html>\n`,
      'utf8'
    );
  }

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

  /**
   * debounce 後に追加 task が走らないことを確認する。
   */
  async function assertStableCounts(counters, expected, sse, expectedSpecReload) {
    await sleep(350);
    assert.equal(counters.collect, expected.collect);
    assert.equal(counters.build, expected.build);
    assert.equal(countReloadTarget(sse, 'spec'), expectedSpecReload);
  }

  async function startSpecDev(options = {}) {
    const workspaceRoot = await createFixtureWorkspace();
    const port = await getFreePort();
    const counters = {
      collect: 0,
      build: 0,
      failNextBuild: false,
    };

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
        return {
          screens: 1,
          states: 1,
          updated: 1,
          unchanged: 0,
        };
      },
      buildFn: async () => {
        if (counters.failNextBuild) {
          counters.failNextBuild = false;
          const err = new Error('意図的な viewer build 失敗');
          err.code = 'JSKIM_SPEC_BUILD_FAIL';
          throw err;
        }
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
      ...options,
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

  it('same-port で / と /spec/ と deep route を提供する', async () => {
    const { port } = await startSpecDev();

    const app = await httpRequest({ port, path: '/' });
    assert.equal(app.status, 200);
    assert.match(app.body.toString('utf8'), /APP_OK/);
    assert.match(app.body.toString('utf8'), /EventSource/);

    const spec = await httpRequest({ port, path: '/spec/' });
    assert.equal(spec.status, 200);
    assert.match(spec.body.toString('utf8'), /SPEC_V1/);
    assert.match(spec.body.toString('utf8'), /EventSource/);
    assert.match(spec.body.toString('utf8'), /\/_jskim\/live-reload/);

    const deep = await httpRequest({ port, path: '/spec/screens/demo' });
    assert.equal(deep.status, 200);
    assert.match(deep.body.toString('utf8'), /SPEC_V1/);
    assert.match(deep.body.toString('utf8'), /EventSource/);
  });

  it('Description 変更は collect:0 build:1 reload(spec):1', async () => {
    const { workspaceRoot, port, counters } = await startSpecDev();
    const sse = await openSse({ port });
    await sleep(120);

    const beforeSpec = countReloadTarget(sse, 'spec');
    const beforeApp = countReloadTarget(sse, 'app');

    await fsp.writeFile(
      path.join(workspaceRoot, 'spec', 'sample', 'src', 'data', 'demo.json'),
      JSON.stringify(
        {
          schemaVersion: '1.0',
          screen: { id: 'demo', name: 'Demo Updated', description: '更新' },
          items: {
            title: {
              name: 'Title',
              type: 'text',
              description: '',
              note: '',
            },
          },
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    await waitFor(() => counters.build === 1, {
      timeoutMs: 10000,
      label: 'description build once',
    });

    await assertStableCounts(
      counters,
      { collect: 0, build: 1 },
      sse,
      beforeSpec + 1
    );
    assert.equal(countReloadTarget(sse, 'app'), beforeApp);

    const spec = await httpRequest({ port, path: '/spec/' });
    assert.match(spec.body.toString('utf8'), /SPEC_V2/);
    sse.close();
  });

  it('theme 変更は collect:0 build:1 reload(spec):1', async () => {
    const { workspaceRoot, port, counters } = await startSpecDev();
    const sse = await openSse({ port });
    await sleep(120);

    const beforeSpec = countReloadTarget(sse, 'spec');
    const beforeApp = countReloadTarget(sse, 'app');

    await fsp.appendFile(
      path.join(workspaceRoot, 'spec', 'sample', 'src', 'theme', 'preview.css'),
      '/* theme touch */\n',
      'utf8'
    );

    await waitFor(() => counters.build === 1, {
      timeoutMs: 10000,
      label: 'theme build once',
    });

    await assertStableCounts(
      counters,
      { collect: 0, build: 1 },
      sse,
      beforeSpec + 1
    );
    assert.equal(countReloadTarget(sse, 'app'), beforeApp);
    sse.close();
  });

  it('page source 変更は collect:1 build:1 reload(spec):1（app reload も 1）', async () => {
    const { workspaceRoot, port, counters } = await startSpecDev();
    const sse = await openSse({ port });
    await sleep(120);

    const beforeSpec = countReloadTarget(sse, 'spec');
    const beforeApp = countReloadTarget(sse, 'app');

    await fsp.appendFile(
      path.join(workspaceRoot, 'src', 'sample', 'pages', 'index.html.njk'),
      '{# touch #}\n',
      'utf8'
    );

    await waitFor(
      () => counters.collect === 1 && counters.build === 1,
      { timeoutMs: 15000, label: 'source collect+build once' }
    );

    await assertStableCounts(
      counters,
      { collect: 1, build: 1 },
      sse,
      beforeSpec + 1
    );
    assert.equal(countReloadTarget(sse, 'app'), beforeApp + 1);
    sse.close();
  });

  it('.spec.json 変更は collect:1 build:1 reload(spec):1', async () => {
    const { workspaceRoot, port, counters } = await startSpecDev();
    const sse = await openSse({ port });
    await sleep(120);

    const beforeSpec = countReloadTarget(sse, 'spec');

    const sidecarPath = path.join(
      workspaceRoot,
      'src',
      'sample',
      'pages',
      'demo.spec.json'
    );
    await fsp.writeFile(
      sidecarPath,
      JSON.stringify(
        {
          schemaVersion: '1.0',
          screen: { id: 'demo', path: '/' },
          states: [
            {
              id: 'default',
              name: '初期(touch)',
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

    await waitFor(
      () => counters.collect === 1 && counters.build === 1,
      { timeoutMs: 15000, label: 'sidecar collect+build once' }
    );

    await assertStableCounts(
      counters,
      { collect: 1, build: 1 },
      sse,
      beforeSpec + 1
    );
    sse.close();
  });

  it('CSS asset 変更は collect:1 build:1 reload(spec):1', async () => {
    const { workspaceRoot, port, counters } = await startSpecDev();
    const sse = await openSse({ port });
    await sleep(120);

    const beforeSpec = countReloadTarget(sse, 'spec');

    await fsp.appendFile(
      path.join(workspaceRoot, 'src', 'sample', 'pages', 'assets', 'css', 'app.css'),
      '/* asset touch */\n',
      'utf8'
    );

    await waitFor(
      () => counters.collect === 1 && counters.build === 1,
      { timeoutMs: 15000, label: 'css asset collect+build once' }
    );

    await assertStableCounts(
      counters,
      { collect: 1, build: 1 },
      sse,
      beforeSpec + 1
    );
    sse.close();
  });

  it('build 失敗後も以前の viewer を維持し、次の成功で復旧する', async () => {
    const { workspaceRoot, port, counters } = await startSpecDev();
    const sse = await openSse({ port });
    await sleep(120);

    counters.failNextBuild = true;
    const beforeSpec = countReloadTarget(sse, 'spec');

    await fsp.appendFile(
      path.join(workspaceRoot, 'spec', 'sample', 'src', 'theme', 'preview.css'),
      '/* fail once */\n',
      'utf8'
    );

    await waitFor(() => counters.failNextBuild === false, {
      timeoutMs: 8000,
      label: 'failed build attempt',
    });
    await sleep(350);

    assert.equal(counters.build, 0);
    assert.equal(counters.collect, 0);
    assert.equal(countReloadTarget(sse, 'spec'), beforeSpec);

    const kept = await httpRequest({ port, path: '/spec/' });
    assert.match(kept.body.toString('utf8'), /SPEC_V1/);

    await fsp.appendFile(
      path.join(workspaceRoot, 'spec', 'sample', 'src', 'theme', 'preview.css'),
      '/* retry ok */\n',
      'utf8'
    );

    await waitFor(() => counters.build === 1, {
      timeoutMs: 10000,
      label: 'recovery build once',
    });

    await assertStableCounts(
      counters,
      { collect: 0, build: 1 },
      sse,
      beforeSpec + 1
    );

    const recovered = await httpRequest({ port, path: '/spec/' });
    assert.match(recovered.body.toString('utf8'), /SPEC_V2/);
    sse.close();
  });

  it('Description 編集 API: GET/PUT → build:1 collect:0 reload(spec):1', async () => {
    const { workspaceRoot, port, counters } = await startSpecDev();
    const sse = await openSse({ port });
    await sleep(120);

    const specHtml = await httpRequest({ port, path: '/spec/' });
    assert.match(specHtml.body.toString('utf8'), /__JSKIM_SPEC_EDIT__/);

    const getRes = await httpRequest({
      port,
      path: '/_jskim/spec/descriptions/demo',
    });
    assert.equal(getRes.status, 200);
    const getJson = JSON.parse(getRes.body.toString('utf8'));
    assert.equal(getJson.screenId, 'demo');
    assert.match(getJson.revision, /^sha256:/);

    const beforeSpec = countReloadTarget(sse, 'spec');
    const nextDoc = structuredClone(getJson.document);
    nextDoc.screen.description = 'APIから更新';

    const putRes = await httpRequest({
      port,
      method: 'PUT',
      path: '/_jskim/spec/descriptions/demo',
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
    const putJson = JSON.parse(putRes.body.toString('utf8'));
    assert.equal(putJson.saved, true);
    assert.equal(putJson.written, true);

    await waitFor(() => counters.build === 1, {
      timeoutMs: 10000,
      label: 'api put build once',
    });
    await assertStableCounts(
      counters,
      { collect: 0, build: 1 },
      sse,
      beforeSpec + 1
    );

    const saved = JSON.parse(
      await fsp.readFile(
        path.join(workspaceRoot, 'spec', 'sample', 'src', 'data', 'demo.json'),
        'utf8'
      )
    );
    assert.equal(saved.screen.description, 'APIから更新');

    const deep = await httpRequest({ port, path: '/spec/screens/demo' });
    assert.equal(deep.status, 200);
    sse.close();
  });

  it('外部編集後の古い revision PUT は 409 で内容を保全する', async () => {
    const { workspaceRoot, port } = await startSpecDev();

    const getRes = await httpRequest({
      port,
      path: '/_jskim/spec/descriptions/demo',
    });
    const getJson = JSON.parse(getRes.body.toString('utf8'));

    await fsp.writeFile(
      path.join(workspaceRoot, 'spec', 'sample', 'src', 'data', 'demo.json'),
      JSON.stringify(
        {
          schemaVersion: '1.0',
          screen: {
            id: 'demo',
            name: 'Demo External',
            description: '外部更新',
          },
          items: {
            title: {
              name: 'Title',
              type: 'text',
              description: '',
              note: '',
            },
          },
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    const conflictDoc = structuredClone(getJson.document);
    conflictDoc.screen.description = '衝突しようとした内容';
    const putRes = await httpRequest({
      port,
      method: 'PUT',
      path: '/_jskim/spec/descriptions/demo',
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      },
      body: JSON.stringify({
        expectedRevision: getJson.revision,
        document: conflictDoc,
      }),
    });
    assert.equal(putRes.status, 409);
    const putJson = JSON.parse(putRes.body.toString('utf8'));
    assert.equal(putJson.code, 'SPEC_DESCRIPTION_REVISION_CONFLICT');

    const kept = JSON.parse(
      await fsp.readFile(
        path.join(workspaceRoot, 'spec', 'sample', 'src', 'data', 'demo.json'),
        'utf8'
      )
    );
    assert.equal(kept.screen.description, '外部更新');
    assert.equal(kept.screen.name, 'Demo External');
  });
});
