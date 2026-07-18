'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  createReferenceImageApi,
  REFERENCE_IMAGE_STATUS_PATH,
  MAX_MULTIPART_BODY_BYTES,
} = require('../scripts/lib/create-reference-image-api');
const { buildMultipartBody, buildPng } = require('./helpers/multipart');

function designOnly(screenId = 'design') {
  return {
    screenId,
    status: 'design-only',
    hasImplementation: false,
    hasDescription: true,
  };
}

function linked(screenId = 'linked') {
  return {
    screenId,
    status: 'linked',
    hasImplementation: true,
    hasDescription: true,
  };
}

function implOnly(screenId = 'impl') {
  return {
    screenId,
    status: 'implementation-only',
    hasImplementation: true,
    hasDescription: false,
  };
}

async function withServer(apiFactory, fn) {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const api = apiFactory(port);
  server.on('request', async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const handled = await api.handleRequest(req, res, {
      pathname: url.pathname,
      method: req.method || 'GET',
    });
    if (!handled && !res.writableEnded) {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  try {
    await fn(port, api);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function request(port, options) {
  return new Promise((resolve, reject) => {
    const body =
      options.body == null
        ? null
        : Buffer.isBuffer(options.body)
          ? options.body
          : Buffer.from(String(options.body));
    const headers = {
      Host: `127.0.0.1:${port}`,
      Origin: `http://127.0.0.1:${port}`,
      ...(options.headers || {}),
    };
    if (body) {
      headers['Content-Length'] = String(body.length);
    }
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method || 'GET',
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          let json = null;
          try {
            json = buf.length ? JSON.parse(buf.toString('utf8')) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json, body: buf });
        });
      }
    );
    req.on('error', reject);
    if (body) {
      req.end(body);
    } else {
      req.end();
    }
  });
}

function putMultipart(port, screenId, viewport, parts, boundary = '----testbound') {
  const body = buildMultipartBody(boundary, parts);
  return request(port, {
    method: 'PUT',
    path: `/_jskim/spec/reference-images/${screenId}/${viewport}`,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });
}

