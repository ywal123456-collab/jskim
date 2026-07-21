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
} = require('../scripts/lib/create-description-tree-api');
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

function parseJson(res) {
  return JSON.parse(res.body.toString('utf8'));
}

function treePath(screenId, suffix = '') {
  return `${DESCRIPTION_TREE_API_PREFIX}/${encodeURIComponent(screenId)}${suffix}`;
}

function jsonHeaders(port) {
  return {
    Host: `127.0.0.1:${port}`,
    Origin: `http://127.0.0.1:${port}`,
    'Content-Type': 'application/json',
  };
}

async function createWorkspace(initialDocs = {}) {
  const rootDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'jskim-tree-mutation-api-'),
  );
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
    fs.writeFileSync(
      path.join(dataDir, `${screenId}.json`),
      `${JSON.stringify(doc, null, 2)}\n`,
      'utf8',
    );
  }
  return { rootDir, projectName, dataDir };
}

function writeSnapshot(rootDir, html) {
  const dir = path.join(rootDir, 'spec', 'demo', 'src', 'snapshots', 'demo-screen');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'default.html'), html, 'utf8');
}

function promotionTreeDoc() {
  return {
    schemaVersion: '1.3',
    screen: { id: 'demo-screen', name: 'Demo', description: '' },
    rootNodes: [
      { type: 'item', id: 'item-a' },
      { type: 'group', id: 'group-x' },
      { type: 'item', id: 'item-d' },
    ],
    groups: [
      {
        groupId: 'group-x',
        name: 'X',
        kind: 'SECTION',
        children: [
          { type: 'item', id: 'item-b' },
          { type: 'group', id: 'group-y' },
          { type: 'item', id: 'item-c' },
        ],
      },
      {
        groupId: 'group-y',
        name: 'Y',
        kind: 'SECTION',
        children: [{ type: 'item', id: 'item-y' }],
      },
    ],
    items: {
      'item-a': emptyItem(),
      'item-b': emptyItem(),
      'item-c': emptyItem(),
      'item-d': emptyItem(),
      'item-y': emptyItem(),
    },
    excludedItems: { 'excluded-item': emptyItem() },
  };
}

function moveFixtureDoc() {
  return {
    schemaVersion: '1.3',
    screen: { id: 'demo-screen', name: 'Demo', description: '' },
    rootNodes: [
      { type: 'item', id: 'item-a' },
      { type: 'item', id: 'item-b' },
      { type: 'group', id: 'section' },
      { type: 'group', id: 'outer' },
    ],
    groups: [
      {
        groupId: 'section',
        name: 'Section',
        kind: 'SECTION',
        children: [{ type: 'item', id: 'item-c' }],
      },
      {
        groupId: 'outer',
        name: 'Outer',
        kind: 'SECTION',
        children: [{ type: 'group', id: 'inner' }],
      },
      {
        groupId: 'inner',
        name: 'Inner',
        kind: 'SECTION',
        children: [],
      },
    ],
    items: {
      'item-a': emptyItem(),
      'item-b': emptyItem(),
      'item-c': emptyItem(),
    },
    excludedItems: { 'excluded-item': emptyItem() },
  };
}

