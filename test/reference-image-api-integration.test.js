'use strict';

/**
 * Phase 7C-2A-2: Reference Image API + watcher BUILD_ONLY same-port 検証。
 */

const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createSpecDevRuntime } = require('../scripts/lib/create-spec-dev-runtime');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest, openSse } = require('./helpers/http-request');
const { waitFor } = require('./helpers/wait-for-output');
const { REFERENCE_IMAGE_STATUS_PATH } = require('../scripts/lib/create-reference-image-api');
const { buildMultipartBody, buildPng } = require('./helpers/multipart');

const REPO_ROOT = path.resolve(__dirname, '..');
const COMPANION_ENTRY = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js'
);

function parseJson(res) {
  return JSON.parse(res.body.toString('utf8'));
}

function contentRevision(buf) {
  return `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;
}

describe('Reference Image API same-port integration', () => {
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
      await Promise.race([
        entry.close().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
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

  async function prepareWorkspace() {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-ref-api-')
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
      getReferenceImagePutHooks: extra.getReferenceImagePutHooks,
      getReferenceImageDeleteHooks: extra.getReferenceImageDeleteHooks,
      collectFn: async () => {
        counters.collect += 1;
        return { screens: 0, states: 0 };
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
      withDescriptionScreenLock: companion.withDescriptionScreenLock,
      putReferenceImage: companion.putReferenceImage,
      deleteReferenceImage: companion.deleteReferenceImage,
      getReferenceImagePublicInfo: companion.getReferenceImagePublicInfo,
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
    return { port, counters, runtime, workspaceRoot };
  }

  async function putImage(port, screenId, viewport, png, expected) {
    const boundary = '----refint';
    const parts = [
      {
        name: 'image',
        filename: 'ref.png',
        contentType: 'image/png',
        data: png,
      },
    ];
    if (expected != null) {
      parts.push({ name: 'expectedImageRevision', data: expected });
    }
    const body = buildMultipartBody(boundary, parts);
    return httpRequest({
      port,
      method: 'PUT',
      path: `/_jskim/spec/reference-images/${screenId}/${viewport}`,
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      timeoutMs: 15000,
    });
  }

  async function deleteImage(port, screenId, viewport, expectedImageRevision) {
    return httpRequest({
      port,
      method: 'DELETE',
      path: `/_jskim/spec/reference-images/${screenId}/${viewport}`,
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expectedImageRevision }),
      timeoutMs: 15000,
    });
  }

  it('DESIGN_ONLY PC/SP upload → watcher build/reload → manifest/output', async () => {
    const workspaceRoot = await prepareWorkspace();
    const { port, counters } = await startRuntime(workspaceRoot);
    const sse = await openSse({
      port,
      path: '/_jskim/live-reload',
      headers: { Host: `127.0.0.1:${port}` },
    });
    try {
      const buildBefore = counters.build;
      const reloadBefore = countReloadTarget(sse, 'spec');
      const collectBefore = counters.collect;

      const pngPc = buildPng(40, 50, 1);
      const putPc = parseJson(
        await putImage(port, 'design-screen', 'pc', pngPc)
      );
      assert.equal(putPc.result, 'created');
      assert.equal(putPc.referenceImage.status, 'current');
      assert.equal(putPc.referenceImage.imageRevision, contentRevision(pngPc));

      await waitFor(
        () => counters.build >= buildBefore + 1 && counters.buildsInFlight === 0,
        { timeoutMs: 15000 }
      );
      await waitFor(
        () => countReloadTarget(sse, 'spec') > reloadBefore,
        { timeoutMs: 15000 }
      );
      assert.equal(counters.collect, collectBefore);

      const status = parseJson(
        await httpRequest({
          port,
          path: `${REFERENCE_IMAGE_STATUS_PATH}?screenId=design-screen&viewport=pc`,
          headers: {
            Host: `127.0.0.1:${port}`,
            Origin: `http://127.0.0.1:${port}`,
          },
        })
      );
      assert.equal(status.runtime.status, 'idle');
      assert.equal(status.referenceImage.status, 'current');

      await waitFor(async () => {
        const screenRes = await httpRequest({
          port,
          path: '/spec/data/screens/design-screen.json',
          headers: { Host: `127.0.0.1:${port}` },
        });
        if (screenRes.status !== 200) {
          return false;
        }
        const screen = JSON.parse(screenRes.body.toString('utf8'));
        return (
          screen.hasReferenceImage === true &&
          screen.referenceImages &&
          screen.referenceImages.pc &&
          screen.referenceImages.pc.status === 'current'
        );
      }, { timeoutMs: 15000 });

      const screen = JSON.parse(
        (
          await httpRequest({
            port,
            path: '/spec/data/screens/design-screen.json',
            headers: { Host: `127.0.0.1:${port}` },
          })
        ).body.toString('utf8')
      );
      const imgRes = await httpRequest({
        port,
        path: `/spec/data/${screen.referenceImages.pc.imagePath}`,
        headers: { Host: `127.0.0.1:${port}` },
      });
      assert.equal(imgRes.status, 200);
      assert.equal(
        contentRevision(imgRes.body),
        putPc.referenceImage.imageRevision
      );

      const buildSpBefore = counters.build;
      const pngSp = buildPng(20, 30, 2);
      const putSp = parseJson(
        await putImage(port, 'design-screen', 'sp', pngSp)
      );
      assert.equal(putSp.result, 'created');
      await waitFor(
        () =>
          counters.build >= buildSpBefore + 1 && counters.buildsInFlight === 0,
        { timeoutMs: 15000 }
      );

      const screen2 = JSON.parse(
        (
          await httpRequest({
            port,
            path: '/spec/data/screens/design-screen.json',
            headers: { Host: `127.0.0.1:${port}` },
          })
        ).body.toString('utf8')
      );
      assert.equal(screen2.referenceImages.pc.status, 'current');
      assert.equal(screen2.referenceImages.sp.status, 'current');
    } finally {
      sse.close();
    }
  });

  it('replace / unchanged / delete / stale conflict', async () => {
    const workspaceRoot = await prepareWorkspace();
    const { port, counters } = await startRuntime(workspaceRoot);
    const sse = await openSse({
      port,
      path: '/_jskim/live-reload',
      headers: { Host: `127.0.0.1:${port}` },
    });
    try {
      const png1 = buildPng(12, 12, 1);
      const created = parseJson(
        await putImage(port, 'design-screen', 'pc', png1)
      );
      assert.equal(created.result, 'created');
      await waitFor(
        () =>
          fs.existsSync(
            path.join(
              workspaceRoot,
              'spec/sample/src/references/design-screen/pc/meta.json'
            )
          ),
        { timeoutMs: 10000 }
      );
      await waitFor(() => counters.buildsInFlight === 0, { timeoutMs: 15000 });

      const buildBefore = counters.build;
      const reloadBefore = countReloadTarget(sse, 'spec');
      const png2 = buildPng(12, 12, 2);
      const updated = parseJson(
        await putImage(
          port,
          'design-screen',
          'pc',
          png2,
          created.referenceImage.imageRevision
        )
      );
      assert.equal(updated.result, 'updated');
      await waitFor(
        () => counters.build >= buildBefore + 1 && counters.buildsInFlight === 0,
        { timeoutMs: 15000 }
      );
      await waitFor(
        () => countReloadTarget(sse, 'spec') > reloadBefore,
        { timeoutMs: 15000 }
      );

      const stale = parseJson(
        await putImage(
          port,
          'design-screen',
          'pc',
          buildPng(12, 12, 3),
          created.referenceImage.imageRevision
        )
      );
      assert.equal(stale.code, 'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT');

      const metaPath = path.join(
        workspaceRoot,
        'spec/sample/src/references/design-screen/pc/meta.json'
      );
      const metaBefore = await fsp.readFile(metaPath);
      const buildUnchanged = counters.build;
      const reloadUnchanged = countReloadTarget(sse, 'spec');
      const same = parseJson(
        await putImage(
          port,
          'design-screen',
          'pc',
          png2,
          updated.referenceImage.imageRevision
        )
      );
      assert.equal(same.result, 'unchanged');
      assert.equal(
        same.referenceImage.uploadedAt,
        updated.referenceImage.uploadedAt
      );
      assert.ok((await fsp.readFile(metaPath)).equals(metaBefore));
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(counters.build, buildUnchanged);
      assert.equal(countReloadTarget(sse, 'spec'), reloadUnchanged);

      const buildDel = counters.build;
      const del = parseJson(
        await deleteImage(
          port,
          'design-screen',
          'pc',
          updated.referenceImage.imageRevision
        )
      );
      assert.equal(del.result, 'deleted');
      await waitFor(
        () => counters.build >= buildDel + 1 && counters.buildsInFlight === 0,
        { timeoutMs: 15000 }
      );
      assert.equal(fs.existsSync(metaPath), false);

      const delAgain = parseJson(
        await deleteImage(
          port,
          'design-screen',
          'pc',
          updated.referenceImage.imageRevision
        )
      );
      assert.equal(delAgain.code, 'SPEC_REFERENCE_IMAGE_NOT_FOUND');
    } finally {
      sse.close();
    }
  });

  it('同一 key in-progress 409 と barrier 後完了', async () => {
    const workspaceRoot = await prepareWorkspace();
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const { port } = await startRuntime(workspaceRoot, {
      getReferenceImagePutHooks: () => ({
        awaitBarrier: () => gate,
      }),
    });

    const p1 = putImage(port, 'design-screen', 'pc', buildPng(5, 5, 1));
    await waitFor(async () => {
      const st = parseJson(
        await httpRequest({
          port,
          path: `${REFERENCE_IMAGE_STATUS_PATH}?screenId=design-screen&viewport=pc`,
          headers: {
            Host: `127.0.0.1:${port}`,
            Origin: `http://127.0.0.1:${port}`,
          },
        })
      );
      return st.runtime.status === 'uploading';
    }, { timeoutMs: 10000 });

    const dup = parseJson(
      await putImage(port, 'design-screen', 'pc', buildPng(5, 5, 2))
    );
    assert.equal(dup.code, 'SPEC_REFERENCE_IMAGE_IN_PROGRESS');

    const delDup = parseJson(
      await deleteImage(
        port,
        'design-screen',
        'pc',
        `sha256:${'a'.repeat(64)}`
      )
    );
    assert.equal(delDup.code, 'SPEC_REFERENCE_IMAGE_IN_PROGRESS');

    release();
    const done = parseJson(await p1);
    assert.equal(done.result, 'created');
  });
});
