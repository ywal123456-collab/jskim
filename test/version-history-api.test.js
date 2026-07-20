'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {
  createVersionHistoryApi,
  injectVersionHistoryBootstrap,
  VERSION_API_PREFIX,
  FEATURES_API_PATH,
} = require('../scripts/lib/create-version-history-api');
const {
  serializeInlineScriptJson,
} = require('../scripts/lib/serialize-inline-script-json');
const vm = require('node:vm');

function makeFacade(overrides = {}) {
  return {
    getBrowserVersionStatus: () => ({
      initialized: false,
      capability: 'local-read-only',
    }),
    listBrowserVersionRevisions: () => ({
      historyHead: null,
      revisions: [],
      nextCursor: null,
      hasMore: false,
    }),
    getBrowserVersionRevisionDetail: () => ({
      hash: 'a'.repeat(64),
      shortHash: 'aaaaaaa',
      parents: [],
      message: 'm',
      author: { name: 'n' },
      committedAt: '2026-01-01T00:00:00.000Z',
      tags: [],
      isMerge: false,
      summary: {
        changedFeatureCount: 0,
        changedScreenCount: 0,
        changedItemCount: 0,
        changedReferenceCount: 0,
        changedCaptureCount: 0,
      },
      featureChanges: [],
      screenChanges: [],
      itemChanges: [],
      assetChanges: [],
      truncated: false,
    }),
    getBrowserVersionRevisionDiff: () => ({
      hash: 'a'.repeat(64),
      shortHash: 'aaaaaaa',
      parents: [],
      message: 'm',
      author: { name: 'n' },
      committedAt: '2026-01-01T00:00:00.000Z',
      tags: [],
      isMerge: false,
      summary: {
        changedFeatureCount: 0,
        changedScreenCount: 0,
        changedItemCount: 0,
        changedReferenceCount: 0,
        changedCaptureCount: 0,
      },
      featureChanges: [],
      screenChanges: [],
      itemChanges: [],
      assetChanges: [],
      truncated: false,
    }),
    listBrowserVersionFeatures: () => ({
      features: [],
      ungroupedScreenIds: [],
    }),
    listBrowserVersionBranches: () => [],
    listBrowserVersionTags: () => [],
    ...overrides,
  };
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
      res.end('not found');
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
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe('createVersionHistoryApi unit', () => {
  it('GET status / features と header / 405 を返す', async () => {
    const api = createVersionHistoryApi({
      rootDir: path.join(os.tmpdir(), 'jskim-vh-unit'),
      projectName: 'demo',
      facade: makeFacade(),
    });
    await withApiServer(api, async (port) => {
      const status = await request(port, {
        path: `${VERSION_API_PREFIX}/status`,
      });
      assert.equal(status.status, 200);
      assert.equal(
        status.headers['content-type'],
        'application/json; charset=utf-8'
      );
      assert.equal(status.headers['cache-control'], 'no-store');
      assert.equal(status.headers['x-content-type-options'], 'nosniff');
      assert.equal(status.json.initialized, false);

      const features = await request(port, { path: FEATURES_API_PATH });
      assert.equal(features.status, 200);
      assert.deepEqual(features.json.features, []);

      const post = await request(port, {
        path: `${VERSION_API_PREFIX}/status`,
        method: 'POST',
      });
      assert.equal(post.status, 405);
      assert.equal(post.headers.allow, 'GET');
      assert.equal(post.json.code, 'SPEC_VERSION_METHOD_NOT_ALLOWED');
    });
  });

  it('不正 query と facade エラーを map する', async () => {
    const api = createVersionHistoryApi({
      rootDir: path.join(os.tmpdir(), 'jskim-vh-unit'),
      projectName: 'demo',
      facade: makeFacade({
        listBrowserVersionRevisions: () => {
          const err = new Error('未初期化');
          err.code = 'SPEC_VERSION_NOT_INITIALIZED';
          throw err;
        },
        getBrowserVersionRevisionDetail: () => {
          const err = new Error('見つかりません');
          err.code = 'SPEC_VERSION_REVISION_NOT_FOUND';
          throw err;
        },
      }),
    });
    await withApiServer(api, async (port) => {
      const badScope = await request(port, {
        path: `${VERSION_API_PREFIX}/revisions?scope=nope`,
      });
      assert.equal(badScope.status, 400);

      const dup = await request(port, {
        path: `${VERSION_API_PREFIX}/revisions?scope=project&scope=screen`,
      });
      assert.equal(dup.status, 400);

      const uninit = await request(port, {
        path: `${VERSION_API_PREFIX}/revisions?scope=project`,
      });
      assert.equal(uninit.status, 409);
      assert.equal(uninit.json.code, 'SPEC_VERSION_NOT_INITIALIZED');

      const missing = await request(port, {
        path: `${VERSION_API_PREFIX}/revisions/${'a'.repeat(64)}`,
      });
      assert.equal(missing.status, 404);
    });
  });

  it('bootstrap 注入は idempotent で projectName を含まない', () => {
    const html = '<html><body><h1>x</h1></body></html>';
    const once = injectVersionHistoryBootstrap(html);
    assert.match(once, /__JSKIM_SPEC_VERSION__/);
    assert.match(once, /local-read-only/);
    assert.doesNotMatch(once, /projectName/);
    const twice = injectVersionHistoryBootstrap(once);
    assert.equal(
      twice.split('__JSKIM_SPEC_VERSION__').length - 1,
      1
    );
  });

  it('bootstrap inline JSON は HTML-sensitive 文字を escape する', () => {
    const html = '<html><body></body></html>';
    const maliciousApiBase =
      '</script><script>window.__JSKIM_BOOTSTRAP_XSS__=1</script>';
    const injected = injectVersionHistoryBootstrap(html, {
      apiBase: maliciousApiBase,
      featuresApiBase: '<img src=x onerror=window.__JSKIM_BOOTSTRAP_XSS__=2>',
      projectName: 'ignored-project',
    });

    assert.doesNotMatch(
      injected,
      /<\/script>\s*<script>window\.__JSKIM_BOOTSTRAP_XSS__=1<\/script>/i
    );
    assert.doesNotMatch(injected, /<img src=x onerror=window\.__JSKIM_BOOTSTRAP_XSS__=2>/i);
    assert.doesNotMatch(injected, /projectName/);
    assert.equal((injected.match(/<script\b/gi) || []).length, 1);

    const scriptMatch = injected.match(
      /\/\* jskim-spec-version \*\/([\s\S]*?)<\/script>/
    );
    assert.ok(scriptMatch);
    const sandbox = { window: {} };
    vm.runInNewContext(scriptMatch[1], sandbox);
    assert.equal(sandbox.window.__JSKIM_SPEC_VERSION__.available, true);
    assert.equal(sandbox.window.__JSKIM_SPEC_VERSION__.apiBase, maliciousApiBase);
    assert.equal(
      sandbox.window.__JSKIM_SPEC_VERSION__.featuresApiBase,
      '<img src=x onerror=window.__JSKIM_BOOTSTRAP_XSS__=2>'
    );
    assert.equal(sandbox.window.__JSKIM_BOOTSTRAP_XSS__, undefined);
  });

  it('serializeInlineScriptJson は U+2028/U+2029 と引用符を安全に扱う', () => {
    const value = {
      a: 'line\u2028sep',
      b: 'para\u2029graph',
      c: '"quotes"',
      d: 'back\\slash',
      e: '山田 太郎',
      f: 'newline\nhere',
    };
    const serialized = serializeInlineScriptJson(value);
    assert.doesNotMatch(serialized, /\u2028/);
    assert.doesNotMatch(serialized, /\u2029/);
    assert.doesNotMatch(serialized, /<\//);
    assert.deepEqual(JSON.parse(serialized), value);
  });
});
