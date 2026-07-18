'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  createDeviceCaptureApi,
  DEVICE_CAPTURE_COLLECT_PATH,
  DEVICE_CAPTURE_STATUS_PATH,
} = require('../scripts/lib/create-device-capture-api');

function makeProject(screens) {
  return {
    screens,
  };
}

function linkedScreen(screenId = 'demo', stateIds = ['default']) {
  return {
    screenId,
    status: 'linked',
    hasImplementation: true,
    hasDescription: true,
    source: {
      screen: { id: screenId, path: '/index.html' },
      states: stateIds.map((id) => ({
        id,
        name: id,
        collect: { actions: [] },
      })),
    },
  };
}

function designOnlyScreen(screenId = 'design') {
  return {
    screenId,
    status: 'design-only',
    hasImplementation: false,
    hasDescription: true,
    source: null,
  };
}

async function withApiServer(api, fn) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    await api.handleRequest(req, res, {
      pathname: url.pathname,
      method: req.method || 'GET',
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function request(port, options) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method || 'GET',
        headers: {
          Host: `127.0.0.1:${port}`,
          Origin: `http://127.0.0.1:${port}`,
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
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json, text });
        });
      }
    );
    req.on('error', reject);
    if (options.body != null) {
      const payload =
        typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body);
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Content-Length', Buffer.byteLength(payload));
      req.write(payload);
    }
    req.end();
  });
}

