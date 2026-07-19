'use strict';

/**
 * Phase 7D-2: Figma Import API + companion core（mock fetch、実 Figma / PAT なし）。
 */

const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSpecDevRuntime } = require('../scripts/lib/create-spec-dev-runtime');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest } = require('./helpers/http-request');
const { buildPng } = require('./helpers/multipart');

const REPO_ROOT = path.resolve(__dirname, '..');
const COMPANION_ENTRY = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js'
);

const TOKEN = 'integration-test-figma-token';
const FILE_KEY = 'FileKeyABC';
const NODE_ID = '1:3';
const IMAGE_URL = 'https://images.example/export.png';

function parseJson(res) {
  return JSON.parse(res.body.toString('utf8'));
}

describe('Figma Reference Image API integration', () => {
  /** @type {Array<{ close: Function, cleanup: Function }>} */
  const sessions = [];
  /** @type {object|null} */
  let companion = null;
  let previousToken;

  before(async () => {
    companion = await import(pathToFileURL(COMPANION_ENTRY).href);
    previousToken = process.env.JSKIM_FIGMA_TOKEN;
    process.env.JSKIM_FIGMA_TOKEN = TOKEN;
  });

  after(async () => {
    if (previousToken === undefined) {
      delete process.env.JSKIM_FIGMA_TOKEN;
    } else {
      process.env.JSKIM_FIGMA_TOKEN = previousToken;
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
      path.join(os.tmpdir(), 'jskim-figma-api-')
    );
    const pagesDir = path.join(workspaceRoot, 'src/sample/pages');
    const outDir = path.join(workspaceRoot, 'dist/sample');
    await fsp.mkdir(pagesDir, { recursive: true });
    await fsp.mkdir(outDir, { recursive: true });
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
    await fsp.writeFile(
      path.join(pagesDir, 'index.html.njk'),
      '<!doctype html><html><body>ok</body></html>\n'
    );
    const dataDir = path.join(workspaceRoot, 'spec/sample/src/data');
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.writeFile(
      path.join(dataDir, 'design-screen.json'),
      `${JSON.stringify(
        {
          schemaVersion: '1.2',
          screen: {
            id: 'design-screen',
            name: '設計画面',
            description: '',
          },
          itemOrder: [],
          items: {},
          excludedItems: {},
        },
        null,
        2
      )}\n`
    );
    await fsp.mkdir(path.join(workspaceRoot, 'spec/sample/src/references'), {
      recursive: true,
    });
    return workspaceRoot;
  }

  async function startRuntime(workspaceRoot, pngState) {
    const port = await getFreePort();
    const fetchImpl = async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes('/nodes')) {
        return new Response(
          JSON.stringify({
            name: 'File',
            nodes: {
              [NODE_ID]: {
                document: {
                  id: NODE_ID,
                  type: 'FRAME',
                  name: pngState.frameName || 'Hero',
                  absoluteBoundingBox: {
                    x: 0,
                    y: 0,
                    width: 1440,
                    height: 2000,
                  },
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/images/')) {
        return new Response(
          JSON.stringify({ images: { [NODE_ID]: IMAGE_URL } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.startsWith(IMAGE_URL)) {
        const png = pngState.png;
        return new Response(Uint8Array.from(png), {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': String(png.length),
          },
        });
      }
      throw new Error(`未設定の fetch: ${url}`);
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
      getFigmaHooks: () => ({
        env: { JSKIM_FIGMA_TOKEN: TOKEN },
        fetchImpl,
        sleep: async () => {},
      }),
      collectFn: async () => ({ screens: 0, statuses: 0 }),
      buildFn: async () => {
        await companion.buildScreenSpecViewer({
          rootDir: workspaceRoot,
          projectName: 'sample',
          base: '/spec/',
        });
        return {
          outDir: path.join(workspaceRoot, 'spec/sample/dist'),
        };
      },
      classifyPath: companion.classifyScreenSpecWatchPath,
      mergeKinds: companion.mergeScreenSpecWatchKinds,
      createFileDescriptionStore: companion.createFileDescriptionStore,
      loadScreenSpecProject: companion.loadScreenSpecProject,
      withDescriptionScreenLock: companion.withDescriptionScreenLock,
      putReferenceImage: companion.putReferenceImage,
      deleteReferenceImage: companion.deleteReferenceImage,
      getReferenceImagePublicInfo: companion.getReferenceImagePublicInfo,
      importFigmaReferenceImage: companion.importFigmaReferenceImage,
      reimportFigmaReferenceImage: companion.reimportFigmaReferenceImage,
      collectDeviceCapture: companion.collectDeviceCapture,
      getDeviceCapturePublicInfo: companion.getDeviceCapturePublicInfo,
    });
    await runtime.start();
    await companion.buildScreenSpecViewer({
      rootDir: workspaceRoot,
      projectName: 'sample',
      base: '/spec/',
    });
    const cleanup = async () => {
      await fsp.rm(workspaceRoot, { recursive: true, force: true });
    };
    sessions.push({
      close: () =>
        Promise.race([
          runtime.close(),
          new Promise((resolve) => setTimeout(resolve, 8000)),
        ]),
      cleanup,
    });
    return { port, runtime, workspaceRoot };
  }

  it('Import created → unchanged → Reimport updated（秘密非露出）', async () => {
    const workspaceRoot = await prepareWorkspace();
    const pngState = {
      png: buildPng(1440, 2000, 1),
      frameName: 'Hero',
    };
    const { port } = await startRuntime(workspaceRoot, pngState);

    const created = await httpRequest({
      port,
      method: 'POST',
      path: '/_jskim/spec/reference-images/design-screen/pc/figma:import',
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileKey: FILE_KEY,
        nodeId: NODE_ID,
      }),
    });
    assert.equal(created.status, 200);
    const createdJson = parseJson(created);
    assert.equal(createdJson.result, 'created');
    assert.equal(createdJson.source.type, 'figma');
    assert.equal(createdJson.frame.frameName, 'Hero');
    const text = JSON.stringify(createdJson);
    assert.doesNotMatch(text, /"fileKey"/);
    assert.doesNotMatch(text, /"nodeId"/);
    assert.doesNotMatch(text, /FileKeyABC/);

    const rev = createdJson.referenceImage.imageRevision;
    const same = await httpRequest({
      port,
      method: 'POST',
      path: '/_jskim/spec/reference-images/design-screen/pc/figma:import',
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileKey: FILE_KEY,
        nodeId: NODE_ID,
        expectedImageRevision: rev,
      }),
    });
    assert.equal(same.status, 200);
    assert.equal(parseJson(same).result, 'unchanged');

    pngState.png = buildPng(1440, 2000, 2);
    pngState.frameName = 'Hero v2';
    const reimported = await httpRequest({
      port,
      method: 'POST',
      path: '/_jskim/spec/reference-images/design-screen/pc/figma:reimport',
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expectedImageRevision: rev }),
    });
    assert.equal(reimported.status, 200);
    const reJson = parseJson(reimported);
    assert.equal(reJson.result, 'updated');
    assert.equal(reJson.frame.frameName, 'Hero v2');
    assert.notEqual(reJson.referenceImage.imageRevision, rev);
    assert.doesNotMatch(JSON.stringify(reJson), /"fileKey"/);

    const metaPath = path.join(
      workspaceRoot,
      'spec/sample/src/references/design-screen/pc/meta.json'
    );
    const meta = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
    assert.equal(meta.source.type, 'figma');
    assert.equal(meta.source.fileKey, FILE_KEY);
  });

  it('token 未設定は core に届く前に env で解決失敗（500）', async () => {
    const workspaceRoot = await prepareWorkspace();
    const pngState = { png: buildPng(10, 10, 1) };
    const port = await getFreePort();
    const saved = process.env.JSKIM_FIGMA_TOKEN;
    delete process.env.JSKIM_FIGMA_TOKEN;

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
      getFigmaHooks: () => ({
        env: {},
        fetchImpl: async () => {
          throw new Error('fetch は呼ばれない想定');
        },
      }),
      collectFn: async () => ({ screens: 0, statuses: 0 }),
      buildFn: async () => ({
        outDir: path.join(workspaceRoot, 'spec/sample/dist'),
      }),
      classifyPath: companion.classifyScreenSpecWatchPath,
      mergeKinds: companion.mergeScreenSpecWatchKinds,
      createFileDescriptionStore: companion.createFileDescriptionStore,
      loadScreenSpecProject: companion.loadScreenSpecProject,
      withDescriptionScreenLock: companion.withDescriptionScreenLock,
      putReferenceImage: companion.putReferenceImage,
      deleteReferenceImage: companion.deleteReferenceImage,
      getReferenceImagePublicInfo: companion.getReferenceImagePublicInfo,
      importFigmaReferenceImage: companion.importFigmaReferenceImage,
      reimportFigmaReferenceImage: companion.reimportFigmaReferenceImage,
      collectDeviceCapture: companion.collectDeviceCapture,
      getDeviceCapturePublicInfo: companion.getDeviceCapturePublicInfo,
    });
    await runtime.start();
    sessions.push({
      close: () => runtime.close(),
      cleanup: async () => {
        await fsp.rm(workspaceRoot, { recursive: true, force: true });
        if (saved === undefined) {
          delete process.env.JSKIM_FIGMA_TOKEN;
        } else {
          process.env.JSKIM_FIGMA_TOKEN = saved;
        }
      },
    });

    const res = await httpRequest({
      port,
      method: 'POST',
      path: '/_jskim/spec/reference-images/design-screen/pc/figma:import',
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileKey: FILE_KEY, nodeId: NODE_ID }),
    });
    assert.equal(res.status, 500);
    assert.equal(parseJson(res).code, 'SPEC_FIGMA_TOKEN_MISSING');
  });
});
