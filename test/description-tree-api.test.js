'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  createDescriptionTreeApi,
  DESCRIPTION_TREE_API_PREFIX,
  mapDescriptionTreeStatus,
} = require('../scripts/lib/create-description-tree-api');
const {
  createDescriptionEditApi,
} = require('../scripts/lib/create-description-edit-api');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest } = require('./helpers/http-request');

const REPO_ROOT = path.resolve(__dirname, '..');
const COMPANION_ENTRY = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js',
);

function emptyItem() {
  return { name: '', type: '', description: '', note: '' };
}

function writeDescriptionFile(dataDir, screenId, doc) {
  const filePath = path.join(dataDir, `${screenId}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return filePath;
}

function parseJson(res) {
  return JSON.parse(res.body.toString('utf8'));
}

function assertErrorHygiene(res, expectedStatus, expectedCode) {
  const bodyText = res.body.toString('utf8');
  assert.equal(res.status, expectedStatus);
  const json = parseJson(res);
  assert.equal(json.code, expectedCode);
  assert.match(json.message, /[\u3040-\u30ff\u4e00-\u9faf]/);
  assert.equal(bodyText.includes('stack'), false);
  assert.equal(bodyText.includes('"cause"'), false);
  assert.equal(bodyText.includes('.lock'), false);
  assert.equal(/[A-Za-z]:\\/.test(bodyText), false);
  assert.equal(bodyText.includes('AppData'), false);
  assert.equal(bodyText.includes('jskim-tree-api'), false);
  return json;
}

async function createWorkspace(initialDocs = {}) {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'jskim-tree-api-'));
  const projectName = 'demo';
  const dataDir = path.join(rootDir, 'spec', projectName, 'src', 'data');
  const pagesDir = path.join(rootDir, 'src', projectName, 'pages');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.mkdir(pagesDir, { recursive: true });
  await fsp.writeFile(
    path.join(pagesDir, 'demo-screen.spec.json'),
    JSON.stringify({
      schemaVersion: '1.0',
      screen: { id: 'demo-screen', path: '/' },
      states: [{ id: 'default', name: '初期', viewer: { visible: true, order: 1 } }],
    }),
    'utf8',
  );
  for (const [screenId, doc] of Object.entries(initialDocs)) {
    writeDescriptionFile(dataDir, screenId, doc);
  }
  return { rootDir, projectName, dataDir };
}

async function startTreeApiServer(options) {
  const port = await getFreePort();
  const api = createDescriptionTreeApi({ ...options, port });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    await api.handleRequest(req, res, {
      pathname: url.pathname,
      method: req.method,
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function treePath(screenId, suffix = '') {
  return `${DESCRIPTION_TREE_API_PREFIX}/${encodeURIComponent(screenId)}${suffix}`;
}

describe('description-tree API', () => {
  /** @type {import('../jskim-screen-spec/dist/index.js')} */
  let companion = null;
  /** @type {Array<{ close: Function, cleanup: Function }>} */
  const sessions = [];

  before(async () => {
    companion = await import(pathToFileURL(COMPANION_ENTRY).href);
  });

  after(async () => {
    for (const session of sessions) {
      await session.close().catch(() => {});
      await session.cleanup().catch(() => {});
    }
  });

  async function openSession(initialDocs) {
    const workspace = await createWorkspace(initialDocs);
    const { rootDir, projectName } = workspace;
    const server = await startTreeApiServer({
      rootDir,
      projectName,
      host: '127.0.0.1',
      listScreenIds: () => ['demo-screen'],
      facade: {
        readDescriptionTreeState: companion.readDescriptionTreeState,
        readDescriptionRevision: companion.readDescriptionRevision,
        createDescriptionGroup: companion.createDescriptionGroup,
        updateDescriptionGroup: companion.updateDescriptionGroup,
        moveDescriptionNode: companion.moveDescriptionNode,
        reorderDescriptionChildren: companion.reorderDescriptionChildren,
        deleteDescriptionGroup: companion.deleteDescriptionGroup,
        deleteDescriptionGroupSubtree: companion.deleteDescriptionGroupSubtree,
        collectCollectedItemIdsForScreen:
          companion.collectCollectedItemIdsForScreen,
        formatDescriptionTreeForApi: companion.formatDescriptionTreeForApi,
      },
    });
    sessions.push({
      close: server.close,
      cleanup: () => fsp.rm(rootDir, { recursive: true, force: true }),
    });
    return { ...workspace, port: server.port };
  }

  it('GET v1.2 を normalized tree として返し bytes/mtime を変更しない', async () => {
    const { dataDir, port } = await openSession({
      'demo-screen': {
        schemaVersion: '1.2',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        itemOrder: ['item-b', 'item-a'],
        items: {
          'item-a': emptyItem(),
          'item-b': emptyItem(),
        },
        excludedItems: {},
      },
    });
    const filePath = path.join(dataDir, 'demo-screen.json');
    const beforeStat = fs.statSync(filePath);
    const beforeBytes = fs.readFileSync(filePath);

    const res = await httpRequest({
      port,
      path: treePath('demo-screen'),
      headers: { Host: `127.0.0.1:${port}` },
    });
    assert.equal(res.status, 200);
    const json = parseJson(res);
    assert.match(json.revision, /^sha256:/);
    assert.equal(json.sourceSchemaVersion, '1.2');
    assert.equal(json.description.schemaVersion, '1.3');
    assert.deepEqual(json.description.rootNodes, [
      { type: 'item', id: 'item-b' },
      { type: 'item', id: 'item-a' },
    ]);
    assert.equal(JSON.stringify(json).includes('.lock'), false);
    assert.equal(JSON.stringify(json).includes('AppData'), false);

    const afterStat = fs.statSync(filePath);
    assert.equal(fs.readFileSync(filePath).equals(beforeBytes), true);
    assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);
  });

  it('POST createGroup で v1.2 → v1.3 lazy migration し 201 + revision を返す', async () => {
    const { rootDir, dataDir, port } = await openSession({
      'demo-screen': {
        schemaVersion: '1.2',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        itemOrder: ['item-a'],
        items: { 'item-a': emptyItem() },
        excludedItems: {},
      },
    });
    const revision = companion.readDescriptionRevision(
      rootDir,
      'demo',
      'demo-screen',
    );
    const res = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/groups'),
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedRevision: revision,
        groupId: 'section',
        name: 'Section',
        kind: 'SECTION',
      }),
    });
    assert.equal(res.status, 201);
    const json = parseJson(res);
    assert.equal(json.status, 'updated');
    assert.match(json.revision, /^sha256:/);
    const saved = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'demo-screen.json'), 'utf8'),
    );
    assert.equal(saved.schemaVersion, '1.3');
    assert.equal(saved.itemOrder, undefined);
  });

  it('PATCH updateGroup で metadata を更新し unchanged も返す', async () => {
    const { rootDir, port } = await openSession({
      'demo-screen': {
        schemaVersion: '1.3',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        rootNodes: [{ type: 'group', id: 'section' }],
        groups: [
          {
            groupId: 'section',
            name: 'Old',
            kind: 'SECTION',
            children: [],
          },
        ],
        items: {},
        excludedItems: {},
      },
    });
    let revision = companion.readDescriptionRevision(rootDir, 'demo', 'demo-screen');
    const update = await httpRequest({
      port,
      method: 'PATCH',
      path: treePath('demo-screen', '/groups/section'),
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedRevision: revision,
        name: 'New',
      }),
    });
    assert.equal(update.status, 200);
    assert.equal(parseJson(update).status, 'updated');
    revision = parseJson(update).revision;

    const unchanged = await httpRequest({
      port,
      method: 'PATCH',
      path: treePath('demo-screen', '/groups/section'),
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedRevision: revision,
        name: 'New',
      }),
    });
    assert.equal(unchanged.status, 200);
    assert.equal(parseJson(unchanged).status, 'unchanged');
    assert.equal(parseJson(unchanged).revision, revision);
  });

  it('PATCH updateGroup は body groupId を拒否する', async () => {
    const { rootDir, port } = await openSession({
      'demo-screen': {
        schemaVersion: '1.3',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        rootNodes: [{ type: 'group', id: 'section' }],
        groups: [{ groupId: 'section', name: 'S', kind: 'SECTION', children: [] }],
        items: {},
        excludedItems: {},
      },
    });
    const revision = companion.readDescriptionRevision(rootDir, 'demo', 'demo-screen');
    const res = await httpRequest({
      port,
      method: 'PATCH',
      path: treePath('demo-screen', '/groups/section'),
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedRevision: revision,
        groupId: 'other',
        name: 'X',
      }),
    });
    assert.equal(res.status, 400);
    assert.equal(parseJson(res).code, 'SPEC_DESCRIPTION_INVALID');
  });

  it('stale revision と unknown field を 409/400 で返す', async () => {
    const { port } = await openSession({
      'demo-screen': {
        schemaVersion: '1.3',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        rootNodes: [],
        groups: [],
        items: {},
        excludedItems: {},
      },
    });
    const conflict = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/groups'),
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedRevision: 'sha256:deadbeef',
        groupId: 'section',
        name: 'Section',
        kind: 'SECTION',
      }),
    });
    assert.equal(conflict.status, 409);
    assert.equal(parseJson(conflict).code, 'SPEC_DESCRIPTION_REVISION_CONFLICT');

    const unknown = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/groups'),
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedRevision: 'sha256:deadbeef',
        groupId: 'section',
        name: 'Section',
        kind: 'SECTION',
        force: true,
      }),
    });
    assert.equal(unknown.status, 400);
    assert.match(parseJson(unknown).message, /force/);
  });

  it('route/method 境界と screen not found', async () => {
    const { port } = await openSession({
      'demo-screen': {
        schemaVersion: '1.3',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        rootNodes: [],
        groups: [],
        items: {},
        excludedItems: {},
      },
    });

    const postTree = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen'),
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(postTree.status, 405);

    const missing = await httpRequest({
      port,
      path: treePath('missing-screen'),
      headers: { Host: `127.0.0.1:${port}` },
    });
    assert.equal(missing.status, 404);
    assert.equal(parseJson(missing).code, 'SPEC_DESCRIPTION_SCREEN_NOT_FOUND');

    const subroute = await httpRequest({
      port,
      path: `${DESCRIPTION_TREE_API_PREFIX}/demo-screen/unknown`,
      headers: { Host: `127.0.0.1:${port}` },
    });
    assert.equal(subroute.status, 404);
    assert.equal(parseJson(subroute).code, 'SPEC_DESCRIPTION_TREE_ROUTE_NOT_FOUND');
  });

  it('v1.3 legacy PUT は拒否し Group API は許可する', async () => {
    const workspace = await createWorkspace({
      'demo-screen': {
        schemaVersion: '1.3',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        rootNodes: [],
        groups: [],
        items: {},
        excludedItems: {},
      },
    });
    const { rootDir } = workspace;
    const store = companion.createFileDescriptionStore({
      rootDir,
      projectName: 'demo',
      listScreenIds: () => ['demo-screen'],
    });
    const port = await getFreePort();
    const editApi = createDescriptionEditApi({
      store,
      host: '127.0.0.1',
      port,
    });
    const treeApi = createDescriptionTreeApi({
      rootDir,
      projectName: 'demo',
      host: '127.0.0.1',
      port,
      listScreenIds: () => ['demo-screen'],
      facade: {
        readDescriptionTreeState: companion.readDescriptionTreeState,
        readDescriptionRevision: companion.readDescriptionRevision,
        createDescriptionGroup: companion.createDescriptionGroup,
        updateDescriptionGroup: companion.updateDescriptionGroup,
        moveDescriptionNode: companion.moveDescriptionNode,
        reorderDescriptionChildren: companion.reorderDescriptionChildren,
        deleteDescriptionGroup: companion.deleteDescriptionGroup,
        deleteDescriptionGroupSubtree: companion.deleteDescriptionGroupSubtree,
        collectCollectedItemIdsForScreen:
          companion.collectCollectedItemIdsForScreen,
        formatDescriptionTreeForApi: companion.formatDescriptionTreeForApi,
      },
    });
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const meta = { pathname: url.pathname, method: req.method };
      if (await editApi.handleRequest(req, res, meta)) return;
      await treeApi.handleRequest(req, res, meta);
    });
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    sessions.push({
      close: () =>
        new Promise((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        }),
      cleanup: () => fsp.rm(rootDir, { recursive: true, force: true }),
    });

    const revision = companion.readDescriptionRevision(rootDir, 'demo', 'demo-screen');
    const put = await httpRequest({
      port,
      method: 'PUT',
      path: '/_jskim/spec/descriptions/demo-screen',
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedRevision: revision,
        document: {
          schemaVersion: '1.2',
          screen: { id: 'demo-screen', name: 'Demo', description: '' },
          itemOrder: [],
          items: {},
          excludedItems: {},
        },
      }),
    });
    assert.equal(put.status, 409);
    assert.equal(parseJson(put).code, 'SPEC_DESCRIPTION_UNSUPPORTED_SCHEMA');

    const create = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/groups'),
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedRevision: revision,
        groupId: 'section',
        name: 'Section',
        kind: 'SECTION',
      }),
    });
    assert.equal(create.status, 201);
  });

  it('mapDescriptionTreeStatus は domain code のみで HTTP status を決める', () => {
    assert.equal(mapDescriptionTreeStatus('SPEC_DESCRIPTION_NOT_FOUND'), 404);
    assert.equal(mapDescriptionTreeStatus('SPEC_DESCRIPTION_GROUP_NOT_FOUND'), 404);
    assert.equal(mapDescriptionTreeStatus('SPEC_DESCRIPTION_GROUP_PARENT_NOT_FOUND'), 404);
    assert.equal(mapDescriptionTreeStatus('SPEC_DESCRIPTION_SCREEN_NOT_FOUND'), 404);
    assert.equal(mapDescriptionTreeStatus('SPEC_DESCRIPTION_INVALID'), 400);
    assert.equal(mapDescriptionTreeStatus('SPEC_DESCRIPTION_REVISION_REQUIRED'), 400);
    assert.equal(mapDescriptionTreeStatus('SPEC_DESCRIPTION_GROUP_INSERT_INDEX_INVALID'), 400);
    assert.equal(mapDescriptionTreeStatus('SPEC_DESCRIPTION_GROUP_DEPTH_EXCEEDED'), 400);
    assert.equal(mapDescriptionTreeStatus('SPEC_DESCRIPTION_REVISION_CONFLICT'), 409);
    assert.equal(mapDescriptionTreeStatus('SPEC_DESCRIPTION_GROUP_ALREADY_EXISTS'), 409);
    assert.equal(mapDescriptionTreeStatus('SPEC_DESCRIPTION_NODE_ID_CONFLICT'), 409);
    assert.equal(mapDescriptionTreeStatus('SPEC_DESCRIPTION_MUTATION_IN_PROGRESS'), 409);
    assert.equal(mapDescriptionTreeStatus('SPEC_DESCRIPTION_NODE_NOT_FOUND'), 404);
    assert.equal(mapDescriptionTreeStatus('SPEC_DESCRIPTION_REORDER_MISMATCH'), 400);
    assert.equal(mapDescriptionTreeStatus('SPEC_DESCRIPTION_GROUP_CYCLE'), 409);
    assert.equal(
      mapDescriptionTreeStatus('SPEC_DESCRIPTION_GROUP_SUBTREE_CONTAINS_COLLECTED_ITEM'),
      409,
    );
    assert.equal(
      mapDescriptionTreeStatus('SPEC_DESCRIPTION_COLLECTED_STATE_UNAVAILABLE'),
      500,
    );
    assert.equal(mapDescriptionTreeStatus('SPEC_DESCRIPTION_INTERNAL'), 500);
    assert.equal(mapDescriptionTreeStatus('SPEC_UNEXPECTED'), 500);
  });

  it('Description ファイル無し GET は 404 SPEC_DESCRIPTION_NOT_FOUND', async () => {
    const { port } = await openSession({});
    const res = await httpRequest({
      port,
      path: treePath('demo-screen'),
      headers: { Host: `127.0.0.1:${port}` },
    });
    assertErrorHygiene(res, 404, 'SPEC_DESCRIPTION_NOT_FOUND');
  });

  it('domain / unexpected エラー応答は path / stack / lock を露出しない', async () => {
    const { rootDir, port } = await openSession({
      'demo-screen': {
        schemaVersion: '1.3',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        rootNodes: [],
        groups: [],
        items: {},
        excludedItems: {},
      },
    });
    const revision = companion.readDescriptionRevision(rootDir, 'demo', 'demo-screen');
    const headers = {
      Host: `127.0.0.1:${port}`,
      Origin: `http://127.0.0.1:${port}`,
      'Content-Type': 'application/json',
    };

    const invalid = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/groups'),
      headers,
      body: JSON.stringify({
        expectedRevision: revision,
        groupId: 'section',
        name: 'Section',
        kind: 'SECTION',
        force: true,
      }),
    });
    assertErrorHygiene(invalid, 400, 'SPEC_DESCRIPTION_INVALID');

    const missingGroup = await httpRequest({
      port,
      method: 'PATCH',
      path: treePath('demo-screen', '/groups/missing-group'),
      headers,
      body: JSON.stringify({
        expectedRevision: revision,
        name: 'New',
      }),
    });
    assertErrorHygiene(missingGroup, 404, 'SPEC_DESCRIPTION_GROUP_NOT_FOUND');

    const brokenPort = await getFreePort();
    const brokenApi = createDescriptionTreeApi({
      rootDir,
      projectName: 'demo',
      host: '127.0.0.1',
      port: brokenPort,
      listScreenIds: () => ['demo-screen'],
      facade: {
        readDescriptionTreeState: () => {
          const err = new Error(
            'ENOENT: C:\\Users\\secret\\temp.lock cause=internal',
          );
          err.stack = 'Error: secret stack at C:\\Users\\secret\\file.js:1:1';
          throw err;
        },
        readDescriptionRevision: companion.readDescriptionRevision,
        createDescriptionGroup: companion.createDescriptionGroup,
        updateDescriptionGroup: companion.updateDescriptionGroup,
        moveDescriptionNode: companion.moveDescriptionNode,
        reorderDescriptionChildren: companion.reorderDescriptionChildren,
        deleteDescriptionGroup: companion.deleteDescriptionGroup,
        deleteDescriptionGroupSubtree: companion.deleteDescriptionGroupSubtree,
        collectCollectedItemIdsForScreen:
          companion.collectCollectedItemIdsForScreen,
        formatDescriptionTreeForApi: companion.formatDescriptionTreeForApi,
      },
    });
    const brokenServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      await brokenApi.handleRequest(req, res, {
        pathname: url.pathname,
        method: req.method,
      });
    });
    await new Promise((resolve) =>
      brokenServer.listen(brokenPort, '127.0.0.1', resolve),
    );
    sessions.push({
      close: () =>
        new Promise((resolve, reject) => {
          brokenServer.close((err) => (err ? reject(err) : resolve()));
        }),
      cleanup: async () => {},
    });

    const internal = await httpRequest({
      port: brokenPort,
      path: treePath('demo-screen'),
      headers: { Host: `127.0.0.1:${brokenPort}` },
    });
    const internalJson = assertErrorHygiene(
      internal,
      500,
      'SPEC_DESCRIPTION_INTERNAL',
    );
    assert.equal(
      internalJson.message,
      'Description Item Tree の処理中にエラーが発生しました。',
    );
    assert.equal(internalJson.message.includes('ENOENT'), false);
    assert.equal(internalJson.message.includes('secret'), false);
  });

  it('同一 revision の並行 POST createGroup は 1 成功 1 conflict', async () => {
    const { rootDir, dataDir, port } = await openSession({
      'demo-screen': {
        schemaVersion: '1.3',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        rootNodes: [],
        groups: [],
        items: {},
        excludedItems: {},
      },
    });
    const revision = companion.readDescriptionRevision(
      rootDir,
      'demo',
      'demo-screen',
    );
    const headers = {
      Host: `127.0.0.1:${port}`,
      Origin: `http://127.0.0.1:${port}`,
      'Content-Type': 'application/json',
    };
    const [first, second] = await Promise.all([
      httpRequest({
        port,
        method: 'POST',
        path: treePath('demo-screen', '/groups'),
        headers,
        body: JSON.stringify({
          expectedRevision: revision,
          groupId: 'group-a',
          name: 'A',
          kind: 'SECTION',
        }),
      }),
      httpRequest({
        port,
        method: 'POST',
        path: treePath('demo-screen', '/groups'),
        headers,
        body: JSON.stringify({
          expectedRevision: revision,
          groupId: 'group-b',
          name: 'B',
          kind: 'SECTION',
        }),
      }),
    ]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    const bodies = [parseJson(first), parseJson(second)];
    const created = bodies.find((body) => body.status === 'updated');
    const conflict = bodies.find((body) => body.code === 'SPEC_DESCRIPTION_REVISION_CONFLICT');
    assert.ok(created);
    assert.ok(conflict);
    assert.match(created.revision, /^sha256:/);

    const saved = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'demo-screen.json'), 'utf8'),
    );
    assert.equal(saved.groups.length, 1);
    assert.equal(JSON.stringify(saved).includes('.lock'), false);

    const lockDir = path.join(
      rootDir,
      'spec',
      'demo',
      '.jskim',
      'description-mutation',
    );
    if (fs.existsSync(lockDir)) {
      assert.deepEqual(fs.readdirSync(lockDir), []);
    }

    const followUp = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/groups'),
      headers,
      body: JSON.stringify({
        expectedRevision: created.revision,
        groupId: 'group-c',
        name: 'C',
        kind: 'SECTION',
      }),
    });
    assert.equal(followUp.status, 201);
    assert.equal(parseJson(followUp).status, 'updated');
    const afterFollowUp = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'demo-screen.json'), 'utf8'),
    );
    assert.equal(afterFollowUp.groups.length, 2);
  });
});
