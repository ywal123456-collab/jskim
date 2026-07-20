'use strict';

/**
 * Phase 7E-4B: Revision History API integration（TEMP repository + sentinel 全 endpoint）。
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
const {
  createVersionHistoryApi,
} = require('../scripts/lib/create-version-history-api');

const REPO_ROOT = path.resolve(__dirname, '..');
const COMPANION_ENTRY = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js'
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
    'pc'
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

function assertNoForbiddenSecrets(text, { allowAuthor = false } = {}) {
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    assert.doesNotMatch(text, new RegExp(escapeRegExp(needle)));
  }
  assert.doesNotMatch(text, /"nodeId"/);
  assert.doesNotMatch(text, /fileKey/);
  assert.doesNotMatch(text, /"cause"/);
  assert.doesNotMatch(text, /"stack"/);
  assert.doesNotMatch(text, /committer/i);
  if (!allowAuthor) {
    assert.doesNotMatch(text, new RegExp(escapeRegExp(SENTINEL.email)));
  }
  assert.doesNotMatch(text, /[A-Za-z]:\\Users\\/);
  assert.doesNotMatch(text, /\/Users\/[^\s"'`]+/);
  assert.doesNotMatch(text, /\/home\/[^\s"'`/]+(?:\/|$)/);
}

function assertAllowedSuccessMarkers(text) {
  assert.match(text, new RegExp(escapeRegExp(SENTINEL.authorName)));
  assert.match(text, new RegExp(escapeRegExp(SENTINEL.message)));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function request(port, p, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: p,
        method,
        headers: { Host: `127.0.0.1:${port}` },
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
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function makeFacade(companion) {
  return {
    getBrowserVersionStatus: companion.getBrowserVersionStatus,
    listBrowserVersionRevisions: companion.listBrowserVersionRevisions,
    getBrowserVersionRevisionDetail: companion.getBrowserVersionRevisionDetail,
    getBrowserVersionRevisionDiff: companion.getBrowserVersionRevisionDiff,
    listBrowserVersionFeatures: companion.listBrowserVersionFeatures,
    listBrowserVersionBranches: companion.listBrowserVersionBranches,
    listBrowserVersionTags: companion.listBrowserVersionTags,
  };
}

async function setupSentinelRepository(companion) {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'jskim-vh-api-'));
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
  writeJson(path.join(rootDir, 'spec', projectName, 'src', 'features.json'), {
    schemaVersion: '1.0',
    features: [
      {
        featureId: 'inquiry',
        name: '問い合わせ',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
    ],
  });

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
  const first = companion.commitVersion({
    rootDir,
    projectName,
    message: SENTINEL.message,
  });

  writeScreen(rootDir, projectName, 'alpha', {
    email: {
      name: 'メール変更',
      type: 'text',
      description: 'd2',
      note: '',
    },
  });
  companion.stageProject({ rootDir, projectName });
  const second = companion.commitVersion({
    rootDir,
    projectName,
    message: '説明更新',
  });

  writeFigmaReference(rootDir, projectName, 'alpha');
  companion.stageProject({ rootDir, projectName });
  companion.commitVersion({
    rootDir,
    projectName,
    message: '参照追加',
  });

  return { rootDir, projectName, first, second };
}

describe('version-history-api integration', () => {
  /** @type {object} */
  let companion;

  before(async () => {
    companion = await import(pathToFileURL(COMPANION_ENTRY).href);
  });

  it('未初期化 status は 200 で secret を含まない', async () => {
    const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'jskim-vh-uninit-'));
    const projectName = 'demo';
    try {
      const api = createVersionHistoryApi({
        rootDir,
        projectName,
        facade: makeFacade(companion),
      });
      await withApiServer(api, async (port) => {
        const status = await request(port, '/_jskim/spec/version/status');
        assert.equal(status.status, 200);
        assert.equal(status.json.initialized, false);
        assertNoForbiddenSecrets(status.text);
      });
    } finally {
      await fsp.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('sentinel fixture の success endpoint 全件で secret が漏れない', async () => {
    const ctx = await setupSentinelRepository(companion);
    try {
      const api = createVersionHistoryApi({
        rootDir: ctx.rootDir,
        projectName: ctx.projectName,
        facade: makeFacade(companion),
      });
      await withApiServer(api, async (port) => {
        const paths = [
          '/_jskim/spec/version/status',
          '/_jskim/spec/version/revisions?scope=project&limit=10',
          '/_jskim/spec/version/revisions?scope=screen&screenId=alpha',
          '/_jskim/spec/version/revisions?scope=feature&featureId=inquiry',
          `/_jskim/spec/version/revisions/${ctx.first.commitHash}`,
          `/_jskim/spec/version/diff?to=${ctx.second.commitHash}`,
          '/_jskim/spec/version/branches',
          '/_jskim/spec/version/tags',
        ];

        const bodies = [];
        for (const p of paths) {
          const res = await request(port, p);
          assert.equal(res.status, 200, p);
          bodies.push(res.text);
        }

        const all = bodies.join('\n');
        assertNoForbiddenSecrets(all);
        assertAllowedSuccessMarkers(all);
        assert.doesNotMatch(all, new RegExp(escapeRegExp(SENTINEL.frameName)));

        const page1 = await request(
          port,
          '/_jskim/spec/version/revisions?scope=project&limit=1'
        );
        assert.equal(page1.status, 200);
        const conflict = await request(
          port,
          `/_jskim/spec/version/revisions?scope=project&limit=1&cursor=${page1.json.nextCursor}&historyHead=${ctx.first.commitHash}`
        );
        assert.equal(conflict.status, 409);
        assert.equal(conflict.json.code, 'SPEC_VERSION_HEAD_CHANGED');
        assertNoForbiddenSecrets(conflict.text);
      });
    } finally {
      await fsp.rm(ctx.rootDir, { recursive: true, force: true });
    }
  });

  it('error endpoint 応答にも secret / stack / 絶対 path を含まない', async () => {
    const ctx = await setupSentinelRepository(companion);
    try {
    const windowsPath = `C:${'\\Users\\secret\\repo\\object'}`;
    const posixPath = `${['', 'home'].join('/')}/secret-user/project/object`;
      const realDetail = companion.getBrowserVersionRevisionDetail.bind(companion);
      const facade = {
        ...makeFacade(companion),
        listBrowserVersionRevisions: () => {
          const err = new Error(`failed at ${windowsPath} and ${posixPath}`);
          err.code = 'SPEC_VERSION_RECOVERY_REQUIRED';
          throw err;
        },
        getBrowserVersionRevisionDetail: (opts) => {
          if (opts.revision === ctx.first.commitHash) {
            const err = new Error(`missing ${posixPath}`);
            err.code = 'SPEC_VERSION_OBJECT_CORRUPT';
            throw err;
          }
          return realDetail(opts);
        },
      };
      const api = createVersionHistoryApi({
        rootDir: ctx.rootDir,
        projectName: ctx.projectName,
        facade,
      });
      await withApiServer(api, async (port) => {
        const cases = [
          {
            label: 'invalid query',
            res: await request(
              port,
              '/_jskim/spec/version/revisions?scope=nope'
            ),
            status: 400,
          },
          {
            label: 'duplicate query',
            res: await request(
              port,
              '/_jskim/spec/version/revisions?scope=project&scope=screen'
            ),
            status: 400,
          },
          {
            label: 'revision not found',
            res: await request(
              port,
              `/_jskim/spec/version/revisions/${'0'.repeat(64)}`
            ),
            status: 404,
          },
          {
            label: 'invalid hash',
            res: await request(
              port,
              '/_jskim/spec/version/revisions/foo%5Cbar'
            ),
            status: 400,
          },
          {
            label: 'encoded parent segment',
            res: await request(
              port,
              '/_jskim/spec/version/revisions/%2e%2e'
            ),
            status: 404,
          },
          {
            label: 'recovery required',
            res: await request(
              port,
              '/_jskim/spec/version/revisions?scope=project'
            ),
            status: 409,
          },
          {
            label: 'corrupt object',
            res: await request(
              port,
              `/_jskim/spec/version/revisions/${ctx.first.commitHash}`
            ),
            status: 500,
          },
          {
            label: 'wrong method',
            res: await request(port, '/_jskim/spec/version/status', 'POST'),
            status: 405,
          },
          {
            label: 'unknown route',
            res: await request(port, '/_jskim/spec/version/unknown'),
            status: 404,
          },
        ];

        for (const item of cases) {
          assert.equal(item.res.status, item.status, item.label);
          assert.ok(item.res.json && typeof item.res.json.code === 'string', item.label);
          assert.ok(typeof item.res.json.message === 'string', item.label);
          assertNoForbiddenSecrets(item.res.text);
          assert.doesNotMatch(item.res.text, /C:\\Users\\secret/);
          assert.doesNotMatch(item.res.text, /\/home\/secret-user/);
        }
      });
    } finally {
      await fsp.rm(ctx.rootDir, { recursive: true, force: true });
    }
  });

  it('merge commit は parentCount=2 と isMerge=true を返す', async () => {
    const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'jskim-vh-merge-'));
    const projectName = 'demo';
    try {
      writeScreen(rootDir, projectName, 'alpha');
      writeScreen(rootDir, projectName, 'beta');
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

      companion.createVersionBranch({ rootDir, projectName, name: 'topic' });
      companion.checkoutVersion({ rootDir, projectName, target: 'topic' });
      writeScreen(rootDir, projectName, 'beta', 'topic-side');
      companion.stageProject({ rootDir, projectName });
      companion.commitVersion({
        rootDir,
        projectName,
        message: 'topic-side',
      });

      companion.checkoutVersion({ rootDir, projectName, target: 'main' });
      writeScreen(rootDir, projectName, 'alpha', 'main-side');
      companion.stageProject({ rootDir, projectName });
      companion.commitVersion({
        rootDir,
        projectName,
        message: 'main-side',
      });

      const merged = companion.mergeVersion({
        rootDir,
        projectName,
        target: 'topic',
        message: 'Merge topic into main',
      });
      assert.equal(merged.outcome, 'merged');

      const api = createVersionHistoryApi({
        rootDir,
        projectName,
        facade: makeFacade(companion),
      });
      await withApiServer(api, async (port) => {
        const list = await request(
          port,
          '/_jskim/spec/version/revisions?scope=project&limit=5'
        );
        assert.equal(list.status, 200);
        const mergeItem = list.json.revisions.find((r) => r.isMerge === true || r.parentCount === 2)
          ?? list.json.revisions[0];
        assert.equal(mergeItem.parentCount, 2);

        const detail = await request(
          port,
          `/_jskim/spec/version/revisions/${mergeItem.hash}`
        );
        assert.equal(detail.status, 200);
        assert.equal(detail.json.isMerge, true);
        assert.equal(detail.json.parentCount, 2);
        assertNoForbiddenSecrets(detail.text);
      });
    } finally {
      await fsp.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('未初期化 repository では history endpoint が 409', async () => {
    const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'jskim-vh-uninit2-'));
    const projectName = 'demo';
    try {
      const api = createVersionHistoryApi({
        rootDir,
        projectName,
        facade: makeFacade(companion),
      });
      await withApiServer(api, async (port) => {
        const res = await request(
          port,
          '/_jskim/spec/version/revisions?scope=project'
        );
        assert.equal(res.status, 409);
        assert.equal(res.json.code, 'SPEC_VERSION_NOT_INITIALIZED');
        assertNoForbiddenSecrets(res.text);
      });
    } finally {
      await fsp.rm(rootDir, { recursive: true, force: true });
    }
  });
});
