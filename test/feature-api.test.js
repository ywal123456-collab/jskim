'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {
  createFeatureApi,
  injectFeatureEditingBootstrap,
  FEATURES_API_PATH,
} = require('../scripts/lib/create-feature-api');
const {
  serializeInlineScriptJson,
} = require('../scripts/lib/serialize-inline-script-json');

function makeRevision() {
  return `sha256:${crypto.randomBytes(32).toString('hex')}`;
}

function cloneFeatures(features) {
  return features.map((feature) => ({
    ...feature,
    screenIds: [...feature.screenIds],
  }));
}

function makeInMemoryFacade(initial = {}) {
  let revision = Object.prototype.hasOwnProperty.call(initial, 'revision')
    ? initial.revision
    : null;
  let sourceExists = initial.sourceExists ?? false;
  let features = cloneFeatures(initial.features || []);
  let ungroupedScreenIds = [...(initial.ungroupedScreenIds || ['alpha', 'beta'])];

  function workingState() {
    return {
      revision,
      sourceExists,
      features: cloneFeatures(features),
      ungroupedScreenIds: [...ungroupedScreenIds],
    };
  }

  function assertRevision(expectedRevision) {
    if (expectedRevision !== revision) {
      const err = new Error('revision conflict');
      err.code = 'SPEC_FEATURE_REVISION_CONFLICT';
      err.expectedRevision = expectedRevision;
      err.currentRevision = revision;
      throw err;
    }
  }

  function bumpRevision() {
    revision = makeRevision();
    sourceExists = true;
    return revision;
  }

  function mutationResult(status, extra = {}) {
    return {
      status,
      revision,
      features: cloneFeatures(features),
      ungroupedScreenIds: [...ungroupedScreenIds],
      ...extra,
    };
  }

  return {
    getScreenFeatureWorkingState: () => workingState(),
    createScreenFeature: async (_ctx, body) => {
      assertRevision(body.expectedRevision);
      const feature = {
        featureId: body.featureId,
        name: body.name,
        displayOrder: features.length * 10 + 10,
        screenIds: [],
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
      };
      features.push(feature);
      bumpRevision();
      return mutationResult('created');
    },
    updateScreenFeature: async (_ctx, featureId, body) => {
      assertRevision(body.expectedRevision);
      const index = features.findIndex((f) => f.featureId === featureId);
      if (index < 0) {
        const err = new Error('not found');
        err.code = 'SPEC_FEATURE_NOT_FOUND';
        throw err;
      }
      features[index] = {
        ...features[index],
        name: body.name,
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
      };
      bumpRevision();
      return mutationResult('updated');
    },
    deleteScreenFeature: async (_ctx, featureId, expectedRevision) => {
      assertRevision(expectedRevision);
      const index = features.findIndex((f) => f.featureId === featureId);
      if (index < 0) {
        const err = new Error('not found');
        err.code = 'SPEC_FEATURE_NOT_FOUND';
        throw err;
      }
      const removed = features.splice(index, 1)[0];
      ungroupedScreenIds.push(...removed.screenIds);
      bumpRevision();
      return mutationResult('deleted', {
        movedScreenIds: [...removed.screenIds],
      });
    },
    reorderScreenFeatures: async (_ctx, body) => {
      assertRevision(body.expectedRevision);
      const ordered = body.orderedFeatureIds.map((id) => {
        const feature = features.find((f) => f.featureId === id);
        if (!feature) {
          const err = new Error('not found');
          err.code = 'SPEC_FEATURE_NOT_FOUND';
          throw err;
        }
        return feature;
      });
      features = ordered.map((feature, index) => ({
        ...feature,
        displayOrder: (index + 1) * 10,
      }));
      bumpRevision();
      return mutationResult('updated');
    },
    moveScreenToFeature: async (_ctx, body) => {
      assertRevision(body.expectedRevision);
      for (const feature of features) {
        feature.screenIds = feature.screenIds.filter(
          (id) => id !== body.screenId,
        );
      }
      ungroupedScreenIds = ungroupedScreenIds.filter(
        (id) => id !== body.screenId,
      );
      const target = features.find((f) => f.featureId === body.targetFeatureId);
      if (!target) {
        const err = new Error('not found');
        err.code = 'SPEC_FEATURE_NOT_FOUND';
        throw err;
      }
      const next = [...target.screenIds];
      const insertAt =
        body.targetIndex === undefined
          ? next.length
          : Number(body.targetIndex);
      next.splice(insertAt, 0, body.screenId);
      target.screenIds = next;
      bumpRevision();
      return mutationResult('updated', { movedScreenIds: [body.screenId] });
    },
    reorderFeatureScreens: async (_ctx, featureId, body) => {
      assertRevision(body.expectedRevision);
      const feature = features.find((f) => f.featureId === featureId);
      if (!feature) {
        const err = new Error('not found');
        err.code = 'SPEC_FEATURE_NOT_FOUND';
        throw err;
      }
      feature.screenIds = [...body.orderedScreenIds];
      bumpRevision();
      return mutationResult('updated');
    },
    moveFeatureDirection: async (_ctx, body) => {
      assertRevision(body.expectedRevision);
      const index = features.findIndex((f) => f.featureId === body.featureId);
      if (index < 0) {
        const err = new Error('not found');
        err.code = 'SPEC_FEATURE_NOT_FOUND';
        throw err;
      }
      const target = body.direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= features.length) {
        const err = new Error('invalid');
        err.code = 'SPEC_FEATURE_INVALID_INPUT';
        throw err;
      }
      const next = [...features];
      [next[index], next[target]] = [next[target], next[index]];
      features = next.map((feature, i) => ({
        ...feature,
        displayOrder: (i + 1) * 10,
      }));
      bumpRevision();
      return mutationResult('updated');
    },
    moveScreenFeatureDirection: async (_ctx, featureId, body) => {
      assertRevision(body.expectedRevision);
      const feature = features.find((f) => f.featureId === featureId);
      if (!feature) {
        const err = new Error('not found');
        err.code = 'SPEC_FEATURE_NOT_FOUND';
        throw err;
      }
      const index = feature.screenIds.indexOf(body.screenId);
      if (index < 0) {
        const err = new Error('unknown screen');
        err.code = 'SPEC_FEATURE_UNKNOWN_SCREEN';
        throw err;
      }
      const target = body.direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= feature.screenIds.length) {
        const err = new Error('invalid');
        err.code = 'SPEC_FEATURE_INVALID_INPUT';
        throw err;
      }
      const next = [...feature.screenIds];
      [next[index], next[target]] = [next[target], next[index]];
      feature.screenIds = next;
      bumpRevision();
      return mutationResult('updated');
    },
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
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function jsonRequest(port, options) {
  const body =
    options.body === undefined ? undefined : JSON.stringify(options.body);
  return request(port, {
    ...options,
    body,
    headers: {
      'Content-Type': 'application/json',
      ...(body !== undefined
        ? { 'Content-Length': Buffer.byteLength(body) }
        : {}),
      ...(options.headers || {}),
    },
  });
}