describe('createReferenceImageApi', () => {
  let putCalls;
  let deleteCalls;
  let putImpl;
  let deleteImpl;
  let publicInfo;
  let screens;

  beforeEach(() => {
    putCalls = [];
    deleteCalls = [];
    screens = [designOnly('design'), linked('linked'), implOnly('impl')];
    publicInfo = { status: 'missing' };
    putImpl = async (opts) => {
      putCalls.push(opts);
      const rev = `sha256:${'1'.repeat(64)}`;
      publicInfo = {
        status: 'current',
        imageRevision: rev,
        imageWidth: 10,
        imageHeight: 20,
        uploadedAt: '2026-07-18T00:00:00.000Z',
      };
      return {
        result: 'created',
        screenId: opts.screenId,
        viewport: opts.viewport,
        imageRevision: rev,
        imageWidth: 10,
        imageHeight: 20,
        uploadedAt: '2026-07-18T00:00:00.000Z',
      };
    };
    deleteImpl = async (opts) => {
      deleteCalls.push(opts);
      publicInfo = { status: 'missing' };
      return {
        result: 'deleted',
        screenId: opts.screenId,
        viewport: opts.viewport,
      };
    };
  });

  function createApi(port, overrides = {}) {
    return createReferenceImageApi({
      rootDir: '/tmp/ws',
      projectName: 'demo',
      host: '127.0.0.1',
      port,
      putReferenceImage: async (opts) => putImpl(opts),
      deleteReferenceImage: async (opts) => deleteImpl(opts),
      getReferenceImagePublicInfo: () => publicInfo,
      loadScreenSpecProject: () => ({ screens }),
      ...overrides,
    });
  }

  it('PUT created（DESIGN_ONLY / IMPLEMENTATION_ONLY / LINKED）と status', async () => {
    await withServer((port) => createApi(port), async (port, api) => {
      for (const screenId of ['design', 'impl', 'linked']) {
        putCalls.length = 0;
        publicInfo = { status: 'missing' };
        const res = await putMultipart(port, screenId, 'pc', [
          {
            name: 'image',
            filename: 'a.png',
            contentType: 'image/png',
            data: buildPng(10, 20, 1),
          },
        ]);
        assert.equal(res.status, 200);
        assert.equal(res.json.result, 'created');
        assert.equal(res.json.referenceImage.status, 'current');
        assert.equal(putCalls.length, 1);
        assert.equal(putCalls[0].expectedImageRevision, undefined);

        const st = await request(port, {
          path: `${REFERENCE_IMAGE_STATUS_PATH}?screenId=${screenId}&viewport=pc`,
        });
        assert.equal(st.status, 200);
        assert.equal(st.json.runtime.status, 'idle');
        assert.equal(st.json.referenceImage.status, 'current');
      }
      assert.equal(api.getRuntimeForTest('design', 'pc').status, 'idle');
    });
  });

  it('SP PUT / replace / unchanged / conflict', async () => {
    await withServer((port) => createApi(port), async (port) => {
      const created = await putMultipart(port, 'design', 'sp', [
        {
          name: 'image',
          filename: 'a.png',
          contentType: 'image/png',
          data: buildPng(8, 8, 1),
        },
      ]);
      assert.equal(created.status, 200);

      const rev = created.json.referenceImage.imageRevision;
      putImpl = async (opts) => {
        putCalls.push(opts);
        if (opts.expectedImageRevision !== rev) {
          const err = new Error('conflict');
          err.code = 'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT';
          throw err;
        }
        publicInfo = {
          status: 'current',
          imageRevision: `sha256:${'2'.repeat(64)}`,
          imageWidth: 8,
          imageHeight: 8,
          uploadedAt: '2026-07-18T01:00:00.000Z',
        };
        return {
          result: 'updated',
          screenId: opts.screenId,
          viewport: opts.viewport,
          imageRevision: publicInfo.imageRevision,
          imageWidth: 8,
          imageHeight: 8,
          uploadedAt: publicInfo.uploadedAt,
        };
      };
      const updated = await putMultipart(port, 'design', 'sp', [
        {
          name: 'image',
          filename: 'b.png',
          contentType: 'image/png',
          data: buildPng(8, 8, 2),
        },
        { name: 'expectedImageRevision', data: rev },
      ]);
      assert.equal(updated.status, 200);
      assert.equal(updated.json.result, 'updated');

      putImpl = async (opts) => {
        putCalls.push(opts);
        return {
          result: 'unchanged',
          screenId: opts.screenId,
          viewport: opts.viewport,
          imageRevision: publicInfo.imageRevision,
          imageWidth: 8,
          imageHeight: 8,
          uploadedAt: '2026-07-18T01:00:00.000Z',
        };
      };
      const same = await putMultipart(port, 'design', 'sp', [
        {
          name: 'image',
          filename: 'b.png',
          contentType: 'image/png',
          data: buildPng(8, 8, 2),
        },
        {
          name: 'expectedImageRevision',
          data: publicInfo.imageRevision,
        },
      ]);
      assert.equal(same.status, 200);
      assert.equal(same.json.result, 'unchanged');

      putImpl = async () => {
        const err = new Error('stale');
        err.code = 'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT';
        throw err;
      };
      const stale = await putMultipart(port, 'design', 'sp', [
        {
          name: 'image',
          filename: 'c.png',
          contentType: 'image/png',
          data: buildPng(8, 8, 3),
        },
        { name: 'expectedImageRevision', data: `sha256:${'0'.repeat(64)}` },
      ]);
      assert.equal(stale.status, 409);
      assert.equal(stale.json.code, 'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT');
    });
  });

  it('multipart / Content-Type / field 契約違反', async () => {
    await withServer((port) => createApi(port), async (port) => {
      const noCt = await request(port, {
        method: 'PUT',
        path: '/_jskim/spec/reference-images/design/pc',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from('{}'),
      });
      assert.equal(noCt.status, 415);

      const noBoundary = await request(port, {
        method: 'PUT',
        path: '/_jskim/spec/reference-images/design/pc',
        headers: { 'Content-Type': 'multipart/form-data' },
        body: Buffer.from('x'),
      });
      assert.equal(noBoundary.status, 415);

      const missingImage = await putMultipart(port, 'design', 'pc', [
        { name: 'expectedImageRevision', data: `sha256:${'a'.repeat(64)}` },
      ]);
      assert.equal(missingImage.status, 400);

      const unknown = await putMultipart(port, 'design', 'pc', [
        {
          name: 'image',
          filename: 'a.png',
          contentType: 'image/png',
          data: buildPng(2, 2),
        },
        { name: 'extra', data: '1' },
      ]);
      assert.equal(unknown.status, 400);
      assert.equal(unknown.json.code, 'SPEC_REFERENCE_IMAGE_UNKNOWN_FIELD');

      const jpegMime = await putMultipart(port, 'design', 'pc', [
        {
          name: 'image',
          filename: 'a.jpg',
          contentType: 'image/jpeg',
          data: buildPng(2, 2),
        },
      ]);
      assert.equal(jpegMime.status, 400);

      putImpl = async () => {
        const err = new Error('bad');
        err.code = 'SPEC_REFERENCE_IMAGE_INVALID_PNG';
        throw err;
      };
      const badBytes = await putMultipart(port, 'design', 'pc', [
        {
          name: 'image',
          filename: 'a.png',
          contentType: 'image/png',
          data: Buffer.from('not-png'),
        },
      ]);
      assert.equal(badBytes.status, 400);

      const badVp = await putMultipart(port, 'design', 'tablet', [
        {
          name: 'image',
          filename: 'a.png',
          contentType: 'image/png',
          data: buildPng(2, 2),
        },
      ]);
      assert.equal(badVp.status, 400);

      const noScreen = await putMultipart(port, 'ghost', 'pc', [
        {
          name: 'image',
          filename: 'a.png',
          contentType: 'image/png',
          data: buildPng(2, 2),
        },
      ]);
      assert.equal(noScreen.status, 404);

      const foreign = await request(port, {
        method: 'PUT',
        path: '/_jskim/spec/reference-images/design/pc',
        headers: {
          Origin: 'http://evil.example',
          'Content-Type': 'multipart/form-data; boundary=x',
        },
        body: buildMultipartBody('x', [
          {
            name: 'image',
            filename: 'a.png',
            contentType: 'image/png',
            data: buildPng(2, 2),
          },
        ]),
      });
      assert.equal(foreign.status, 403);
      assert.equal(putCalls.length, 0);
    });
  });

  it('DELETE 成功 / missing / conflict / body 検証', async () => {
    await withServer((port) => createApi(port), async (port) => {
      publicInfo = {
        status: 'current',
        imageRevision: `sha256:${'9'.repeat(64)}`,
        imageWidth: 1,
        imageHeight: 1,
        uploadedAt: '2026-07-18T00:00:00.000Z',
      };
      const ok = await request(port, {
        method: 'DELETE',
        path: '/_jskim/spec/reference-images/design/pc',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(
          JSON.stringify({ expectedImageRevision: `sha256:${'9'.repeat(64)}` })
        ),
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.result, 'deleted');

      deleteImpl = async () => {
        const err = new Error('missing');
        err.code = 'SPEC_REFERENCE_IMAGE_NOT_FOUND';
        throw err;
      };
      const missing = await request(port, {
        method: 'DELETE',
        path: '/_jskim/spec/reference-images/design/pc',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(
          JSON.stringify({ expectedImageRevision: `sha256:${'9'.repeat(64)}` })
        ),
      });
      assert.equal(missing.status, 404);

      deleteImpl = async () => {
        const err = new Error('conflict');
        err.code = 'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT';
        throw err;
      };
      const conflict = await request(port, {
        method: 'DELETE',
        path: '/_jskim/spec/reference-images/design/pc',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(
          JSON.stringify({ expectedImageRevision: `sha256:${'8'.repeat(64)}` })
        ),
      });
      assert.equal(conflict.status, 409);

      const noBody = await request(port, {
        method: 'DELETE',
        path: '/_jskim/spec/reference-images/design/pc',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(''),
      });
      assert.equal(noBody.status, 400);

      const unknown = await request(port, {
        method: 'DELETE',
        path: '/_jskim/spec/reference-images/design/pc',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(
          JSON.stringify({
            expectedImageRevision: `sha256:${'9'.repeat(64)}`,
            extra: 1,
          })
        ),
      });
      assert.equal(unknown.status, 400);
    });
  });

  it('runtime uploading/deleting/failed と同一 key 409・他 viewport 並列', async () => {
    await withServer((port) => {
      let releasePc;
      const gatePc = new Promise((r) => {
        releasePc = r;
      });
      const api = createApi(port, {
        getPutHooks: ({ viewport }) =>
          viewport === 'pc' ? { awaitBarrier: () => gatePc } : undefined,
      });
      api._releasePc = releasePc;
      return api;
    }, async (port, api) => {
      publicInfo = { status: 'missing' };
      const p1 = putMultipart(port, 'design', 'pc', [
        {
          name: 'image',
          filename: 'a.png',
          contentType: 'image/png',
          data: buildPng(3, 3, 1),
        },
      ]);

      const deadline = Date.now() + 5000;
      let st;
      while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        st = await request(port, {
          path: `${REFERENCE_IMAGE_STATUS_PATH}?screenId=design&viewport=pc`,
        });
        if (st.json && st.json.runtime && st.json.runtime.status === 'uploading') {
          break;
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setImmediate(r));
      }
      assert.equal(st.json.runtime.status, 'uploading');

      const dup = await putMultipart(port, 'design', 'pc', [
        {
          name: 'image',
          filename: 'a.png',
          contentType: 'image/png',
          data: buildPng(3, 3, 2),
        },
      ]);
      assert.equal(dup.status, 409);
      assert.equal(dup.json.code, 'SPEC_REFERENCE_IMAGE_IN_PROGRESS');

      const delDup = await request(port, {
        method: 'DELETE',
        path: '/_jskim/spec/reference-images/design/pc',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(
          JSON.stringify({ expectedImageRevision: `sha256:${'a'.repeat(64)}` })
        ),
      });
      assert.equal(delDup.status, 409);

      // 他 viewport は並列可
      const sp = await putMultipart(port, 'design', 'sp', [
        {
          name: 'image',
          filename: 'a.png',
          contentType: 'image/png',
          data: buildPng(3, 3, 3),
        },
      ]);
      assert.equal(sp.status, 200);

      api._releasePc();
      const done = await p1;
      assert.equal(done.status, 200);
      assert.equal(api.getRuntimeForTest('design', 'pc').status, 'idle');
    });
  });

  it('upload failure で failed(upload) と既存 current を維持', async () => {
    await withServer((port) => createApi(port), async (port, api) => {
      publicInfo = {
        status: 'current',
        imageRevision: `sha256:${'a'.repeat(64)}`,
        imageWidth: 10,
        imageHeight: 10,
        uploadedAt: '2026-01-01T00:00:00.000Z',
      };
      putImpl = async () => {
        const err = new Error('write failed');
        err.code = 'SPEC_REFERENCE_IMAGE_WRITE_FAILED';
        throw err;
      };
      const res = await putMultipart(port, 'design', 'pc', [
        {
          name: 'image',
          filename: 'a.png',
          contentType: 'image/png',
          data: buildPng(4, 4, 1),
        },
        {
          name: 'expectedImageRevision',
          data: `sha256:${'a'.repeat(64)}`,
        },
      ]);
      assert.equal(res.status, 500);
      const st = await request(port, {
        path: `${REFERENCE_IMAGE_STATUS_PATH}?screenId=design&viewport=pc`,
      });
      assert.equal(st.json.runtime.status, 'failed');
      assert.equal(st.json.runtime.operation, 'upload');
      assert.equal(st.json.referenceImage.status, 'current');
      assert.equal(
        st.json.referenceImage.imageRevision,
        `sha256:${'a'.repeat(64)}`
      );

      putImpl = async () => {
        publicInfo = {
          status: 'current',
          imageRevision: `sha256:${'b'.repeat(64)}`,
          imageWidth: 4,
          imageHeight: 4,
          uploadedAt: '2026-07-18T00:00:00.000Z',
        };
        return {
          result: 'updated',
          screenId: 'design',
          viewport: 'pc',
          imageRevision: publicInfo.imageRevision,
          imageWidth: 4,
          imageHeight: 4,
          uploadedAt: publicInfo.uploadedAt,
        };
      };
      const ok = await putMultipart(port, 'design', 'pc', [
        {
          name: 'image',
          filename: 'a.png',
          contentType: 'image/png',
          data: buildPng(4, 4, 2),
        },
        {
          name: 'expectedImageRevision',
          data: `sha256:${'a'.repeat(64)}`,
        },
      ]);
      assert.equal(ok.status, 200);
      assert.equal(api.getRuntimeForTest('design', 'pc').status, 'idle');
    });
  });

  it('invalid request は runtime entry を作らない', async () => {
    await withServer((port) => createApi(port), async (port, api) => {
      await putMultipart(port, 'design', 'bad', [
        {
          name: 'image',
          filename: 'a.png',
          contentType: 'image/png',
          data: buildPng(2, 2),
        },
      ]);
      assert.equal(api.getRuntimeForTest('design', 'bad'), undefined);
      assert.equal(api.getRuntimeForTest('design', 'pc'), undefined);
    });
  });

  it('body size 上限定数が 20MiB を超える', () => {
    assert.ok(MAX_MULTIPART_BODY_BYTES > 20 * 1024 * 1024);
    assert.ok(MAX_MULTIPART_BODY_BYTES <= 21 * 1024 * 1024);
  });

  it('same-origin 以外の PUT/DELETE を拒否し core を呼ばない', async () => {
    await withServer((port) => createApi(port), async (port) => {
      putCalls.length = 0;
      deleteCalls.length = 0;
      const boundary = '----testbound';
      const body = buildMultipartBody(boundary, [
        {
          name: 'image',
          filename: 'a.png',
          contentType: 'image/png',
          data: buildPng(2, 2, 1),
        },
      ]);
      const put = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/_jskim/spec/reference-images/design/pc',
            method: 'PUT',
            headers: {
              Host: `127.0.0.1:${port}`,
              Origin: 'http://evil.example',
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'Content-Length': String(body.length),
            },
          },
          (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
              resolve({
                status: res.statusCode,
                json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
              });
            });
          }
        );
        req.on('error', reject);
        req.end(body);
      });
      assert.equal(put.status, 403);
      assert.equal(put.json.code, 'SPEC_REFERENCE_IMAGE_FORBIDDEN_ORIGIN');
      assert.equal(putCalls.length, 0);

      const delBody = Buffer.from(
        JSON.stringify({ expectedImageRevision: `sha256:${'9'.repeat(64)}` })
      );
      const del = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/_jskim/spec/reference-images/design/pc',
            method: 'DELETE',
            headers: {
              Host: `127.0.0.1:${port}`,
              Origin: 'http://evil.example',
              'Content-Type': 'application/json',
              'Content-Length': String(delBody.length),
            },
          },
          (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
              resolve({
                status: res.statusCode,
                json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
              });
            });
          }
        );
        req.on('error', reject);
        req.end(delBody);
      });
      assert.equal(del.status, 403);
      assert.equal(deleteCalls.length, 0);
    });
  });

  it('screen 不在は 404 で runtime を作らない', async () => {
    await withServer((port) => createApi(port), async (port, api) => {
      const res = await putMultipart(port, 'missing-screen', 'pc', [
        {
          name: 'image',
          filename: 'a.png',
          contentType: 'image/png',
          data: buildPng(2, 2, 1),
        },
      ]);
      assert.equal(res.status, 404);
      assert.equal(res.json.code, 'SPEC_REFERENCE_IMAGE_SCREEN_NOT_FOUND');
      assert.equal(putCalls.length, 0);
      assert.equal(api.getRuntimeForTest('missing-screen', 'pc'), undefined);
    });
  });
});
