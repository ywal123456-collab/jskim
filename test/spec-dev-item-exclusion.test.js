'use strict';

/**
 * Phase 7B-2C-1: excludedItems の same-port API（除外 / 復元 / 手動除外拒否）
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  createDescriptionEditApi,
  DESCRIPTION_API_PREFIX,
} = require('../scripts/lib/create-description-edit-api');

const REPO_ROOT = path.resolve(__dirname, '..');
const COMPANION_ENTRY = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js'
);

describe('design-first: 収集項目の設計対象除外（Phase 7B-2C-1）', () => {
  const workspaces = [];

  after(async () => {
    for (const dir of workspaces) {
      // eslint-disable-next-line no-await-in-loop
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  async function loadCompanion() {
    return import(pathToFileURL(COMPANION_ENTRY).href);
  }

  async function createImplOnlyWorkspace() {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-spec-item-excl-')
    );
    workspaces.push(workspaceRoot);
    await fsp.mkdir(path.join(workspaceRoot, 'src', 'sample', 'pages'), {
      recursive: true,
    });
    const snapDir = path.join(
      workspaceRoot,
      'spec',
      'sample',
      'src',
      'snapshots',
      'impl-only'
    );
    await fsp.mkdir(snapDir, { recursive: true });
    await fsp.mkdir(
      path.join(workspaceRoot, 'spec', 'sample', 'src', 'data'),
      { recursive: true }
    );
    await fsp.writeFile(
      path.join(
        workspaceRoot,
        'src',
        'sample',
        'pages',
        'impl-only.spec.json'
      ),
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
      [
        '<div data-jskim-spec-item="layout">layout</div>',
        '<div data-jskim-spec-item="title">title</div>',
      ].join('\n') + '\n',
      'utf8'
    );
    return workspaceRoot;
  }

  async function withRealDescriptionApi(workspaceRoot, run) {
    const companion = await loadCompanion();
    const store = companion.createFileDescriptionStore({
      rootDir: workspaceRoot,
      projectName: 'sample',
      listScreenIds: () => {
        const loaded = companion.loadScreenSpecProject({
          rootDir: workspaceRoot,
          projectName: 'sample',
        });
        return loaded.screens.map((s) => s.screenId);
      },
    });

    const options = { store, host: '127.0.0.1', port: 0 };
    const api = createDescriptionEditApi(options);
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const handled = await api.handleRequest(req, res, {
        pathname: url.pathname,
        method: req.method || 'GET',
      });
      if (!handled) {
        res.statusCode = 404;
        res.end('not found');
      }
    });

    await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', resolve);
      server.on('error', reject);
    });
    const port = server.address().port;
    options.port = port;

    async function request(method, reqPath, { headers = {}, body } = {}) {
      return new Promise((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port, method, path: reqPath, headers },
          (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
              const buf = Buffer.concat(chunks);
              let json = null;
              try {
                json = JSON.parse(buf.toString('utf8'));
              } catch {
                json = null;
              }
              resolve({
                status: res.statusCode,
                body: buf,
                json,
                headers: res.headers,
              });
            });
          }
        );
        req.on('error', reject);
        if (body != null) {
          req.end(body);
        } else {
          req.end();
        }
      });
    }

    try {
      await run({ port, request, store, companion });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  it(
    'collected 項目の除外 → 復元 → ファイルが 1.2 + excludedItems を保持する',
    { timeout: 30000 },
    async () => {
      const workspaceRoot = await createImplOnlyWorkspace();
      await withRealDescriptionApi(workspaceRoot, async ({ port, request }) => {
        const headers = {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        };

        const get1 = await request('GET', `${DESCRIPTION_API_PREFIX}/impl-only`);
        assert.equal(get1.status, 200);
        assert.equal(get1.json.document.schemaVersion, '1.2');
        assert.deepEqual(get1.json.collectedItemIds, ['layout', 'title']);

        const excluded = structuredClone(get1.json.document);
        excluded.excludedItems.layout = excluded.items.layout;
        delete excluded.items.layout;
        excluded.itemOrder = excluded.itemOrder.filter((id) => id !== 'layout');

        const put1 = await request(
          'PUT',
          `${DESCRIPTION_API_PREFIX}/impl-only`,
          {
            headers,
            body: JSON.stringify({
              expectedRevision: get1.json.revision,
              document: excluded,
            }),
          }
        );
        assert.equal(put1.status, 200, JSON.stringify(put1.json));

        const saved1 = JSON.parse(
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
        assert.equal(saved1.schemaVersion, '1.2');
        assert.deepEqual(saved1.itemOrder, ['title']);
        assert.equal(saved1.items.layout, undefined);
        assert.equal(saved1.excludedItems.layout.name, '');
        assert.ok(saved1.$schema.includes('v1.2.schema.json'));

        const get2 = await request('GET', `${DESCRIPTION_API_PREFIX}/impl-only`);
        assert.deepEqual(Object.keys(get2.json.document.excludedItems), [
          'layout',
        ]);

        const restored = structuredClone(get2.json.document);
        restored.items.layout = restored.excludedItems.layout;
        delete restored.excludedItems.layout;
        restored.itemOrder = [...restored.itemOrder, 'layout'];

        const put2 = await request(
          'PUT',
          `${DESCRIPTION_API_PREFIX}/impl-only`,
          {
            headers,
            body: JSON.stringify({
              expectedRevision: get2.json.revision,
              document: restored,
            }),
          }
        );
        assert.equal(put2.status, 200, JSON.stringify(put2.json));

        const saved2 = JSON.parse(
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
        assert.deepEqual(saved2.excludedItems, {});
        assert.ok(saved2.items.layout);
        assert.deepEqual(saved2.itemOrder, ['title', 'layout']);
      });
    }
  );

  it(
    'manual-only 項目の除外 PUT は 400 SPEC_DESCRIPTION_MANUAL_ITEM_EXCLUDE_NOT_ALLOWED',
    { timeout: 30000 },
    async () => {
      const workspaceRoot = await createImplOnlyWorkspace();
      await withRealDescriptionApi(workspaceRoot, async ({ port, request }) => {
        const headers = {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        };

        const get1 = await request('GET', `${DESCRIPTION_API_PREFIX}/impl-only`);
        const seeded = structuredClone(get1.json.document);
        seeded.items.manual = {
          name: '手動',
          type: 'text',
          description: '',
          note: '',
        };
        seeded.itemOrder = [...seeded.itemOrder, 'manual'];
        const putSeed = await request(
          'PUT',
          `${DESCRIPTION_API_PREFIX}/impl-only`,
          {
            headers,
            body: JSON.stringify({
              expectedRevision: get1.json.revision,
              document: seeded,
            }),
          }
        );
        assert.equal(putSeed.status, 200, JSON.stringify(putSeed.json));

        const get2 = await request('GET', `${DESCRIPTION_API_PREFIX}/impl-only`);
        const bad = structuredClone(get2.json.document);
        bad.excludedItems.manual = bad.items.manual;
        delete bad.items.manual;
        bad.itemOrder = bad.itemOrder.filter((id) => id !== 'manual');

        const putBad = await request(
          'PUT',
          `${DESCRIPTION_API_PREFIX}/impl-only`,
          {
            headers,
            body: JSON.stringify({
              expectedRevision: get2.json.revision,
              document: bad,
            }),
          }
        );
        assert.equal(putBad.status, 400);
        assert.equal(
          putBad.json.code,
          'SPEC_DESCRIPTION_MANUAL_ITEM_EXCLUDE_NOT_ALLOWED'
        );
        assert.match(
          putBad.json.message,
          /実装画面と連携していない項目は設計対象から除外できません/
        );
      });
    }
  );

  it(
    '除外 entry の直接削除 PUT は 400 SPEC_DESCRIPTION_EXCLUDED_ITEM_REMOVE_NOT_ALLOWED',
    { timeout: 30000 },
    async () => {
      const workspaceRoot = await createImplOnlyWorkspace();
      await withRealDescriptionApi(workspaceRoot, async ({ port, request }) => {
        const headers = {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        };

        const get1 = await request('GET', `${DESCRIPTION_API_PREFIX}/impl-only`);
        const excluded = structuredClone(get1.json.document);
        excluded.excludedItems.layout = excluded.items.layout;
        delete excluded.items.layout;
        excluded.itemOrder = ['title'];
        const put1 = await request(
          'PUT',
          `${DESCRIPTION_API_PREFIX}/impl-only`,
          {
            headers,
            body: JSON.stringify({
              expectedRevision: get1.json.revision,
              document: excluded,
            }),
          }
        );
        assert.equal(put1.status, 200, JSON.stringify(put1.json));

        const get2 = await request('GET', `${DESCRIPTION_API_PREFIX}/impl-only`);
        const removed = structuredClone(get2.json.document);
        delete removed.excludedItems.layout;

        const putBad = await request(
          'PUT',
          `${DESCRIPTION_API_PREFIX}/impl-only`,
          {
            headers,
            body: JSON.stringify({
              expectedRevision: get2.json.revision,
              document: removed,
            }),
          }
        );
        assert.equal(putBad.status, 400);
        assert.equal(
          putBad.json.code,
          'SPEC_DESCRIPTION_EXCLUDED_ITEM_REMOVE_NOT_ALLOWED'
        );
      });
    }
  );
});