describe('description-tree mutation API', () => {
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
    const port = await getFreePort();
    const api = createDescriptionTreeApi({
      rootDir,
      projectName,
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
        createDescriptionItem: companion.createDescriptionItem,
        updateDescriptionItem: companion.updateDescriptionItem,
        collectCollectedItemIdsForScreen:
          companion.collectCollectedItemIdsForScreen,
        formatDescriptionTreeForApi: companion.formatDescriptionTreeForApi,
      },
    });
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      await api.handleRequest(req, res, {
        pathname: url.pathname,
        method: req.method,
      });
    });
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    sessions.push({
      close: () =>
        new Promise((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        }),
      cleanup: () => fsp.rm(rootDir, { recursive: true, force: true }),
    });
    return { ...workspace, port };
  }

  async function getTree(port) {
    const res = await httpRequest({
      port,
      path: treePath('demo-screen'),
      headers: { Host: `127.0.0.1:${port}` },
    });
    assert.equal(res.status, 200);
    return parseJson(res);
  }

  async function assertRevisionAligned(rootDir, port, mutationJson, beforeRevision) {
    const persisted = companion.readDescriptionRevision(rootDir, 'demo', 'demo-screen');
    assert.equal(mutationJson.revision, persisted);
    const tree = await getTree(port);
    assert.equal(tree.revision, mutationJson.revision);
    if (mutationJson.status === 'unchanged') {
      assert.equal(mutationJson.revision, beforeRevision);
    } else {
      assert.notEqual(mutationJson.revision, beforeRevision);
    }
  }

  function assertNoLockResidue(rootDir) {
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
  }

  it('moveNode: root reorder / cross-parent / unchanged / tail insert', async () => {
    const { rootDir, port } = await openSession({ 'demo-screen': moveFixtureDoc() });
    const before = await getTree(port);
    const headers = jsonHeaders(port);

    const reorder = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/nodes/move'),
      headers,
      body: JSON.stringify({
        expectedRevision: before.revision,
        node: { type: 'item', id: 'item-b' },
        destinationParentGroupId: null,
        insertIndex: 0,
      }),
    });
    assert.equal(reorder.status, 200);
    const reorderJson = parseJson(reorder);
    assert.equal(reorderJson.status, 'updated');
    await assertRevisionAligned(rootDir, port, reorderJson, before.revision);
    let tree = await getTree(port);
    assert.deepEqual(tree.description.rootNodes.slice(0, 2), [
      { type: 'item', id: 'item-b' },
      { type: 'item', id: 'item-a' },
    ]);

    const intoGroup = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/nodes/move'),
      headers,
      body: JSON.stringify({
        expectedRevision: tree.revision,
        node: { type: 'item', id: 'item-a' },
        destinationParentGroupId: 'section',
        insertIndex: 0,
      }),
    });
    assert.equal(intoGroup.status, 200);
    tree = await getTree(port);
    const section = tree.description.groups.find((g) => g.groupId === 'section');
    assert.deepEqual(section.children.slice(0, 2), [
      { type: 'item', id: 'item-a' },
      { type: 'item', id: 'item-c' },
    ]);

    const toRoot = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/nodes/move'),
      headers,
      body: JSON.stringify({
        expectedRevision: tree.revision,
        node: { type: 'item', id: 'item-c' },
        destinationParentGroupId: null,
        insertIndex: 0,
      }),
    });
    assert.equal(toRoot.status, 200);
    tree = await getTree(port);
    assert.equal(tree.description.rootNodes[0].id, 'item-c');

    const moveGroup = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/nodes/move'),
      headers,
      body: JSON.stringify({
        expectedRevision: tree.revision,
        node: { type: 'group', id: 'inner' },
        destinationParentGroupId: 'section',
      }),
    });
    assert.equal(moveGroup.status, 200);
    tree = await getTree(port);
    assert.deepEqual(
      tree.description.groups.find((g) => g.groupId === 'section').children,
      [
        { type: 'item', id: 'item-a' },
        { type: 'group', id: 'inner' },
      ],
    );

    const unchanged = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/nodes/move'),
      headers,
      body: JSON.stringify({
        expectedRevision: tree.revision,
        node: { type: 'group', id: 'inner' },
        destinationParentGroupId: 'section',
        insertIndex: 1,
      }),
    });
    assert.equal(unchanged.status, 200);
    const unchangedJson = parseJson(unchanged);
    assert.equal(unchangedJson.status, 'unchanged');
    assert.equal(unchangedJson.revision, tree.revision);
  });

  it('moveNode: v1.2 lazy migration', async () => {
    const { rootDir, dataDir, port } = await openSession({
      'demo-screen': {
        schemaVersion: '1.2',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        itemOrder: ['item-b', 'item-a'],
        items: { 'item-a': emptyItem(), 'item-b': emptyItem() },
        excludedItems: {},
      },
    });
    const before = await getTree(port);
    const res = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/nodes/move'),
      headers: jsonHeaders(port),
      body: JSON.stringify({
        expectedRevision: before.revision,
        node: { type: 'item', id: 'item-a' },
        destinationParentGroupId: null,
        insertIndex: 0,
      }),
    });
    assert.equal(res.status, 200);
    const saved = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'demo-screen.json'), 'utf8'),
    );
    assert.equal(saved.schemaVersion, '1.3');
    assert.equal(saved.itemOrder, undefined);
    await assertRevisionAligned(rootDir, port, parseJson(res), before.revision);
  });

  it('moveNode: domain エラー mapping', async () => {
    const { rootDir, dataDir, port } = await openSession({ 'demo-screen': moveFixtureDoc() });
    const before = await getTree(port);
    const headers = jsonHeaders(port);
    const filePath = path.join(dataDir, 'demo-screen.json');
    const beforeBytes = fs.readFileSync(filePath);
    const beforeMtime = fs.statSync(filePath).mtimeMs;

    const cases = [
      [
        {
          expectedRevision: before.revision,
          node: { type: 'item', id: 'missing' },
          destinationParentGroupId: null,
        },
        404,
        'SPEC_DESCRIPTION_NODE_NOT_FOUND',
      ],
      [
        {
          expectedRevision: before.revision,
          node: { type: 'item', id: 'section' },
          destinationParentGroupId: null,
        },
        404,
        'SPEC_DESCRIPTION_NODE_NOT_FOUND',
      ],
      [
        {
          expectedRevision: before.revision,
          node: { type: 'item', id: 'item-a' },
          destinationParentGroupId: 'missing-group',
        },
        404,
        'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
      ],
      [
        {
          expectedRevision: before.revision,
          node: { type: 'item', id: 'item-a' },
          destinationParentGroupId: null,
          insertIndex: -1,
        },
        400,
        'SPEC_DESCRIPTION_GROUP_INSERT_INDEX_INVALID',
      ],
      [
        {
          expectedRevision: before.revision,
          node: { type: 'item', id: 'item-a' },
          destinationParentGroupId: null,
          insertIndex: 1.5,
        },
        400,
        'SPEC_DESCRIPTION_GROUP_INSERT_INDEX_INVALID',
      ],
      [
        {
          expectedRevision: before.revision,
          node: { type: 'item', id: 'item-a' },
          destinationParentGroupId: null,
          insertIndex: 99,
        },
        400,
        'SPEC_DESCRIPTION_GROUP_INSERT_INDEX_INVALID',
      ],
      [
        {
          expectedRevision: before.revision,
          node: { type: 'group', id: 'outer' },
          destinationParentGroupId: 'inner',
        },
        409,
        'SPEC_DESCRIPTION_GROUP_CYCLE',
      ],
      [
        {
          expectedRevision: before.revision,
          node: { type: 'item', id: 'excluded-item' },
          destinationParentGroupId: null,
        },
        404,
        'SPEC_DESCRIPTION_NODE_NOT_FOUND',
      ],
      [
        {
          expectedRevision: before.revision,
          node: { type: 'item', id: 'item-a' },
          destinationParentGroupId: null,
          force: true,
        },
        400,
        'SPEC_DESCRIPTION_INVALID',
      ],
      [
        {
          expectedRevision: before.revision,
          node: { type: 'item', id: 'item-a', extra: true },
          destinationParentGroupId: null,
        },
        400,
        'SPEC_DESCRIPTION_INVALID',
      ],
    ];

    for (const [body, status, code] of cases) {
      const res = await httpRequest({
        port,
        method: 'POST',
        path: treePath('demo-screen', '/nodes/move'),
        headers,
        body: JSON.stringify(body),
      });
      assert.equal(res.status, status, JSON.stringify(body));
      assert.equal(parseJson(res).code, code);
    }

    assert.equal(fs.readFileSync(filePath).equals(beforeBytes), true);
    assert.equal(fs.statSync(filePath).mtimeMs, beforeMtime);
    assertNoLockResidue(rootDir);
  });

  it('moveNode: depth 超過は 400 GROUP_DEPTH_EXCEEDED', async () => {
    const groups = [];
    for (let i = 1; i <= 8; i += 1) {
      groups.push({
        groupId: `g${i}`,
        name: `G${i}`,
        kind: 'SECTION',
        children: i < 8 ? [{ type: 'group', id: `g${i + 1}` }] : [],
      });
    }
    const { port } = await openSession({
      'demo-screen': {
        schemaVersion: '1.3',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        rootNodes: [{ type: 'group', id: 'anchor' }, { type: 'group', id: 'g1' }],
        groups: [
          { groupId: 'anchor', name: 'Anchor', kind: 'SECTION', children: [] },
          ...groups,
        ],
        items: {},
        excludedItems: {},
      },
    });
    const before = await getTree(port);
    const res = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/nodes/move'),
      headers: jsonHeaders(port),
      body: JSON.stringify({
        expectedRevision: before.revision,
        node: { type: 'group', id: 'g1' },
        destinationParentGroupId: 'anchor',
      }),
    });
    assert.equal(res.status, 400);
    assert.equal(parseJson(res).code, 'SPEC_DESCRIPTION_GROUP_DEPTH_EXCEEDED');
  });

  it('reorderChildren: root / group / unchanged / empty', async () => {
    const { rootDir, port } = await openSession({ 'demo-screen': moveFixtureDoc() });
    const before = await getTree(port);
    const headers = jsonHeaders(port);

    const rootReorder = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/children/reorder'),
      headers,
      body: JSON.stringify({
        expectedRevision: before.revision,
        parentGroupId: null,
        orderedNodes: [
          { type: 'group', id: 'outer' },
          { type: 'item', id: 'item-b' },
          { type: 'item', id: 'item-a' },
          { type: 'group', id: 'section' },
        ],
      }),
    });
    assert.equal(rootReorder.status, 200);
    let tree = await getTree(port);
    assert.deepEqual(tree.description.rootNodes.map((n) => n.id), [
      'outer',
      'item-b',
      'item-a',
      'section',
    ]);

    const groupReorder = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/children/reorder'),
      headers,
      body: JSON.stringify({
        expectedRevision: tree.revision,
        parentGroupId: 'section',
        orderedNodes: [{ type: 'item', id: 'item-c' }],
      }),
    });
    assert.equal(groupReorder.status, 200);

    const unchanged = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/children/reorder'),
      headers,
      body: JSON.stringify({
        expectedRevision: tree.revision,
        parentGroupId: 'section',
        orderedNodes: [{ type: 'item', id: 'item-c' }],
      }),
    });
    assert.equal(unchanged.status, 200);
    const unchangedJson = parseJson(unchanged);
    assert.equal(unchangedJson.status, 'unchanged');
    assert.equal(unchangedJson.revision, tree.revision);

    const emptyRoot = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/children/reorder'),
      headers,
      body: JSON.stringify({
        expectedRevision: tree.revision,
        parentGroupId: 'inner',
        orderedNodes: [],
      }),
    });
    assert.equal(emptyRoot.status, 200);
    await assertRevisionAligned(rootDir, port, parseJson(emptyRoot), tree.revision);
  });

  it('reorderChildren: mismatch / stale / malformed', async () => {
    const { port } = await openSession({ 'demo-screen': moveFixtureDoc() });
    const before = await getTree(port);
    const headers = jsonHeaders(port);

    const duplicate = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/children/reorder'),
      headers,
      body: JSON.stringify({
        expectedRevision: before.revision,
        parentGroupId: null,
        orderedNodes: [
          { type: 'item', id: 'item-a' },
          { type: 'item', id: 'item-a' },
        ],
      }),
    });
    assert.equal(duplicate.status, 400);
    assert.equal(parseJson(duplicate).code, 'SPEC_DESCRIPTION_REORDER_MISMATCH');

    const missing = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/children/reorder'),
      headers,
      body: JSON.stringify({
        expectedRevision: before.revision,
        parentGroupId: null,
        orderedNodes: [{ type: 'item', id: 'item-a' }],
      }),
    });
    assert.equal(missing.status, 400);
    assert.equal(parseJson(missing).code, 'SPEC_DESCRIPTION_REORDER_MISMATCH');

    const wrongParent = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/children/reorder'),
      headers,
      body: JSON.stringify({
        expectedRevision: before.revision,
        parentGroupId: 'missing',
        orderedNodes: [{ type: 'item', id: 'item-c' }],
      }),
    });
    assert.equal(wrongParent.status, 404);
    assert.equal(parseJson(wrongParent).code, 'SPEC_DESCRIPTION_GROUP_NOT_FOUND');

    const typeMismatch = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/children/reorder'),
      headers,
      body: JSON.stringify({
        expectedRevision: before.revision,
        parentGroupId: null,
        orderedNodes: [{ type: 'group', id: 'item-a' }],
      }),
    });
    assert.equal(typeMismatch.status, 400);
    assert.equal(parseJson(typeMismatch).code, 'SPEC_DESCRIPTION_REORDER_MISMATCH');

    const notArray = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/children/reorder'),
      headers,
      body: JSON.stringify({
        expectedRevision: before.revision,
        parentGroupId: null,
        orderedNodes: 'bad',
      }),
    });
    assert.equal(notArray.status, 400);

    const stale = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/children/reorder'),
      headers,
      body: JSON.stringify({
        expectedRevision: 'sha256:deadbeef',
        parentGroupId: null,
        orderedNodes: [],
      }),
    });
    assert.equal(stale.status, 409);
    assert.equal(parseJson(stale).code, 'SPEC_DESCRIPTION_REVISION_CONFLICT');
  });

  it('deleteGroup: children 昇格と定義保持', async () => {
    const { rootDir, port } = await openSession({ 'demo-screen': promotionTreeDoc() });
    const before = await getTree(port);
    const res = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/groups/group-x/delete'),
      headers: jsonHeaders(port),
      body: JSON.stringify({ expectedRevision: before.revision }),
    });
    assert.equal(res.status, 200);
    const json = parseJson(res);
    assert.equal(json.status, 'updated');
    await assertRevisionAligned(rootDir, port, json, before.revision);

    const tree = await getTree(port);
    assert.deepEqual(tree.description.rootNodes, [
      { type: 'item', id: 'item-a' },
      { type: 'item', id: 'item-b' },
      { type: 'group', id: 'group-y' },
      { type: 'item', id: 'item-c' },
      { type: 'item', id: 'item-d' },
    ]);
    assert.equal(tree.description.groups.length, 1);
    assert.equal(tree.description.groups[0].groupId, 'group-y');
    assert.ok(tree.description.excludedItems['excluded-item']);
  });

  it('deleteGroup: 不存在 / body groupId 拒否 / v1.2 no migration', async () => {
    const { dataDir, port } = await openSession({
      'demo-screen': {
        schemaVersion: '1.2',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        itemOrder: ['item-a'],
        items: { 'item-a': emptyItem() },
        excludedItems: {},
      },
    });
    const before = await getTree(port);
    const filePath = path.join(dataDir, 'demo-screen.json');
    const beforeBytes = fs.readFileSync(filePath);

    const missing = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/groups/section/delete'),
      headers: jsonHeaders(port),
      body: JSON.stringify({ expectedRevision: before.revision }),
    });
    assert.equal(missing.status, 404);
    assert.equal(parseJson(missing).code, 'SPEC_DESCRIPTION_GROUP_NOT_FOUND');
    assert.equal(fs.readFileSync(filePath).equals(beforeBytes), true);

    const rejectBodyGroupId = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/groups/section/delete'),
      headers: jsonHeaders(port),
      body: JSON.stringify({
        expectedRevision: before.revision,
        groupId: 'section',
      }),
    });
    assert.equal(rejectBodyGroupId.status, 400);
  });

  it('deleteGroupSubtree: manual-only subtree 削除と collected 保護', async () => {
    const manualDoc = {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'group', id: 'section' }],
      groups: [
        {
          groupId: 'section',
          name: 'S',
          kind: 'SECTION',
          children: [
            { type: 'item', id: 'manual-a' },
            { type: 'group', id: 'nested' },
            { type: 'item', id: 'manual-b' },
          ],
        },
        {
          groupId: 'nested',
          name: 'N',
          kind: 'SECTION',
          children: [{ type: 'item', id: 'manual-n' }],
        },
      ],
      items: {
        'manual-a': emptyItem(),
        'manual-b': emptyItem(),
        'manual-n': emptyItem(),
      },
      excludedItems: { 'excluded-item': emptyItem() },
    };
    const { rootDir, dataDir, port } = await openSession({ 'demo-screen': manualDoc });
    const before = await getTree(port);
    const filePath = path.join(dataDir, 'demo-screen.json');
    const res = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/groups/section/delete-subtree'),
      headers: jsonHeaders(port),
      body: JSON.stringify({ expectedRevision: before.revision }),
    });
    assert.equal(res.status, 200);
    const json = parseJson(res);
    assert.equal(json.status, 'updated');
    await assertRevisionAligned(rootDir, port, json, before.revision);
    const tree = await getTree(port);
    assert.deepEqual(tree.description.rootNodes, []);
    assert.equal(tree.description.groups.length, 0);
    assert.equal(Object.keys(tree.description.items).length, 0);
    assert.ok(tree.description.excludedItems['excluded-item']);

    const collectedDoc = {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'group', id: 'section' }],
      groups: [
        {
          groupId: 'section',
          name: 'S',
          kind: 'SECTION',
          children: [
            { type: 'item', id: 'manual-item' },
            { type: 'item', id: 'collected-item' },
          ],
        },
      ],
      items: {
        'manual-item': emptyItem(),
        'collected-item': emptyItem(),
      },
      excludedItems: {},
    };
    const collectedSession = await openSession({ 'demo-screen': collectedDoc });
    writeSnapshot(collectedSession.rootDir, '<div data-jskim-spec-item="collected-item"></div>');
    const collectedBefore = await getTree(collectedSession.port);
    const collectedPath = path.join(collectedSession.dataDir, 'demo-screen.json');
    const collectedBytes = fs.readFileSync(collectedPath);
    const collectedMtime = fs.statSync(collectedPath).mtimeMs;

    const blocked = await httpRequest({
      port: collectedSession.port,
      method: 'POST',
      path: treePath('demo-screen', '/groups/section/delete-subtree'),
      headers: jsonHeaders(collectedSession.port),
      body: JSON.stringify({
        expectedRevision: collectedBefore.revision,
        collectedItemIds: ['manual-item'],
      }),
    });
    assert.equal(blocked.status, 400);
    assert.match(parseJson(blocked).message, /collectedItemIds/);

    const protectedRes = await httpRequest({
      port: collectedSession.port,
      method: 'POST',
      path: treePath('demo-screen', '/groups/section/delete-subtree'),
      headers: jsonHeaders(collectedSession.port),
      body: JSON.stringify({ expectedRevision: collectedBefore.revision }),
    });
    assert.equal(protectedRes.status, 409);
    assert.equal(
      parseJson(protectedRes).code,
      'SPEC_DESCRIPTION_GROUP_SUBTREE_CONTAINS_COLLECTED_ITEM',
    );
    assert.equal(fs.readFileSync(collectedPath).equals(collectedBytes), true);
    assert.equal(fs.statSync(collectedPath).mtimeMs, collectedMtime);
    assert.equal((await getTree(collectedSession.port)).revision, collectedBefore.revision);
    assertNoLockResidue(collectedSession.rootDir);

    const followUp = await httpRequest({
      port: collectedSession.port,
      method: 'POST',
      path: treePath('demo-screen', '/groups/section/delete'),
      headers: jsonHeaders(collectedSession.port),
      body: JSON.stringify({ expectedRevision: collectedBefore.revision }),
    });
    assert.equal(followUp.status, 200);
  });

  it('route/method 境界', async () => {
    const { port } = await openSession({ 'demo-screen': moveFixtureDoc() });
    const headers = jsonHeaders(port);

    const getMove = await httpRequest({
      port,
      path: treePath('demo-screen', '/nodes/move'),
      headers: { Host: `127.0.0.1:${port}` },
    });
    assert.equal(getMove.status, 405);

    const deleteMove = await httpRequest({
      port,
      method: 'DELETE',
      path: treePath('demo-screen', '/nodes/move'),
      headers,
      body: JSON.stringify({ expectedRevision: 'sha256:x' }),
    });
    assert.equal(deleteMove.status, 405);

    const patchReorder = await httpRequest({
      port,
      method: 'PATCH',
      path: treePath('demo-screen', '/children/reorder'),
      headers,
      body: '{}',
    });
    assert.equal(patchReorder.status, 405);

    const deleteGroupDelete = await httpRequest({
      port,
      method: 'DELETE',
      path: treePath('demo-screen', '/groups/section/delete'),
      headers,
      body: JSON.stringify({ expectedRevision: 'sha256:x' }),
    });
    assert.equal(deleteGroupDelete.status, 405);

    const patchSubtree = await httpRequest({
      port,
      method: 'PATCH',
      path: treePath('demo-screen', '/groups/section/delete-subtree'),
      headers,
      body: '{}',
    });
    assert.equal(patchSubtree.status, 405);

    const extraSubtree = await httpRequest({
      port,
      path: treePath('demo-screen', '/groups/section/delete-subtree-extra'),
      headers: { Host: `127.0.0.1:${port}` },
    });
    assert.equal(extraSubtree.status, 404);
    assert.equal(parseJson(extraSubtree).code, 'SPEC_DESCRIPTION_TREE_ROUTE_NOT_FOUND');
  });

  it('HTTP CAS: move vs reorder / delete vs update / deleteSubtree vs move', async () => {
    const { rootDir, port } = await openSession({ 'demo-screen': moveFixtureDoc() });
    const before = await getTree(port);
    const headers = jsonHeaders(port);

    const [moveRes, reorderRes] = await Promise.all([
      httpRequest({
        port,
        method: 'POST',
        path: treePath('demo-screen', '/nodes/move'),
        headers,
        body: JSON.stringify({
          expectedRevision: before.revision,
          node: { type: 'item', id: 'item-a' },
          destinationParentGroupId: null,
          insertIndex: 2,
        }),
      }),
      httpRequest({
        port,
        method: 'POST',
        path: treePath('demo-screen', '/children/reorder'),
        headers,
        body: JSON.stringify({
          expectedRevision: before.revision,
          parentGroupId: null,
          orderedNodes: [
            { type: 'item', id: 'item-b' },
            { type: 'item', id: 'item-a' },
            { type: 'group', id: 'section' },
            { type: 'group', id: 'outer' },
          ],
        }),
      }),
    ]);
    assert.deepEqual([moveRes.status, reorderRes.status].sort(), [200, 409]);

    const deleteSession = await openSession({
      'demo-screen': {
        schemaVersion: '1.3',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        rootNodes: [{ type: 'group', id: 'section' }],
        groups: [{ groupId: 'section', name: 'S', kind: 'SECTION', children: [] }],
        items: {},
        excludedItems: {},
      },
    });
    const deleteBefore = await getTree(deleteSession.port);
    const [deleteRes, updateRes] = await Promise.all([
      httpRequest({
        port: deleteSession.port,
        method: 'POST',
        path: treePath('demo-screen', '/groups/section/delete'),
        headers: jsonHeaders(deleteSession.port),
        body: JSON.stringify({ expectedRevision: deleteBefore.revision }),
      }),
      httpRequest({
        port: deleteSession.port,
        method: 'PATCH',
        path: treePath('demo-screen', '/groups/section'),
        headers: jsonHeaders(deleteSession.port),
        body: JSON.stringify({
          expectedRevision: deleteBefore.revision,
          name: 'Renamed',
        }),
      }),
    ]);
    assert.deepEqual([deleteRes.status, updateRes.status].sort(), [200, 409]);
    assertNoLockResidue(deleteSession.rootDir);

    const subtreeSession = await openSession({
      'demo-screen': {
        schemaVersion: '1.3',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        rootNodes: [{ type: 'group', id: 'section' }],
        groups: [
          {
            groupId: 'section',
            name: 'S',
            kind: 'SECTION',
            children: [{ type: 'item', id: 'manual-only' }],
          },
        ],
        items: { 'manual-only': emptyItem() },
        excludedItems: {},
      },
    });
    const subtreeBefore = await getTree(subtreeSession.port);
    const [subtreeRes, moveRes2] = await Promise.all([
      httpRequest({
        port: subtreeSession.port,
        method: 'POST',
        path: treePath('demo-screen', '/groups/section/delete-subtree'),
        headers: jsonHeaders(subtreeSession.port),
        body: JSON.stringify({ expectedRevision: subtreeBefore.revision }),
      }),
      httpRequest({
        port: subtreeSession.port,
        method: 'POST',
        path: treePath('demo-screen', '/nodes/move'),
        headers: jsonHeaders(subtreeSession.port),
        body: JSON.stringify({
          expectedRevision: subtreeBefore.revision,
          node: { type: 'item', id: 'manual-only' },
          destinationParentGroupId: null,
          insertIndex: 0,
        }),
      }),
    ]);
    assert.deepEqual([subtreeRes.status, moveRes2.status].sort(), [200, 409]);
    assertNoLockResidue(subtreeSession.rootDir);
    assertNoLockResidue(rootDir);
  });

  it('POST createItem と POST createGroup は同一 revision / lock を共有する', async () => {
    const session = await openSession({
      'demo-screen': {
        schemaVersion: '1.3',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        rootNodes: [],
        groups: [],
        items: {},
        excludedItems: {},
      },
    });
    const { rootDir, port } = session;
    const before = await getTree(port);
    const createItemRes = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/items'),
      headers: jsonHeaders(port),
      body: JSON.stringify({
        expectedRevision: before.revision,
        itemId: 'manual-a',
        name: 'Manual',
        type: 'text',
        description: '',
        note: '',
      }),
    });
    assert.equal(createItemRes.status, 201);
    const itemJson = parseJson(createItemRes);
    await assertRevisionAligned(rootDir, port, itemJson, before.revision);

    const createGroupRes = await httpRequest({
      port,
      method: 'POST',
      path: treePath('demo-screen', '/groups'),
      headers: jsonHeaders(port),
      body: JSON.stringify({
        expectedRevision: itemJson.revision,
        groupId: 'section',
        name: 'Section',
        kind: 'SECTION',
      }),
    });
    assert.equal(createGroupRes.status, 201);
    await assertRevisionAligned(rootDir, port, parseJson(createGroupRes), itemJson.revision);
    assertNoLockResidue(rootDir);
  });
});
