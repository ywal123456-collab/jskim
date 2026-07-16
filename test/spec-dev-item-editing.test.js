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
    'DESIGN_ONLY: 既存 item 削除 PUT は 400 で元ファイルを保つ',
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
        assert.equal(put2.status, 400);
        assert.match(put2.json.message, /既存の項目IDは変更または削除できません/);

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
        assert.deepEqual(saved.itemOrder, ['a', 'b']);
        assert.ok(saved.items.b);
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
});
