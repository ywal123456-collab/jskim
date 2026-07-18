'use strict';

/**
 * Phase 7B-2A: 手動項目追加 / 並び替え / PUT validation の same-port 結合テスト。
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

describe('design-first: 項目追加と並び替え（Phase 7B-2A）', () => {
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

  async function createEmptyWorkspace() {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-spec-item-edit-')
    );
    workspaces.push(workspaceRoot);
    await fsp.mkdir(path.join(workspaceRoot, 'src', 'sample', 'pages'), {
      recursive: true,
    });
    await fsp.mkdir(
      path.join(workspaceRoot, 'spec', 'sample', 'src', 'data'),
      { recursive: true }
    );
    return workspaceRoot;
  }

  async function createImplOnlyWorkspace() {
    const workspaceRoot = await createEmptyWorkspace();
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
    'DESIGN_ONLY: 項目 2 件追加 → 保存 → schemaVersion 1.1 / itemOrder 維持',
    { timeout: 30000 },
    async () => {
      const workspaceRoot = await createEmptyWorkspace();
      await withRealDescriptionApi(workspaceRoot, async ({ port, request }) => {
        const headers = {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        };

        const created = await request('POST', DESCRIPTION_API_PREFIX, {
          headers,
          body: JSON.stringify({
            screenId: 'item-crud',
            name: '項目編集',
            description: '',
          }),
        });
        assert.equal(created.status, 201);

        const get1 = await request('GET', `${DESCRIPTION_API_PREFIX}/item-crud`);
        assert.equal(get1.status, 200);
        const doc = structuredClone(get1.json.document);
        doc.items['manual-first'] = {
          name: '手動1',
          type: 'text',
          description: '',
          note: '',
        };
        doc.items['manual-second'] = {
          name: '手動2',
          type: 'button',
          description: '',
          note: '',
        };
        doc.itemOrder = ['manual-first', 'manual-second'];

        const put1 = await request('PUT', `${DESCRIPTION_API_PREFIX}/item-crud`, {
          headers,
          body: JSON.stringify({
            expectedRevision: get1.json.revision,
            document: doc,
          }),
        });
        assert.equal(put1.status, 200);

        const saved = JSON.parse(
          await fsp.readFile(
            path.join(
              workspaceRoot,
              'spec',
              'sample',
              'src',
              'data',
              'item-crud.json'
            ),
            'utf8'
          )
        );
        assert.equal(saved.schemaVersion, '1.1');
        assert.deepEqual(saved.itemOrder, ['manual-first', 'manual-second']);

        const get2 = await request('GET', `${DESCRIPTION_API_PREFIX}/item-crud`);
        const reordered = structuredClone(get2.json.document);
        reordered.itemOrder = ['manual-second', 'manual-first'];
        const put2 = await request('PUT', `${DESCRIPTION_API_PREFIX}/item-crud`, {
          headers,
          body: JSON.stringify({
            expectedRevision: get2.json.revision,
            document: reordered,
          }),
        });
        assert.equal(put2.status, 200);

        const saved2 = JSON.parse(
          await fsp.readFile(
            path.join(
              workspaceRoot,
              'spec',
              'sample',
              'src',
              'data',
              'item-crud.json'
            ),
            'utf8'
          )
        );
        assert.deepEqual(saved2.itemOrder, ['manual-second', 'manual-first']);

        const get3 = await request('GET', `${DESCRIPTION_API_PREFIX}/item-crud`);
        assert.deepEqual(get3.json.document.itemOrder, [
          'manual-second',
          'manual-first',
        ]);
      });
    }
  );

  it(
    'DESIGN_ONLY: manual-only 項目の削除 PUT は成功する',
    { timeout: 30000 },
    async () => {
      const workspaceRoot = await createEmptyWorkspace();
      await withRealDescriptionApi(workspaceRoot, async ({ port, request }) => {
        const headers = {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        };
        const created = await request('POST', DESCRIPTION_API_PREFIX, {
          headers,
          body: JSON.stringify({
            screenId: 'keep-items',
            name: '保持',
            description: '',
          }),
        });
        assert.equal(created.status, 201);

        const get1 = await request('GET', `${DESCRIPTION_API_PREFIX}/keep-items`);
        assert.deepEqual(get1.json.collectedItemIds, []);
        const doc = structuredClone(get1.json.document);
        doc.items.a = { name: 'A', type: 'text', description: '', note: '' };
        doc.items.b = { name: 'B', type: 'text', description: '', note: '' };
        doc.itemOrder = ['a', 'b'];
        const put1 = await request('PUT', `${DESCRIPTION_API_PREFIX}/keep-items`, {
          headers,
          body: JSON.stringify({
            expectedRevision: get1.json.revision,
            document: doc,
          }),
        });
        assert.equal(put1.status, 200);

        const get2 = await request('GET', `${DESCRIPTION_API_PREFIX}/keep-items`);
        const removed = structuredClone(get2.json.document);
        delete removed.items.b;
        removed.itemOrder = ['a'];
        const put2 = await request('PUT', `${DESCRIPTION_API_PREFIX}/keep-items`, {
          headers,
          body: JSON.stringify({
            expectedRevision: get2.json.revision,
            document: removed,
          }),
        });
        assert.equal(put2.status, 200);

        const saved = JSON.parse(
          await fsp.readFile(
            path.join(
              workspaceRoot,
              'spec',
              'sample',
              'src',
              'data',
              'keep-items.json'
            ),
            'utf8'
          )
        );
        assert.deepEqual(saved.itemOrder, ['a']);
        assert.equal(saved.items.b, undefined);
      });
    }
  );

  it(
    'DESIGN_ONLY: 項目複製 PUT で原項目の直後に挿入される',
    { timeout: 30000 },
    async () => {
      const workspaceRoot = await createEmptyWorkspace();
      await withRealDescriptionApi(workspaceRoot, async ({ port, request }) => {
        const headers = {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        };
        const created = await request('POST', DESCRIPTION_API_PREFIX, {
          headers,
          body: JSON.stringify({
            screenId: 'dup-items',
            name: '複製',
            description: '',
          }),
        });
        assert.equal(created.status, 201);

        const get1 = await request('GET', `${DESCRIPTION_API_PREFIX}/dup-items`);
        const doc = structuredClone(get1.json.document);
        doc.items['manual-a'] = {
          name: '手動A',
          type: 'text',
          description: 'd',
          note: 'n',
        };
        doc.items['manual-b'] = {
          name: '手動B',
          type: 'button',
          description: '',
          note: '',
        };
        doc.itemOrder = ['manual-a', 'manual-b'];
        const put1 = await request('PUT', `${DESCRIPTION_API_PREFIX}/dup-items`, {
          headers,
          body: JSON.stringify({
            expectedRevision: get1.json.revision,
            document: doc,
          }),
        });
        assert.equal(put1.status, 200);

        const get2 = await request('GET', `${DESCRIPTION_API_PREFIX}/dup-items`);
        const withCopy = structuredClone(get2.json.document);
        withCopy.items['manual-a-copy'] = {
          name: '手動A',
          type: 'text',
          description: 'd',
          note: 'n',
        };
        withCopy.itemOrder = ['manual-a', 'manual-a-copy', 'manual-b'];
        const put2 = await request('PUT', `${DESCRIPTION_API_PREFIX}/dup-items`, {
          headers,
          body: JSON.stringify({
            expectedRevision: get2.json.revision,
            document: withCopy,
          }),
        });
        assert.equal(put2.status, 200);

        const saved = JSON.parse(
          await fsp.readFile(
            path.join(
              workspaceRoot,
              'spec',
              'sample',
              'src',
              'data',
              'dup-items.json'
            ),
            'utf8'
          )
        );
        assert.deepEqual(saved.itemOrder, [
          'manual-a',
          'manual-a-copy',
          'manual-b',
        ]);
      });
    }
  );

  it(
    'IMPLEMENTATION_ONLY: collected + manual を初回保存できる',
    { timeout: 30000 },
    async () => {
      const workspaceRoot = await createImplOnlyWorkspace();
      await withRealDescriptionApi(
        workspaceRoot,
        async ({ port, request, companion }) => {
          const headers = {
            'Content-Type': 'application/json',
            Origin: `http://127.0.0.1:${port}`,
            Host: `127.0.0.1:${port}`,
          };
          const get1 = await request(
            'GET',
            `${DESCRIPTION_API_PREFIX}/impl-only`
          );
          assert.equal(get1.status, 200);
          assert.equal(get1.json.exists, false);
          assert.deepEqual(get1.json.collectedItemIds, ['title']);

          const doc = structuredClone(get1.json.document);
          doc.screen.name = '実装+手動';
          doc.items['manual-extra'] = {
            name: '手動',
            type: 'text',
            description: '',
            note: '',
          };
          doc.itemOrder = [...doc.itemOrder, 'manual-extra'];

          const put1 = await request(
            'PUT',
            `${DESCRIPTION_API_PREFIX}/impl-only`,
            {
              headers,
              body: JSON.stringify({
                expectedRevision: get1.json.revision,
                document: doc,
              }),
            }
          );
          assert.equal(put1.status, 200);

          const loaded = companion.loadScreenSpecProject({
            rootDir: workspaceRoot,
            projectName: 'sample',
          });
          const screen = loaded.screens.find((s) => s.screenId === 'impl-only');
          assert.equal(screen.status, 'linked');
          assert.ok(screen.description.items.title);
          assert.ok(screen.description.items['manual-extra']);
          assert.deepEqual(screen.description.itemOrder, [
            'title',
            'manual-extra',
          ]);
        }
      );
    }
  );

  it(
    'LINKED: collected 項目の削除 PUT は拒否し、複製は許可する',
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
        seeded.screen.name = '連携';
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
        assert.equal(putSeed.status, 200);

        const get2 = await request('GET', `${DESCRIPTION_API_PREFIX}/impl-only`);
        assert.deepEqual(get2.json.collectedItemIds, ['title']);

        const withCopy = structuredClone(get2.json.document);
        withCopy.items['title-copy'] = {
          name: 'タイトル',
          type: 'text',
          description: '',
          note: '',
        };
        withCopy.itemOrder = ['title', 'title-copy'];
        const putCopy = await request(
          'PUT',
          `${DESCRIPTION_API_PREFIX}/impl-only`,
          {
            headers,
            body: JSON.stringify({
              expectedRevision: get2.json.revision,
              document: withCopy,
            }),
          }
        );
        assert.equal(putCopy.status, 200);

        const get3 = await request('GET', `${DESCRIPTION_API_PREFIX}/impl-only`);
        const deletedCollected = structuredClone(get3.json.document);
        delete deletedCollected.items.title;
        deletedCollected.itemOrder = ['title-copy'];
        const putDelete = await request(
          'PUT',
          `${DESCRIPTION_API_PREFIX}/impl-only`,
          {
            headers,
            body: JSON.stringify({
              expectedRevision: get3.json.revision,
              document: deletedCollected,
            }),
          }
        );
        assert.equal(putDelete.status, 400);
        assert.equal(
          putDelete.json.code,
          'SPEC_DESCRIPTION_COLLECTED_ITEM_DELETE_NOT_ALLOWED'
        );

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
        assert.ok(saved.items.title);
        assert.deepEqual(saved.itemOrder, ['title', 'title-copy']);
      });
    }
  );

  it(
    'race: PUT 直前に collected へ昇格した項目の削除は拒否する',
    { timeout: 30000 },
    async () => {
      const workspaceRoot = await createEmptyWorkspace();
      await withRealDescriptionApi(workspaceRoot, async ({ port, request }) => {
        const headers = {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        };
        const created = await request('POST', DESCRIPTION_API_PREFIX, {
          headers,
          body: JSON.stringify({
            screenId: 'race-item',
            name: '競合',
            description: '',
          }),
        });
        assert.equal(created.status, 201);

        const get1 = await request('GET', `${DESCRIPTION_API_PREFIX}/race-item`);
        const doc = structuredClone(get1.json.document);
        doc.items['item-x'] = {
          name: 'X',
          type: 'text',
          description: '',
          note: '',
        };
        doc.itemOrder = ['item-x'];
        const put1 = await request('PUT', `${DESCRIPTION_API_PREFIX}/race-item`, {
          headers,
          body: JSON.stringify({
            expectedRevision: get1.json.revision,
            document: doc,
          }),
        });
        assert.equal(put1.status, 200);

        // collect 相当: snapshot に同じ ID を後から追加
        const snapDir = path.join(
          workspaceRoot,
          'spec',
          'sample',
          'src',
          'snapshots',
          'race-item'
        );
        await fsp.mkdir(snapDir, { recursive: true });
        await fsp.writeFile(
          path.join(snapDir, 'default.html'),
          '<div data-jskim-spec-item="item-x">x</div>\n',
          'utf8'
        );
        // Source も追加して listScreenIds に残す（既に Description があるので不要だが実況に近づける）
        await fsp.writeFile(
          path.join(workspaceRoot, 'src', 'sample', 'pages', 'race-item.spec.json'),
          JSON.stringify(
            {
              schemaVersion: '1.0',
              screen: { id: 'race-item', path: '/' },
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

        const get2 = await request('GET', `${DESCRIPTION_API_PREFIX}/race-item`);
        assert.ok(get2.json.collectedItemIds.includes('item-x'));
        const removed = structuredClone(get2.json.document);
        delete removed.items['item-x'];
        removed.itemOrder = [];
        const put2 = await request('PUT', `${DESCRIPTION_API_PREFIX}/race-item`, {
          headers,
          body: JSON.stringify({
            expectedRevision: get2.json.revision,
            document: removed,
          }),
        });
        assert.equal(put2.status, 400);
        assert.equal(
          put2.json.code,
          'SPEC_DESCRIPTION_COLLECTED_ITEM_DELETE_NOT_ALLOWED'
        );

        const saved = JSON.parse(
          await fsp.readFile(
            path.join(
              workspaceRoot,
              'spec',
              'sample',
              'src',
              'data',
              'race-item.json'
            ),
            'utf8'
          )
        );
        assert.ok(saved.items['item-x']);
      });
    }
  );
});