describe('createDeviceCaptureApi', () => {
  let collectCalls;
  let collectImpl;
  let publicInfo;

  beforeEach(() => {
    collectCalls = [];
    collectImpl = async (opts) => {
      collectCalls.push(opts);
      return {
        status: 'created',
        screenId: opts.screenId,
        stateId: opts.stateId,
        viewport: opts.viewport,
        metadataPath: 'meta.json',
        imagePath: 'img.png',
        inputRevision: 'sha256:' + 'a'.repeat(64),
        imageRevision: 'sha256:' + 'b'.repeat(64),
      };
    };
    publicInfo = {
      status: 'current',
      inputRevision: 'sha256:' + 'a'.repeat(64),
      imageRevision: 'sha256:' + 'b'.repeat(64),
      capturedAt: '2026-07-18T00:00:00.000Z',
      imageWidth: 375,
      imageHeight: 800,
    };
  });

  function createApi(overrides = {}) {
    return createDeviceCaptureApi({
      rootDir: '/tmp/ws',
      projectName: 'demo',
      host: '127.0.0.1',
      port: 0,
      baseUrl: 'http://127.0.0.1:9',
      collectDeviceCapture: async (opts) => collectImpl(opts),
      getDeviceCapturePublicInfo: () => publicInfo,
      loadScreenSpecProject: () =>
        makeProject([
          linkedScreen('demo', ['default', 'help-modal']),
          designOnlyScreen('design'),
          {
            screenId: 'impl-only',
            status: 'implementation-only',
            hasImplementation: true,
            hasDescription: false,
            source: {
              screen: { id: 'impl-only', path: '/i.html' },
              states: [{ id: 'default', name: '初期', collect: { actions: [] } }],
            },
          },
        ]),
      ...overrides,
    });
  }

  it('POST created / GET status idle+current', async () => {
    await new Promise((resolve, reject) => {
      const server = http.createServer();
      server.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        const api = createDeviceCaptureApi({
          rootDir: '/tmp/ws',
          projectName: 'demo',
          host: '127.0.0.1',
          port,
          baseUrl: `http://127.0.0.1:${port}`,
          collectDeviceCapture: async (opts) => collectImpl(opts),
          getDeviceCapturePublicInfo: () => publicInfo,
          loadScreenSpecProject: () =>
            makeProject([linkedScreen('demo', ['default'])]),
        });
        server.removeAllListeners('request');
        server.on('request', async (req, res) => {
          const url = new URL(req.url || '/', 'http://127.0.0.1');
          await api.handleRequest(req, res, {
            pathname: url.pathname,
            method: req.method || 'GET',
          });
        });
        try {
          const post = await request(port, {
            method: 'POST',
            path: DEVICE_CAPTURE_COLLECT_PATH,
            body: {
              screenId: 'demo',
              stateId: 'default',
              viewport: 'sp',
            },
          });
          assert.equal(post.status, 200);
          assert.equal(post.json.result, 'created');
          assert.equal(post.json.capture.status, 'current');
          assert.equal(collectCalls.length, 1);

          const get = await request(port, {
            method: 'GET',
            path: `${DEVICE_CAPTURE_STATUS_PATH}?screenId=demo&stateId=default&viewport=sp`,
          });
          assert.equal(get.status, 200);
          assert.equal(get.json.runtime.status, 'idle');
          assert.equal(get.json.capture.status, 'current');
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          server.close();
        }
      });
    });
  });

  it('unknown field / invalid viewport / DESIGN_ONLY / missing state', async () => {
    await new Promise((resolve, reject) => {
      const server = http.createServer();
      server.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        const api = createDeviceCaptureApi({
          rootDir: '/tmp/ws',
          projectName: 'demo',
          host: '127.0.0.1',
          port,
          baseUrl: `http://127.0.0.1:${port}`,
          collectDeviceCapture: async (opts) => collectImpl(opts),
          getDeviceCapturePublicInfo: () => publicInfo,
          loadScreenSpecProject: () =>
            makeProject([
              linkedScreen('demo', ['default']),
              designOnlyScreen('design'),
            ]),
        });
        server.removeAllListeners('request');
        server.on('request', async (req, res) => {
          const url = new URL(req.url || '/', 'http://127.0.0.1');
          await api.handleRequest(req, res, {
            pathname: url.pathname,
            method: req.method || 'GET',
          });
        });
        try {
          const unknown = await request(port, {
            method: 'POST',
            path: DEVICE_CAPTURE_COLLECT_PATH,
            body: {
              screenId: 'demo',
              stateId: 'default',
              viewport: 'sp',
              extra: 1,
            },
          });
          assert.equal(unknown.status, 400);
          assert.equal(unknown.json.code, 'SPEC_DEVICE_CAPTURE_UNKNOWN_FIELD');

          const badVp = await request(port, {
            method: 'POST',
            path: DEVICE_CAPTURE_COLLECT_PATH,
            body: {
              screenId: 'demo',
              stateId: 'default',
              viewport: 'tablet',
            },
          });
          assert.equal(badVp.status, 400);
          assert.equal(badVp.json.code, 'SPEC_DEVICE_CAPTURE_INVALID_VIEWPORT');

          const design = await request(port, {
            method: 'POST',
            path: DEVICE_CAPTURE_COLLECT_PATH,
            body: {
              screenId: 'design',
              stateId: 'default',
              viewport: 'pc',
            },
          });
          assert.equal(design.status, 404);
          assert.equal(
            design.json.code,
            'SPEC_DEVICE_CAPTURE_IMPLEMENTATION_NOT_FOUND'
          );

          const noState = await request(port, {
            method: 'POST',
            path: DEVICE_CAPTURE_COLLECT_PATH,
            body: {
              screenId: 'demo',
              stateId: 'missing',
              viewport: 'pc',
            },
          });
          assert.equal(noState.status, 404);
          assert.equal(noState.json.code, 'SPEC_DEVICE_CAPTURE_STATE_NOT_FOUND');
          assert.equal(collectCalls.length, 0);
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          server.close();
        }
      });
    });
  });

  it('同一 key collecting 中は 409 で core を呼ばない', async () => {
    await new Promise((resolve, reject) => {
      const server = http.createServer();
      server.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        let release;
        const gate = new Promise((r) => {
          release = r;
        });
        collectImpl = async (opts) => {
          collectCalls.push(opts);
          await gate;
          return {
            status: 'created',
            screenId: opts.screenId,
            stateId: opts.stateId,
            viewport: opts.viewport,
            metadataPath: 'm',
            imagePath: 'i',
            inputRevision: 'sha256:' + 'a'.repeat(64),
            imageRevision: 'sha256:' + 'b'.repeat(64),
          };
        };
        const api = createDeviceCaptureApi({
          rootDir: '/tmp/ws',
          projectName: 'demo',
          host: '127.0.0.1',
          port,
          baseUrl: `http://127.0.0.1:${port}`,
          collectDeviceCapture: async (opts) => collectImpl(opts),
          getDeviceCapturePublicInfo: () => ({
            ...publicInfo,
            status: 'stale',
          }),
          loadScreenSpecProject: () =>
            makeProject([linkedScreen('demo', ['default'])]),
        });
        server.removeAllListeners('request');
        server.on('request', async (req, res) => {
          const url = new URL(req.url || '/', 'http://127.0.0.1');
          await api.handleRequest(req, res, {
            pathname: url.pathname,
            method: req.method || 'GET',
          });
        });
        try {
          const pending = request(port, {
            method: 'POST',
            path: DEVICE_CAPTURE_COLLECT_PATH,
            body: {
              screenId: 'demo',
              stateId: 'default',
              viewport: 'pc',
            },
          });
          await new Promise((r) => setImmediate(r));
          await new Promise((r) => setImmediate(r));

          const status = await request(port, {
            method: 'GET',
            path: `${DEVICE_CAPTURE_STATUS_PATH}?screenId=demo&stateId=default&viewport=pc`,
          });
          assert.equal(status.json.runtime.status, 'collecting');
          assert.equal(status.json.capture.status, 'stale');

          const conflict = await request(port, {
            method: 'POST',
            path: DEVICE_CAPTURE_COLLECT_PATH,
            body: {
              screenId: 'demo',
              stateId: 'default',
              viewport: 'pc',
            },
          });
          assert.equal(conflict.status, 409);
          assert.equal(conflict.json.code, 'SPEC_DEVICE_CAPTURE_IN_PROGRESS');
          assert.equal(collectCalls.length, 1);

          release();
          const done = await pending;
          assert.equal(done.status, 200);
          assert.equal(collectCalls.length, 1);
          resolve();
        } catch (err) {
          release();
          reject(err);
        } finally {
          server.close();
        }
      });
    });
  });

  it('INPUT_CHANGED は 409、失敗は failed + 既存 Capture', async () => {
    await new Promise((resolve, reject) => {
      const server = http.createServer();
      server.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        collectImpl = async () => {
          const err = new Error(
            '収集中に画面またはリソースが変更されました。最新の状態で再度収集してください。'
          );
          err.code = 'SPEC_DEVICE_CAPTURE_INPUT_CHANGED';
          throw err;
        };
        const api = createDeviceCaptureApi({
          rootDir: '/tmp/ws',
          projectName: 'demo',
          host: '127.0.0.1',
          port,
          baseUrl: `http://127.0.0.1:${port}`,
          collectDeviceCapture: async (opts) => collectImpl(opts),
          getDeviceCapturePublicInfo: () => ({
            ...publicInfo,
            status: 'stale',
          }),
          loadScreenSpecProject: () =>
            makeProject([linkedScreen('demo', ['default'])]),
        });
        server.removeAllListeners('request');
        server.on('request', async (req, res) => {
          const url = new URL(req.url || '/', 'http://127.0.0.1');
          await api.handleRequest(req, res, {
            pathname: url.pathname,
            method: req.method || 'GET',
          });
        });
        try {
          const post = await request(port, {
            method: 'POST',
            path: DEVICE_CAPTURE_COLLECT_PATH,
            body: {
              screenId: 'demo',
              stateId: 'default',
              viewport: 'sp',
            },
          });
          assert.equal(post.status, 409);
          assert.equal(post.json.code, 'SPEC_DEVICE_CAPTURE_INPUT_CHANGED');

          const get = await request(port, {
            method: 'GET',
            path: `${DEVICE_CAPTURE_STATUS_PATH}?screenId=demo&stateId=default&viewport=sp`,
          });
          assert.equal(get.json.runtime.status, 'failed');
          assert.equal(get.json.capture.status, 'stale');
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          server.close();
        }
      });
    });
  });

  it('malformed JSON / wrong Content-Type / cross-origin', async () => {
    await new Promise((resolve, reject) => {
      const server = http.createServer();
      server.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        const api = createDeviceCaptureApi({
          rootDir: '/tmp/ws',
          projectName: 'demo',
          host: '127.0.0.1',
          port,
          baseUrl: `http://127.0.0.1:${port}`,
          collectDeviceCapture: async (opts) => collectImpl(opts),
          getDeviceCapturePublicInfo: () => publicInfo,
          loadScreenSpecProject: () =>
            makeProject([linkedScreen('demo', ['default'])]),
        });
        server.removeAllListeners('request');
        server.on('request', async (req, res) => {
          const url = new URL(req.url || '/', 'http://127.0.0.1');
          await api.handleRequest(req, res, {
            pathname: url.pathname,
            method: req.method || 'GET',
          });
        });
        try {
          const badJson = await request(port, {
            method: 'POST',
            path: DEVICE_CAPTURE_COLLECT_PATH,
            body: '{',
            headers: { 'Content-Type': 'application/json' },
          });
          // request() stringifies objects; send raw
          const raw = await new Promise((res, rej) => {
            const req = http.request(
              {
                hostname: '127.0.0.1',
                port,
                path: DEVICE_CAPTURE_COLLECT_PATH,
                method: 'POST',
                headers: {
                  Host: `127.0.0.1:${port}`,
                  Origin: `http://127.0.0.1:${port}`,
                  'Content-Type': 'application/json',
                },
              },
              (r) => {
                const chunks = [];
                r.on('data', (c) => chunks.push(c));
                r.on('end', () => {
                  res({
                    status: r.statusCode,
                    json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
                  });
                });
              }
            );
            req.on('error', rej);
            req.write('{');
            req.end();
          });
          assert.equal(raw.status, 400);
          assert.equal(raw.json.code, 'SPEC_DEVICE_CAPTURE_MALFORMED_JSON');

          const media = await new Promise((res, rej) => {
            const req = http.request(
              {
                hostname: '127.0.0.1',
                port,
                path: DEVICE_CAPTURE_COLLECT_PATH,
                method: 'POST',
                headers: {
                  Host: `127.0.0.1:${port}`,
                  Origin: `http://127.0.0.1:${port}`,
                  'Content-Type': 'text/plain',
                },
              },
              (r) => {
                const chunks = [];
                r.on('data', (c) => chunks.push(c));
                r.on('end', () => {
                  res({
                    status: r.statusCode,
                    json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
                  });
                });
              }
            );
            req.on('error', rej);
            req.write('{}');
            req.end();
          });
          assert.equal(media.status, 415);

          const cross = await new Promise((res, rej) => {
            const req = http.request(
              {
                hostname: '127.0.0.1',
                port,
                path: DEVICE_CAPTURE_COLLECT_PATH,
                method: 'POST',
                headers: {
                  Host: `127.0.0.1:${port}`,
                  Origin: 'http://evil.example',
                  'Content-Type': 'application/json',
                },
              },
              (r) => {
                const chunks = [];
                r.on('data', (c) => chunks.push(c));
                r.on('end', () => {
                  res({
                    status: r.statusCode,
                    json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
                  });
                });
              }
            );
            req.on('error', rej);
            req.write(
              JSON.stringify({
                screenId: 'demo',
                stateId: 'default',
                viewport: 'pc',
              })
            );
            req.end();
          });
          assert.equal(cross.status, 403);
          void badJson;
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          server.close();
        }
      });
    });
  });
});
