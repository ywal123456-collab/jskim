'use strict';

// design-first（画面を先に作成してから実装と連携する）フローの結合テスト。
// 0 画面の temp project から始めて、viewer build が成功すること、
// および POST /_jskim/spec/descriptions で新規 Description ファイルが
// 実際にディスク上へ作成されることを確認する。

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

describe('design-first: 0 画面プロジェクトの build と POST create', () => {
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

  /**
   * `src/{project}/pages` と `spec/{project}/src/data` が両方とも空の
   * 温 project（design/implementation ともに 0 画面）を用意する。
   */
  async function createEmptyWorkspace() {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-spec-design-first-')
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
    '0 画面の状態で viewer build が成功し、空 manifest が出力される',
    { timeout: 60000 },
    async () => {
      const workspaceRoot = await createEmptyWorkspace();
      const companion = await loadCompanion();

      const project = companion.loadScreenSpecProject({
        rootDir: workspaceRoot,
        projectName: 'sample',
      });
      assert.equal(project.screens.length, 0);

      const { outDir } = await companion.buildScreenSpecViewer({
        rootDir: workspaceRoot,
        projectName: 'sample',
        base: '/spec/',
      });

      const manifestPath = path.join(outDir, 'data', 'manifest.json');
      const manifest = JSON.parse(
        await fsp.readFile(manifestPath, 'utf8')
      );
      assert.equal(manifest.projectName, 'sample');
      assert.deepEqual(manifest.screens, []);

      const indexHtml = await fsp.readFile(
        path.join(outDir, 'index.html'),
        'utf8'
      );
      assert.match(indexHtml, /<div id="app">/);
    }
  );

  it('POST で新規 Description ファイルが実際に作成される', async () => {
    const workspaceRoot = await createEmptyWorkspace();

    await withRealDescriptionApi(
      workspaceRoot,
      async ({ port, request, companion }) => {
        const res = await request('POST', DESCRIPTION_API_PREFIX, {
          headers: {
            'Content-Type': 'application/json',
            Origin: `http://127.0.0.1:${port}`,
            Host: `127.0.0.1:${port}`,
          },
          body: JSON.stringify({
            screenId: 'new-screen',
            name: '新規画面',
            description: '設計段階のメモ',
          }),
        });
        assert.equal(res.status, 201);
        assert.equal(res.json.screenId, 'new-screen');
        assert.equal(
          res.headers?.location,
          `${DESCRIPTION_API_PREFIX}/new-screen`
        );

        const filePath = path.join(
          workspaceRoot,
          'spec',
          'sample',
          'src',
          'data',
          'new-screen.json'
        );
        const exists = await fsp
          .access(filePath)
          .then(() => true)
          .catch(() => false);
        assert.equal(exists, true);

        const saved = JSON.parse(await fsp.readFile(filePath, 'utf8'));
        assert.equal(saved.screen.id, 'new-screen');
        assert.equal(saved.screen.name, '新規画面');
        assert.equal(saved.screen.description, '設計段階のメモ');

        // build を再実行しなくても loadScreenSpecProject は
        // 新規作成された design-only 画面を union で認識する。
        const reloaded = companion.loadScreenSpecProject({
          rootDir: workspaceRoot,
          projectName: 'sample',
        });
        const created = reloaded.screens.find(
          (s) => s.screenId === 'new-screen'
        );
        assert.ok(created);
        assert.equal(created.status, 'design-only');
        assert.equal(created.hasDescription, true);
        assert.equal(created.hasImplementation, false);
        assert.equal(created.hasPreview, false);
      }
    );
  });

  it('同じ screenId で 2 回 POST すると 2 回目は 409 になる', async () => {
    const workspaceRoot = await createEmptyWorkspace();

    await withRealDescriptionApi(workspaceRoot, async ({ port, request }) => {
      const body = JSON.stringify({
        screenId: 'dup-screen',
        name: '重複画面',
        description: '',
      });
      const headers = {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      };

      const first = await request('POST', DESCRIPTION_API_PREFIX, {
        headers,
        body,
      });
      assert.equal(first.status, 201);

      const second = await request('POST', DESCRIPTION_API_PREFIX, {
        headers,
        body,
      });
      assert.equal(second.status, 409);
      assert.equal(second.json.code, 'SPEC_DESCRIPTION_ALREADY_EXISTS');
    });
  });

  it('同一 screenId の同時 POST は 1 件だけ 201、他は 409、TEMP を残さない', async () => {
    const workspaceRoot = await createEmptyWorkspace();
    const companion = await loadCompanion();

    await withRealDescriptionApi(workspaceRoot, async ({ port, request }) => {
      const body = JSON.stringify({
        screenId: 'race-screen',
        name: '競合画面',
        description: '',
      });
      const headers = {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      };

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          request('POST', DESCRIPTION_API_PREFIX, { headers, body })
        )
      );

      const created = results.filter((r) => r.status === 201);
      const conflicts = results.filter((r) => r.status === 409);
      assert.equal(created.length, 1);
      assert.equal(conflicts.length, 7);
      assert.ok(
        conflicts.every((r) => r.json.code === 'SPEC_DESCRIPTION_ALREADY_EXISTS')
      );

      const dataDir = path.join(
        workspaceRoot,
        'spec',
        'sample',
        'src',
        'data'
      );
      const files = await fsp.readdir(dataDir);
      assert.deepEqual(files.sort(), ['race-screen.json']);
      const saved = JSON.parse(
        await fsp.readFile(path.join(dataDir, 'race-screen.json'), 'utf8')
      );
      assert.equal(saved.screen.id, 'race-screen');
      assert.equal(saved.schemaVersion, '1.0');
      assert.ok(!files.some((name) => name.includes('.tmp') || name.includes('.bak')));

      const loaded = companion.loadScreenSpecProject({
        rootDir: workspaceRoot,
        projectName: 'sample',
      });
      assert.equal(loaded.screens.length, 1);
      assert.equal(loaded.screens[0].status, 'design-only');
    });
  });
});
