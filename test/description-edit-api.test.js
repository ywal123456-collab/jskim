'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  createDescriptionEditApi,
  injectDescriptionEditingBootstrap,
  DESCRIPTION_API_PREFIX,
} = require('../scripts/lib/create-description-edit-api');

function createMemoryStore(initial = {}) {
  const docs = new Map();
  for (const [id, value] of Object.entries(initial)) {
    docs.set(id, value);
  }

  return {
    create({ screenId, name, description }) {
      if (docs.has(screenId)) {
        const err = new Error(`画面設計書「${screenId}」は既に存在します。`);
        err.code = 'SPEC_DESCRIPTION_ALREADY_EXISTS';
        err.statusCode = 409;
        throw err;
      }
      if (typeof screenId !== 'string' || !/^[a-z][a-z0-9-]*$/.test(screenId)) {
        const err = new Error('画面 ID の形式が不正です。');
        err.code = 'SPEC_DESCRIPTION_INVALID_SCREEN_ID';
        err.statusCode = 400;
        throw err;
      }
      if (typeof name !== 'string' || name.trim() === '') {
        const err = new Error('name は空にできません。');
        err.code = 'SPEC_DESCRIPTION_INVALID';
        err.statusCode = 400;
        throw err;
      }
      const document = {
        schemaVersion: '1.0',
        screen: { id: screenId, name, description: description || '' },
        items: {},
      };
      docs.set(screenId, {
        revision: 'sha256:created',
        exists: true,
        document,
      });
      return { screenId, revision: 'sha256:created', document, created: true };
    },
    read(screenId) {
      const entry = docs.get(screenId);
      if (!entry) {
        const err = new Error(`画面「${screenId}」は登録されていません。`);
        err.code = 'SPEC_DESCRIPTION_SCREEN_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }
      return {
        screenId,
        revision: entry.revision,
        exists: entry.exists,
        document: structuredClone(entry.document),
      };
    },
    write(screenId, document, expectedRevision) {
      const entry = docs.get(screenId);
      if (!entry) {
        const err = new Error(`画面「${screenId}」は登録されていません。`);
        err.code = 'SPEC_DESCRIPTION_SCREEN_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }
      if (expectedRevision !== entry.revision) {
        const err = new Error('画面設計書が別の場所で変更されています。');
        err.code = 'SPEC_DESCRIPTION_REVISION_CONFLICT';
        err.statusCode = 409;
        err.expectedRevision = expectedRevision;
        err.currentRevision = entry.revision;
        throw err;
      }
      if (document && document.screen && document.screen.id !== screenId) {
        const err = new Error('screen.id が URL の画面 ID と一致しません。');
        err.code = 'SPEC_DESCRIPTION_INVALID';
        err.statusCode = 400;
        throw err;
      }
      const same = JSON.stringify(entry.document) === JSON.stringify(document);
      const nextRev = same ? entry.revision : `sha256:next-${Date.now()}`;
      docs.set(screenId, {
        revision: nextRev,
        document: structuredClone(document),
        exists: true,
      });
      return {
        screenId,
        revision: nextRev,
        saved: true,
        written: !same,
      };
    },
  };
}

async function withServer(store, run) {
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
        {
          hostname: '127.0.0.1',
          port,
          method,
          path: reqPath,
          headers,
        },
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
            resolve({ status: res.statusCode, body: buf, json, headers: res.headers });
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
    await run({ port, request });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('createDescriptionEditApi', () => {
  it('GET で Description を返す', async () => {
    const store = createMemoryStore({
      demo: {
        revision: 'sha256:aaa',
        exists: true,
        document: {
          schemaVersion: '1.0',
          screen: { id: 'demo', name: 'Demo', description: '' },
          items: {},
        },
      },
    });
    await withServer(store, async ({ request }) => {
      const res = await request('GET', `${DESCRIPTION_API_PREFIX}/demo`);
      assert.equal(res.status, 200);
      assert.equal(res.json.screenId, 'demo');
      assert.equal(res.json.revision, 'sha256:aaa');
      assert.equal(res.json.document.screen.name, 'Demo');
    });
  });

  it('存在しない screen は 404', async () => {
    await withServer(createMemoryStore(), async ({ request }) => {
      const res = await request('GET', `${DESCRIPTION_API_PREFIX}/missing`);
      assert.equal(res.status, 404);
      assert.equal(res.json.code, 'SPEC_DESCRIPTION_SCREEN_NOT_FOUND');
    });
  });

  it('正常 PUT と revision conflict', async () => {
    const store = createMemoryStore({
      demo: {
        revision: 'sha256:old',
        exists: true,
        document: {
          schemaVersion: '1.0',
          screen: { id: 'demo', name: 'Demo', description: '' },
          items: {},
        },
      },
    });
    await withServer(store, async ({ port, request }) => {
      const putOk = await request('PUT', `${DESCRIPTION_API_PREFIX}/demo`, {
        headers: {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        },
        body: JSON.stringify({
          expectedRevision: 'sha256:old',
          document: {
            schemaVersion: '1.0',
            screen: { id: 'demo', name: 'Demo2', description: 'x' },
            items: {},
          },
        }),
      });
      assert.equal(putOk.status, 200);
      assert.equal(putOk.json.saved, true);
      assert.ok(putOk.json.revision.startsWith('sha256:'));

      const conflict = await request('PUT', `${DESCRIPTION_API_PREFIX}/demo`, {
        headers: {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        },
        body: JSON.stringify({
          expectedRevision: 'sha256:old',
          document: {
            schemaVersion: '1.0',
            screen: { id: 'demo', name: 'Demo3', description: '' },
            items: {},
          },
        }),
      });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.json.code, 'SPEC_DESCRIPTION_REVISION_CONFLICT');
    });
  });

  it('malformed JSON / screenId 不一致 / traversal / body size / cross-origin', async () => {
    const store = createMemoryStore({
      demo: {
        revision: 'sha256:r1',
        exists: true,
        document: {
          schemaVersion: '1.0',
          screen: { id: 'demo', name: 'Demo', description: '' },
          items: {},
        },
      },
    });
    await withServer(store, async ({ port, request }) => {
      const malformed = await request('PUT', `${DESCRIPTION_API_PREFIX}/demo`, {
        headers: {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        },
        body: '{not-json',
      });
      assert.equal(malformed.status, 400);
      assert.equal(malformed.json.code, 'SPEC_DESCRIPTION_MALFORMED_JSON');

      const mismatch = await request('PUT', `${DESCRIPTION_API_PREFIX}/demo`, {
        headers: {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        },
        body: JSON.stringify({
          expectedRevision: 'sha256:r1',
          document: {
            schemaVersion: '1.0',
            screen: { id: 'other', name: 'x', description: '' },
            items: {},
          },
        }),
      });
      assert.equal(mismatch.status, 400);

      const traversal = await request(
        'GET',
        `${DESCRIPTION_API_PREFIX}/..%2Fsecret`
      );
      assert.equal(traversal.status, 400);

      const big = Buffer.alloc(300 * 1024, 0x61);
      const tooLarge = await request('PUT', `${DESCRIPTION_API_PREFIX}/demo`, {
        headers: {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
          'Content-Length': String(big.length),
        },
        body: big,
      });
      assert.equal(tooLarge.status, 413);

      const cross = await request('PUT', `${DESCRIPTION_API_PREFIX}/demo`, {
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://evil.example:9999',
          Host: `127.0.0.1:${port}`,
        },
        body: JSON.stringify({
          expectedRevision: 'sha256:r1',
          document: {
            schemaVersion: '1.0',
            screen: { id: 'demo', name: 'x', description: '' },
            items: {},
          },
        }),
      });
      assert.equal(cross.status, 403);
      assert.equal(cross.json.code, 'SPEC_DESCRIPTION_FORBIDDEN_ORIGIN');
    });
  });

  it('POST で新規 Description を作成し 201 + Location を返す', async () => {
    const store = createMemoryStore();
    await withServer(store, async ({ port, request }) => {
      const res = await request('POST', DESCRIPTION_API_PREFIX, {
        headers: {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        },
        body: JSON.stringify({
          screenId: 'new-screen',
          name: '新規画面',
          description: '',
        }),
      });
      assert.equal(res.status, 201);
      assert.equal(res.json.screenId, 'new-screen');
      assert.equal(
        res.headers?.location,
        `${DESCRIPTION_API_PREFIX}/new-screen`,
      );
      assert.equal(res.json.document.screen.name, '新規画面');

      // 2 回目は 409
      const dup = await request('POST', DESCRIPTION_API_PREFIX, {
        headers: {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        },
        body: JSON.stringify({
          screenId: 'new-screen',
          name: '重複',
          description: '',
        }),
      });
      assert.equal(dup.status, 409);
      assert.equal(dup.json.code, 'SPEC_DESCRIPTION_ALREADY_EXISTS');
    });
  });

  it('POST の許可されていないフィールドは 400、GET/PUT/HEAD/POST 以外は 405', async () => {
    const store = createMemoryStore();
    await withServer(store, async ({ port, request }) => {
      const badField = await request('POST', DESCRIPTION_API_PREFIX, {
        headers: {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          Host: `127.0.0.1:${port}`,
        },
        body: JSON.stringify({
          screenId: 'x',
          name: 'A',
          description: '',
          copyFromScreenId: 'other',
        }),
      });
      assert.equal(badField.status, 400);

      const methodNotAllowed = await request(
        'DELETE',
        DESCRIPTION_API_PREFIX
      );
      assert.equal(methodNotAllowed.status, 405);

      const postOnScreenPath = await request(
        'POST',
        `${DESCRIPTION_API_PREFIX}/some-screen`
      );
      assert.equal(postOnScreenPath.status, 405);
    });
  });

  it('HTML に編集 bootstrap を注入する', () => {
    const html = '<html><body><div id="app"></div></body></html>';
    const next = injectDescriptionEditingBootstrap(html);
    assert.match(next, /__JSKIM_SPEC_EDIT__/);
    assert.match(next, /enabled:\s*true/);
    assert.match(next, /\/_jskim\/spec\/descriptions/);
  });
});
