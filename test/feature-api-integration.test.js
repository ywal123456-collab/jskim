'use strict';

/**
 * Feature API integration（TEMP workspace + companion dist facade）。
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createFeatureApi } = require('../scripts/lib/create-feature-api');

const REPO_ROOT = path.resolve(__dirname, '..');
const COMPANION_ENTRY = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js',
);

const SENTINEL = {
  fileKey: 'SUPER_SECRET_FILE_KEY_SENTINEL',
  nodeId: '123:SECRET_NODE_SENTINEL',
  email: 'secret-author@example.invalid',
  authorName: '山田 太郎',
  message: 'Safe revision message',
  frameName: 'Safe Frame Name',
};

const FORBIDDEN_SUBSTRINGS = [
  SENTINEL.fileKey,
  'SECRET_NODE_SENTINEL',
  SENTINEL.email,
  'JSKIM_FIGMA_TOKEN',
  'X-Figma-Token',
  'Authorization',
  'https://signed.example.invalid',
];

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeScreen(root, project, id, items = {}) {
  writeJson(path.join(root, 'src', project, 'pages', `${id}.spec.json`), {
    schemaVersion: '1.0',
    screen: { id, path: `/${id}` },
    states: [{ id: 'default', name: 'Default' }],
    interactions: [],
  });
  writeJson(path.join(root, 'spec', project, 'src', 'data', `${id}.json`), {
    schemaVersion: '1.2',
    screen: { id, name: id },
    itemOrder: Object.keys(items),
    excludedItems: {},
    items,
  });
}

function writeFigmaReference(root, project, screenId) {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  const hex = crypto.createHash('sha256').update(png).digest('hex');
  const refDir = path.join(
    root,
    'spec',
    project,
    'src',
    'references',
    screenId,
    'pc',
  );
  fs.mkdirSync(refDir, { recursive: true });
  fs.writeFileSync(path.join(refDir, `reference-${hex}.png`), png);
  writeJson(path.join(refDir, 'meta.json'), {
    schemaVersion: '1.0',
    screenId,
    viewport: { id: 'pc', width: 1, height: 1 },
    format: 'png',
    imageFile: `reference-${hex}.png`,
    imageRevision: `sha256:${hex}`,
    imageWidth: 1,
    imageHeight: 1,
    uploadedAt: '2026-07-20T01:02:03.000Z',
    source: {
      type: 'figma',
      fileKey: SENTINEL.fileKey,
      nodeId: '123:456789',
      frameName: SENTINEL.frameName,
      importedAt: '2026-07-20T01:02:03.000Z',
      exportScale: 1,
    },
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertNoForbiddenSecrets(text) {
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    assert.doesNotMatch(text, new RegExp(escapeRegExp(needle)));
  }
  assert.doesNotMatch(text, /"nodeId"/);
  assert.doesNotMatch(text, /fileKey/);
  assert.doesNotMatch(text, /"cause"/);
  assert.doesNotMatch(text, /"stack"/);
  assert.doesNotMatch(text, /committer/i);
  assert.doesNotMatch(text, /[A-Za-z]:\\Users\\/);
  assert.doesNotMatch(text, /\/Users\/[^\s"'`]+/);
  assert.doesNotMatch(text, /\/home\/[^\s"'`/]+(?:\/|$)/);
}

async function withApiServer(api, fn) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const handled = await api.handleRequest(req, res, {
      pathname: url.pathname,
      method: req.method || 'GET',
    });
    if (!handled) {
      res.statusCode = 404;
      res.end('nf');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function jsonRequest(port, options) {
  return new Promise((resolve, reject) => {
    const body =
      options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method || 'GET',
        headers: {
          Host: `127.0.0.1:${port}`,
          ...(body !== undefined
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              }
            : {}),
          ...(options.headers || {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text,
            json,
          });
        });
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function makeFacade(companion) {
  return {
    getScreenFeatureWorkingState: companion.getScreenFeatureWorkingState,
    createScreenFeature: companion.createScreenFeature,
    updateScreenFeature: companion.updateScreenFeature,
    deleteScreenFeature: companion.deleteScreenFeature,
    reorderScreenFeatures: companion.reorderScreenFeatures,
    moveScreenToFeature: companion.moveScreenToFeature,
    reorderFeatureScreens: companion.reorderFeatureScreens,
    moveFeatureDirection: companion.moveFeatureDirection,
    moveScreenFeatureDirection: companion.moveScreenFeatureDirection,
  };
}

function listKnownScreenIds(rootDir, projectName) {
  const pagesDir = path.join(rootDir, 'src', projectName, 'pages');
  if (!fs.existsSync(pagesDir)) {
    return [];
  }
  return fs
    .readdirSync(pagesDir)
    .filter((name) => name.endsWith('.spec.json'))
    .map((name) => name.slice(0, -'.spec.json'.length))
    .sort();
}

async function setupFeatureWorkspace(companion) {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'jskim-feat-api-'));
  const projectName = 'demo';
  writeScreen(rootDir, projectName, 'alpha', {
    email: {
      name: 'メール',
      type: 'text',
      description: 'd',
      note: '',
    },
  });
  writeScreen(rootDir, projectName, 'beta');
  writeFigmaReference(rootDir, projectName, 'alpha');

  companion.initVersionRepository({ rootDir, projectName });
  companion.persistVersionAuthorConfig({
    rootDir,
    projectName,
    config: {
      schemaVersion: '1.0',
      user: { name: SENTINEL.authorName, email: SENTINEL.email },
    },
  });
  companion.stageProject({ rootDir, projectName });
  companion.commitVersion({
    rootDir,
    projectName,
    message: SENTINEL.message,
  });

  return { rootDir, projectName };
}

describe('feature-api integration', () => {
  /** @type {object} */
  let companion;

  before(async () => {
    companion = await import(pathToFileURL(COMPANION_ENTRY).href);
  });

  it('mutation lifecycle 全体と version status で features.json 変更を検知する', async () => {
    const ctx = await setupFeatureWorkspace(companion);
    try {
      const screenIds = listKnownScreenIds(ctx.rootDir, ctx.projectName);
      const api = createFeatureApi({
        rootDir: ctx.rootDir,
        projectName: ctx.projectName,
        host: '127.0.0.1',
        listScreenIds: () => screenIds,
        facade: makeFacade(companion),
      });

      const responses = [];

      await withApiServer(api, async (port) => {
        const initial = await jsonRequest(port, {
          path: '/_jskim/spec/features',
        });
        assert.equal(initial.status, 200);
        assert.equal(initial.json.sourceExists, false);
        assert.deepEqual(initial.json.ungroupedScreenIds, ['alpha', 'beta']);
        responses.push(initial.text);

        const created = await jsonRequest(port, {
          path: '/_jskim/spec/features',
          method: 'POST',
          body: {
            featureId: 'inquiry',
            name: '問い合わせ',
            description: '説明',
            expectedRevision: initial.json.revision,
          },
        });
        assert.equal(created.status, 201);
        assert.equal(created.json.status, 'created');
        responses.push(created.text);

        const updated = await jsonRequest(port, {
          path: '/_jskim/spec/features/inquiry',
          method: 'PATCH',
          body: {
            name: '問い合わせ更新',
            description: '更新説明',
            expectedRevision: created.json.revision,
          },
        });
        assert.equal(updated.status, 200);
        assert.equal(updated.json.status, 'updated');
        responses.push(updated.text);

        const moved = await jsonRequest(port, {
          path: '/_jskim/spec/features/screens:move',
          method: 'POST',
          body: {
            screenId: 'alpha',
            targetFeatureId: 'inquiry',
            expectedRevision: updated.json.revision,
          },
        });
        assert.equal(moved.status, 200);
        const inquiryAfterMove = moved.json.features.find(
          (feature) => feature.featureId === 'inquiry',
        );
        assert.ok(inquiryAfterMove);
        assert.deepEqual(inquiryAfterMove.screenIds, ['alpha']);
        responses.push(moved.text);

        const createdSecond = await jsonRequest(port, {
          path: '/_jskim/spec/features',
          method: 'POST',
          body: {
            featureId: 'other',
            name: 'その他',
            expectedRevision: moved.json.revision,
          },
        });
        assert.equal(createdSecond.status, 201);
        responses.push(createdSecond.text);

        const reordered = await jsonRequest(port, {
          path: '/_jskim/spec/features:reorder',
          method: 'POST',
          body: {
            orderedFeatureIds: ['other', 'inquiry'],
            expectedRevision: createdSecond.json.revision,
          },
        });
        assert.equal(reordered.status, 200);
        responses.push(reordered.text);

        const deleted = await jsonRequest(port, {
          path: '/_jskim/spec/features/other',
          method: 'DELETE',
          body: {
            expectedRevision: reordered.json.revision,
          },
        });
        assert.equal(deleted.status, 200);
        assert.equal(deleted.json.status, 'deleted');
        responses.push(deleted.text);

        const finalState = await jsonRequest(port, {
          path: '/_jskim/spec/features',
        });
        assert.equal(finalState.status, 200);
        assert.equal(finalState.json.features.length, 1);
        assert.deepEqual(finalState.json.features[0].screenIds, ['alpha']);
        responses.push(finalState.text);
      });

      const all = responses.join('\n');
      assertNoForbiddenSecrets(all);

      const status = companion.getVersionStatus({
        rootDir: ctx.rootDir,
        projectName: ctx.projectName,
      });
      assert.ok(
        status.unstagedChanges.some((change) => change.path === 'features.json'),
        'features.json が unstagedChanges に含まれること',
      );
      assert.equal(status.clean, false);
    } finally {
      await fsp.rm(ctx.rootDir, { recursive: true, force: true });
    }
  });

  it('error endpoint 応答にも secret / stack / 絶対 path を含まない', async () => {
    const ctx = await setupFeatureWorkspace(companion);
    try {
      const screenIds = listKnownScreenIds(ctx.rootDir, ctx.projectName);
      const api = createFeatureApi({
        rootDir: ctx.rootDir,
        projectName: ctx.projectName,
        host: '127.0.0.1',
        listScreenIds: () => screenIds,
        facade: makeFacade(companion),
      });

      await withApiServer(api, async (port) => {
        const cases = [
          {
            label: 'missing expectedRevision',
            res: await jsonRequest(port, {
              path: '/_jskim/spec/features',
              method: 'POST',
              body: {
                featureId: 'inquiry',
                name: '問い合わせ',
              },
            }),
            status: 400,
          },
          {
            label: 'revision conflict',
            res: await jsonRequest(port, {
              path: '/_jskim/spec/features',
              method: 'POST',
              body: {
                featureId: 'inquiry',
                name: '問い合わせ',
                expectedRevision: 'sha256:deadbeef',
              },
            }),
            status: 409,
          },
          {
            label: 'unknown route',
            res: await jsonRequest(port, {
              path: '/_jskim/spec/features/unknown-route',
              method: 'GET',
            }),
            status: 405,
          },
          {
            label: 'bad origin',
            res: await jsonRequest(port, {
              path: '/_jskim/spec/features',
              method: 'POST',
              headers: {
                Origin: 'http://evil.example.com',
              },
              body: {
                featureId: 'inquiry',
                name: '問い合わせ',
                expectedRevision: null,
              },
            }),
            status: 403,
          },
          {
            label: 'wrong method on GET route',
            res: await jsonRequest(port, {
              path: '/_jskim/spec/features',
              method: 'PUT',
              body: { expectedRevision: null },
            }),
            status: 405,
          },
        ];

        for (const item of cases) {
          assert.equal(item.res.status, item.status, item.label);
          assert.ok(
            item.res.json && typeof item.res.json.code === 'string',
            item.label,
          );
          assert.ok(typeof item.res.json.message === 'string', item.label);
          assertNoForbiddenSecrets(item.res.text);
        }
      });
    } finally {
      await fsp.rm(ctx.rootDir, { recursive: true, force: true });
    }
  });
});