function assertJsonSecurityHeaders(t, headers, options = {}) {
  assert.equal(headers['cache-control'], 'no-store', `${t}: Cache-Control`);
  assert.equal(
    headers['x-content-type-options'],
    'nosniff',
    `${t}: X-Content-Type-Options`,
  );
  if (options.expectJsonContentType !== false) {
    assert.equal(
      headers['content-type'],
      'application/json; charset=utf-8',
      `${t}: Content-Type`,
    );
  }
  if (options.allow) {
    assert.equal(headers.allow, options.allow, `${t}: Allow`);
  }
}

describe('createFeatureApi unit', () => {
  it('GET working state は revision と header を返す', async () => {
    const revision = makeRevision();
    const api = createFeatureApi({
      rootDir: path.join(os.tmpdir(), 'jskim-feat-unit'),
      projectName: 'demo',
      host: '127.0.0.1',
      port: 0,
      listScreenIds: () => ['alpha', 'beta'],
      facade: makeInMemoryFacade({
        revision,
        sourceExists: true,
        features: [
          {
            featureId: 'inquiry',
            name: '問い合わせ',
            displayOrder: 10,
            screenIds: ['alpha'],
          },
        ],
        ungroupedScreenIds: ['beta'],
      }),
    });

    await withApiServer(api, async (port) => {
      const res = await request(port, { path: FEATURES_API_PATH });
      assert.equal(res.status, 200);
      assertJsonSecurityHeaders('GET success', res.headers);
      assert.equal(res.json.revision, revision);
      assert.equal(res.json.sourceExists, true);
      assert.equal(res.json.features.length, 1);
      assert.deepEqual(res.json.ungroupedScreenIds, ['beta']);

      const head = await request(port, {
        path: FEATURES_API_PATH,
        method: 'HEAD',
      });
      assert.equal(head.status, 200);
      assert.equal(head.text, '');
      assertJsonSecurityHeaders('HEAD success', head.headers);
    });
  });

  it('JSON 応答は security header 契約を満たす', async () => {
    const revision = makeRevision();
    const api = createFeatureApi({
      rootDir: path.join(os.tmpdir(), 'jskim-feat-unit'),
      projectName: 'demo',
      host: '127.0.0.1',
      port: 0,
      listScreenIds: () => ['alpha'],
      facade: makeInMemoryFacade({
        revision,
        sourceExists: true,
        features: [],
        ungroupedScreenIds: ['alpha'],
      }),
    });

    await withApiServer(api, async (port) => {
      const get = await request(port, { path: FEATURES_API_PATH });
      assert.equal(get.status, 200);
      assertJsonSecurityHeaders('GET success', get.headers);

      const head = await request(port, {
        path: FEATURES_API_PATH,
        method: 'HEAD',
      });
      assert.equal(head.status, 200);
      assertJsonSecurityHeaders('HEAD success', head.headers);

      const post = await jsonRequest(port, {
        path: FEATURES_API_PATH,
        method: 'POST',
        body: {
          featureId: 'inquiry',
          name: '問い合わせ',
          expectedRevision: revision,
        },
      });
      assert.equal(post.status, 201);
      assertJsonSecurityHeaders('POST success', post.headers);

      const malformed = await request(port, {
        path: FEATURES_API_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{not-json',
      });
      assert.equal(malformed.status, 400);
      assert.equal(malformed.json.code, 'SPEC_FEATURE_INVALID_INPUT');
      assertJsonSecurityHeaders('400 malformed request', malformed.headers);

      const forbidden = await jsonRequest(port, {
        path: FEATURES_API_PATH,
        method: 'POST',
        headers: {
          Origin: 'http://evil.example.com',
        },
        body: {
          featureId: 'blocked',
          name: 'blocked',
          expectedRevision: post.json.revision,
        },
      });
      assert.equal(forbidden.status, 403);
      assert.equal(forbidden.json.code, 'SPEC_FEATURE_FORBIDDEN_ORIGIN');
      assertJsonSecurityHeaders('403 same-origin', forbidden.headers);

      const unknown = await request(port, {
        path: `${FEATURES_API_PATH}/missing/route`,
      });
      assert.equal(unknown.status, 404);
      assert.equal(unknown.json.code, 'SPEC_FEATURE_ROUTE_NOT_FOUND');
      assertJsonSecurityHeaders('404 unknown route', unknown.headers);

      const unsupported = await jsonRequest(port, {
        path: FEATURES_API_PATH,
        method: 'PUT',
        body: { expectedRevision: post.json.revision },
      });
      assert.equal(unsupported.status, 405);
      assert.equal(unsupported.json.code, 'SPEC_FEATURE_METHOD_NOT_ALLOWED');
      assertJsonSecurityHeaders('405 unsupported method', unsupported.headers, {
        allow: 'GET, HEAD, POST',
      });

      const conflict = await jsonRequest(port, {
        path: FEATURES_API_PATH,
        method: 'POST',
        body: {
          featureId: 'conflict',
          name: 'conflict',
          expectedRevision: makeRevision(),
        },
      });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.json.code, 'SPEC_FEATURE_REVISION_CONFLICT');
      assertJsonSecurityHeaders('409 revision conflict', conflict.headers);

      const huge = JSON.stringify({
        featureId: 'inquiry',
        name: 'x'.repeat(300 * 1024),
        expectedRevision: post.json.revision,
      });
      const tooLarge = await request(port, {
        path: FEATURES_API_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: huge,
      });
      assert.equal(tooLarge.status, 413);
      assert.equal(tooLarge.json.code, 'SPEC_FEATURE_BODY_TOO_LARGE');
      assertJsonSecurityHeaders('413 body too large', tooLarge.headers);

      const invalidType = await request(port, {
        path: FEATURES_API_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: '{}',
      });
      assert.equal(invalidType.status, 415);
      assert.equal(invalidType.json.code, 'SPEC_FEATURE_INVALID_CONTENT_TYPE');
      assertJsonSecurityHeaders('415 invalid Content-Type', invalidType.headers);
    });
  });

  it('POST create / PATCH update / DELETE / reorder / move screen を処理する', async () => {
    const api = createFeatureApi({
      rootDir: path.join(os.tmpdir(), 'jskim-feat-unit'),
      projectName: 'demo',
      host: '127.0.0.1',
      port: 0,
      listScreenIds: () => ['alpha', 'beta'],
      facade: makeInMemoryFacade({
        revision: null,
        sourceExists: false,
        features: [],
        ungroupedScreenIds: ['alpha', 'beta'],
      }),
    });

    await withApiServer(api, async (port) => {
      const initial = await request(port, { path: FEATURES_API_PATH });
      assert.equal(initial.status, 200);
      assert.equal(initial.json.revision, null);

      const created = await jsonRequest(port, {
        path: FEATURES_API_PATH,
        method: 'POST',
        body: {
          featureId: 'inquiry',
          name: '問い合わせ',
          description: '説明',
          expectedRevision: null,
        },
      });
      assert.equal(created.status, 201);
      assert.equal(created.json.status, 'created');
      assert.ok(created.json.revision);
      const revision = created.json.revision;

      const updated = await jsonRequest(port, {
        path: `${FEATURES_API_PATH}/inquiry`,
        method: 'PATCH',
        body: {
          name: '問い合わせ更新',
          description: '更新説明',
          expectedRevision: revision,
        },
      });
      assert.equal(updated.status, 200);
      assert.equal(updated.json.status, 'updated');
      assert.notEqual(updated.json.revision, revision);
      const nextRevision = updated.json.revision;

      const moved = await jsonRequest(port, {
        path: `${FEATURES_API_PATH}/screens:move`,
        method: 'POST',
        body: {
          screenId: 'alpha',
          targetFeatureId: 'inquiry',
          expectedRevision: nextRevision,
        },
      });
      assert.equal(moved.status, 200);
      assert.deepEqual(moved.json.movedScreenIds, ['alpha']);
      const moveRevision = moved.json.revision;

      const reorderedScreens = await jsonRequest(port, {
        path: `${FEATURES_API_PATH}/inquiry/screens:reorder`,
        method: 'POST',
        body: {
          orderedScreenIds: ['alpha'],
          expectedRevision: moveRevision,
        },
      });
      assert.equal(reorderedScreens.status, 200);

      const createdSecond = await jsonRequest(port, {
        path: FEATURES_API_PATH,
        method: 'POST',
        body: {
          featureId: 'other',
          name: 'その他',
          expectedRevision: reorderedScreens.json.revision,
        },
      });
      assert.equal(createdSecond.status, 201);

      const reorderedFeatures = await jsonRequest(port, {
        path: `${FEATURES_API_PATH}:reorder`,
        method: 'POST',
        body: {
          orderedFeatureIds: ['other', 'inquiry'],
          expectedRevision: createdSecond.json.revision,
        },
      });
      assert.equal(reorderedFeatures.status, 200);
      assert.equal(reorderedFeatures.json.features[0].featureId, 'other');

      const deleted = await jsonRequest(port, {
        path: `${FEATURES_API_PATH}/other`,
        method: 'DELETE',
        body: {
          expectedRevision: reorderedFeatures.json.revision,
        },
      });
      assert.equal(deleted.status, 200);
      assert.equal(deleted.json.status, 'deleted');
      assert.deepEqual(deleted.json.ungroupedScreenIds, ['beta']);
    });
  });

  it('expectedRevision 欠落は 400', async () => {
    const api = createFeatureApi({
      rootDir: path.join(os.tmpdir(), 'jskim-feat-unit'),
      projectName: 'demo',
      listScreenIds: () => ['alpha'],
      facade: makeInMemoryFacade(),
    });

    await withApiServer(api, async (port) => {
      const res = await jsonRequest(port, {
        path: FEATURES_API_PATH,
        method: 'POST',
        body: {
          featureId: 'inquiry',
          name: '問い合わせ',
        },
      });
      assert.equal(res.status, 400);
      assert.equal(res.json.code, 'SPEC_FEATURE_INVALID_INPUT');
      assert.match(res.json.message, /expectedRevision/);
    });
  });

  it('revision conflict は 409', async () => {
    const revision = makeRevision();
    const api = createFeatureApi({
      rootDir: path.join(os.tmpdir(), 'jskim-feat-unit'),
      projectName: 'demo',
      listScreenIds: () => ['alpha'],
      facade: makeInMemoryFacade({
        revision,
        sourceExists: true,
        features: [],
        ungroupedScreenIds: ['alpha'],
      }),
    });

    await withApiServer(api, async (port) => {
      const res = await jsonRequest(port, {
        path: FEATURES_API_PATH,
        method: 'POST',
        body: {
          featureId: 'inquiry',
          name: '問い合わせ',
          expectedRevision: makeRevision(),
        },
      });
      assert.equal(res.status, 409);
      assert.equal(res.json.code, 'SPEC_FEATURE_REVISION_CONFLICT');
      assert.ok(Object.prototype.hasOwnProperty.call(res.json, 'expectedRevision'));
      assert.ok(Object.prototype.hasOwnProperty.call(res.json, 'currentRevision'));
    });
  });

  it('不正 Origin は 403', async () => {
    const api = createFeatureApi({
      rootDir: path.join(os.tmpdir(), 'jskim-feat-unit'),
      projectName: 'demo',
      host: '127.0.0.1',
      listScreenIds: () => ['alpha'],
      facade: makeInMemoryFacade(),
    });

    await withApiServer(api, async (port) => {
      const res = await jsonRequest(port, {
        path: FEATURES_API_PATH,
        method: 'POST',
        headers: {
          Origin: 'http://evil.example.com',
        },
        body: {
          featureId: 'inquiry',
          name: '問い合わせ',
          expectedRevision: null,
        },
      });
      assert.equal(res.status, 403);
      assert.equal(res.json.code, 'SPEC_FEATURE_FORBIDDEN_ORIGIN');
    });
  });

  it('本文サイズ超過は 413', async () => {
    const api = createFeatureApi({
      rootDir: path.join(os.tmpdir(), 'jskim-feat-unit'),
      projectName: 'demo',
      listScreenIds: () => ['alpha'],
      facade: makeInMemoryFacade(),
    });

    await withApiServer(api, async (port) => {
      const huge = JSON.stringify({
        featureId: 'inquiry',
        name: 'x'.repeat(300 * 1024),
        expectedRevision: null,
      });
      const res = await request(port, {
        path: FEATURES_API_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: huge,
      });
      assert.equal(res.status, 413);
      assert.equal(res.json.code, 'SPEC_FEATURE_BODY_TOO_LARGE');
    });
  });

  it('Content-Type 不正は 415', async () => {
    const api = createFeatureApi({
      rootDir: path.join(os.tmpdir(), 'jskim-feat-unit'),
      projectName: 'demo',
      listScreenIds: () => ['alpha'],
      facade: makeInMemoryFacade(),
    });

    await withApiServer(api, async (port) => {
      const res = await request(port, {
        path: FEATURES_API_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: '{}',
      });
      assert.equal(res.status, 415);
      assert.equal(res.json.code, 'SPEC_FEATURE_INVALID_CONTENT_TYPE');
    });
  });

  it('未知フィールドは 400', async () => {
    const api = createFeatureApi({
      rootDir: path.join(os.tmpdir(), 'jskim-feat-unit'),
      projectName: 'demo',
      listScreenIds: () => ['alpha'],
      facade: makeInMemoryFacade(),
    });

    await withApiServer(api, async (port) => {
      const res = await jsonRequest(port, {
        path: FEATURES_API_PATH,
        method: 'POST',
        body: {
          featureId: 'inquiry',
          name: '問い合わせ',
          expectedRevision: null,
          token: 'secret',
        },
      });
      assert.equal(res.status, 400);
      assert.match(res.json.message, /token/);
    });
  });

  it('未対応 HTTP メソッドは 405', async () => {
    const api = createFeatureApi({
      rootDir: path.join(os.tmpdir(), 'jskim-feat-unit'),
      projectName: 'demo',
      listScreenIds: () => ['alpha'],
      facade: makeInMemoryFacade(),
    });

    await withApiServer(api, async (port) => {
      const post = await jsonRequest(port, {
        path: FEATURES_API_PATH,
        method: 'PATCH',
        body: { expectedRevision: null },
      });
      assert.equal(post.status, 405);
      assert.equal(post.json.code, 'SPEC_FEATURE_METHOD_NOT_ALLOWED');
    });
  });

  it('エラー応答は stack / path を含まない', async () => {
    const base = makeInMemoryFacade();
    const api = createFeatureApi({
      rootDir: path.join(os.tmpdir(), 'jskim-feat-unit'),
      projectName: 'demo',
      listScreenIds: () => ['alpha'],
      facade: {
        ...base,
        createScreenFeature: async () => {
          const err = new Error(
            'failed at C:\\Users\\secret\\repo\\features.json',
          );
          err.code = 'SPEC_FEATURE_INTERNAL';
          err.stack = 'Error: failed\n    at C:\\Users\\secret\\repo';
          throw err;
        },
      },
    });

    await withApiServer(api, async (port) => {
      const res = await jsonRequest(port, {
        path: FEATURES_API_PATH,
        method: 'POST',
        body: {
          featureId: 'inquiry',
          name: '問い合わせ',
          expectedRevision: null,
        },
      });
      assert.equal(res.status, 500);
      assert.equal(res.json.code, 'SPEC_FEATURE_INTERNAL');
      assert.doesNotMatch(res.text, /"stack"/);
      assert.doesNotMatch(res.text, /C:\\Users\\secret/);
      assert.doesNotMatch(res.text, /"path"/);
    });
  });

  it('bootstrap 注入は idempotent で XSS 安全', () => {
    const html = '<html><body><h1>x</h1></body></html>';
    const once = injectFeatureEditingBootstrap(html);
    assert.match(once, /__JSKIM_SPEC_FEATURE__/);
    assert.match(once, /local-mutation/);
    const twice = injectFeatureEditingBootstrap(once);
    assert.equal(
      twice.split('__JSKIM_SPEC_FEATURE__').length - 1,
      1,
    );
  });

  it('bootstrap inline JSON は HTML-sensitive 文字を escape する', () => {
    const html = '<html><body></body></html>';
    const maliciousApiBase =
      '</script><script>window.__JSKIM_BOOTSTRAP_XSS__=1</script>';
    const injected = injectFeatureEditingBootstrap(html, {
      apiBase: maliciousApiBase,
    });

    assert.doesNotMatch(
      injected,
      /<\/script>\s*<script>window\.__JSKIM_BOOTSTRAP_XSS__=1<\/script>/i,
    );
    assert.equal((injected.match(/<script\b/gi) || []).length, 1);

    const scriptMatch = injected.match(
      /\/\* jskim-spec-feature \*\/([\s\S]*?)<\/script>/,
    );
    assert.ok(scriptMatch);
    const sandbox = { window: {} };
    vm.runInNewContext(scriptMatch[1], sandbox);
    assert.equal(sandbox.window.__JSKIM_SPEC_FEATURE__.enabled, true);
    assert.equal(
      sandbox.window.__JSKIM_SPEC_FEATURE__.apiBase,
      maliciousApiBase,
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
