'use strict';

/**
 * Phase 7D-2: Figma Import / Reimport HTTP API（mock core、実 Figma なし）。
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  createReferenceImageApi,
  REFERENCE_IMAGE_STATUS_PATH,
} = require('../scripts/lib/create-reference-image-api');
const {
  parseFigmaImportBody,
  parseFigmaReimportBody,
  mapFigmaApiError,
  toFigmaSuccessResponse,
  sanitizeUpgradeLink,
  sanitizeRetryAfterSeconds,
} = require('../scripts/lib/figma-reference-image-api');

const REV1 = `sha256:${'a'.repeat(64)}`;
const REV2 = `sha256:${'b'.repeat(64)}`;

function designOnly(screenId = 'design') {
  return {
    screenId,
    status: 'design-only',
    hasImplementation: false,
    hasDescription: true,
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
          resolve({
            status: res.statusCode,
            json,
            body: buf,
            headers: res.headers,
          });
        });
      }
    );
    req.on('error', reject);
    if (options.destroyAfterMs != null) {
      req.on('socket', (socket) => {
        setTimeout(() => {
          socket.destroy();
        }, options.destroyAfterMs);
      });
    }
    if (body) {
      req.end(body);
    } else {
      req.end();
    }
  });
}

function postJson(port, path, body, extras = {}) {
  return request(port, {
    method: extras.method || 'POST',
    path,
    headers: {
      'Content-Type': 'application/json',
      ...(extras.headers || {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
    destroyAfterMs: extras.destroyAfterMs,
  });
}

function importPath(screenId, viewport) {
  return `/_jskim/spec/reference-images/${screenId}/${viewport}/figma:import`;
}

function reimportPath(screenId, viewport) {
  return `/_jskim/spec/reference-images/${screenId}/${viewport}/figma:reimport`;
}

function successResult(overrides = {}) {
  return {
    result: 'created',
    screenId: 'design',
    viewport: 'pc',
    imageRevision: REV1,
    imageWidth: 1440,
    imageHeight: 2000,
    uploadedAt: '2026-07-19T00:00:00.000Z',
    frame: {
      fileKey: 'SECRET_FILE',
      nodeId: '1:3',
      frameName: 'Hero',
      width: 1440,
      height: 2000,
    },
    ...overrides,
  };
}

describe('figma-reference-image-api helpers', () => {
  it('Import body: URL / 直接入力 / 同時指定 / token 拒否', () => {
    assert.equal(
      parseFigmaImportBody({
        figmaUrl: 'https://www.figma.com/design/AAA/Name?node-id=1-2',
      }).ok,
      true,
    );
    assert.equal(
      parseFigmaImportBody({ fileKey: 'AAA', nodeId: '1:2' }).ok,
      true,
    );
    assert.equal(
      parseFigmaImportBody({
        figmaUrl: 'https://www.figma.com/design/AAA',
        fileKey: 'AAA',
        nodeId: '1:2',
      }).ok,
      false,
    );
    const tokenRejected = parseFigmaImportBody({
      figmaUrl: 'https://www.figma.com/design/AAA',
      token: 'secret',
    });
    assert.equal(tokenRejected.ok, false);
    assert.equal(tokenRejected.code, 'SPEC_FIGMA_INPUT_INVALID');
  });

  it('Reimport body: expected のみ / Figma 入力拒否', () => {
    assert.equal(
      parseFigmaReimportBody({ expectedImageRevision: REV1 }).ok,
      true,
    );
    assert.equal(
      parseFigmaReimportBody({
        expectedImageRevision: REV1,
        fileKey: 'AAA',
      }).ok,
      false,
    );
    assert.equal(parseFigmaReimportBody(null).ok, false);
  });

  it('rate limit sanitize', () => {
    assert.equal(sanitizeRetryAfterSeconds(12.9), 12);
    assert.equal(sanitizeRetryAfterSeconds(-1), undefined);
    assert.equal(
      sanitizeUpgradeLink('https://www.figma.com/pricing'),
      'https://www.figma.com/pricing',
    );
    assert.equal(
      sanitizeUpgradeLink('https://evil.example/figma.com'),
      undefined,
    );
    assert.equal(sanitizeUpgradeLink('http://www.figma.com/x'), undefined);
  });

  it('成功 projection は fileKey/nodeId を含めない', () => {
    const payload = toFigmaSuccessResponse(
      'design',
      'pc',
      successResult({
        sizeMismatch: {
          code: 'SPEC_FIGMA_VIEWPORT_SIZE_MISMATCH',
          message: '不一致',
          frameWidth: 1600,
          frameHeight: 3000,
          viewportWidth: 1440,
          viewportHeight: 900,
        },
      }),
    );
    const text = JSON.stringify(payload);
    assert.equal(payload.source.type, 'figma');
    assert.equal(payload.frame.frameName, 'Hero');
    assert.ok(payload.warnings);
    assert.doesNotMatch(text, /"fileKey"/);
    assert.doesNotMatch(text, /"nodeId"/);
    assert.doesNotMatch(text, /SECRET_FILE/);
  });

  it('mapFigmaApiError: 429 / Retry-After', () => {
    const mapped = mapFigmaApiError(
      {
        name: 'FigmaError',
        code: 'SPEC_FIGMA_RATE_LIMITED',
        message: '制限',
        details: {
          retryAfterSeconds: 9,
          planTier: 'starter',
          rateLimitType: 'low',
          upgradeLink: 'https://www.figma.com/pricing\r\nX-Injected: 1',
        },
      },
      () => ({ statusCode: 500, code: 'X', message: 'x' }),
    );
    assert.equal(mapped.statusCode, 429);
    assert.equal(mapped.headers['Retry-After'], '9');
    assert.equal(mapped.bodyExtra.retryAfterSeconds, 9);
    assert.equal(mapped.bodyExtra.upgradeLink, undefined);
  });
});

describe('createReferenceImageApi Figma endpoints', () => {
  let importCalls;
  let reimportCalls;
  let importImpl;
  let reimportImpl;
  let publicInfo;
  let screens;

  beforeEach(() => {
    importCalls = [];
    reimportCalls = [];
    screens = [designOnly('design'), designOnly('other')];
    publicInfo = { status: 'missing' };
    importImpl = async (opts) => {
      importCalls.push(opts);
      const result = successResult({
        result: 'created',
        screenId: opts.screenId,
        viewport: opts.viewport,
      });
      publicInfo = {
        status: 'current',
        imageRevision: result.imageRevision,
        imageWidth: result.imageWidth,
        imageHeight: result.imageHeight,
        uploadedAt: result.uploadedAt,
      };
      return result;
    };
    reimportImpl = async (opts) => {
      reimportCalls.push(opts);
      return successResult({
        result: 'updated',
        screenId: opts.screenId,
        viewport: opts.viewport,
        imageRevision: REV2,
      });
    };
  });

  function createApi(port, overrides = {}) {
    return createReferenceImageApi({
      rootDir: '/tmp/ws',
      projectName: 'demo',
      host: '127.0.0.1',
      port,
      putReferenceImage: async () => {
        throw new Error('put should not run');
      },
      deleteReferenceImage: async () => {
        throw new Error('delete should not run');
      },
      getReferenceImagePublicInfo: () => publicInfo,
      loadScreenSpecProject: () => ({ screens }),
      importFigmaReferenceImage: async (opts) => importImpl(opts),
      reimportFigmaReferenceImage: async (opts) => reimportImpl(opts),
      ...overrides,
    });
  }

  it('Import URL / fileKey+nodeId 成功と browser-safe source', async () => {
    await withServer((port) => createApi(port), async (port) => {
      const byUrl = await postJson(port, importPath('design', 'pc'), {
        figmaUrl: 'https://www.figma.com/design/AAA/Name?node-id=1-2',
      });
      assert.equal(byUrl.status, 200);
      assert.equal(byUrl.json.result, 'created');
      assert.equal(byUrl.json.source.type, 'figma');
      assert.equal(byUrl.json.frame.frameName, 'Hero');
      assert.equal(byUrl.json.referenceImage.imageRevision, REV1);
      assert.doesNotMatch(JSON.stringify(byUrl.json), /"fileKey"/);
      assert.equal(importCalls[0].figmaUrl.includes('figma.com'), true);
      assert.equal(importCalls[0].fileKey, undefined);

      importCalls.length = 0;
      const byKey = await postJson(port, importPath('design', 'sp'), {
        fileKey: 'AAA',
        nodeId: '1:2',
        expectedImageRevision: null,
      });
      assert.equal(byKey.status, 200);
      assert.equal(importCalls[0].fileKey, 'AAA');
      assert.equal(importCalls[0].nodeId, '1:2');
      assert.equal(importCalls[0].expectedImageRevision, null);
    });
  });

  it('Import unchanged / sizeMismatch warning / Reimport', async () => {
    await withServer((port) => createApi(port), async (port) => {
      importImpl = async (opts) => {
        importCalls.push(opts);
        return successResult({
          result: 'unchanged',
          sizeMismatch: {
            code: 'SPEC_FIGMA_VIEWPORT_SIZE_MISMATCH',
            message: 'Frame サイズが異なります',
            frameWidth: 1600,
            frameHeight: 3000,
            viewportWidth: 1440,
            viewportHeight: 900,
          },
        });
      };
      const unchanged = await postJson(port, importPath('design', 'pc'), {
        fileKey: 'AAA',
        nodeId: '1:2',
        expectedImageRevision: REV1,
      });
      assert.equal(unchanged.status, 200);
      assert.equal(unchanged.json.result, 'unchanged');
      assert.equal(
        unchanged.json.warnings[0].code,
        'SPEC_FIGMA_VIEWPORT_SIZE_MISMATCH',
      );

      const re = await postJson(port, reimportPath('design', 'pc'), {
        expectedImageRevision: REV1,
      });
      assert.equal(re.status, 200);
      assert.equal(re.json.result, 'updated');
      assert.equal(reimportCalls.length, 1);
      assert.equal(reimportCalls[0].expectedImageRevision, REV1);
    });
  });

  it('validation: token / 同時入力 / Reimport 入力 / method / path', async () => {
    await withServer((port) => createApi(port), async (port) => {
      const token = await postJson(port, importPath('design', 'pc'), {
        figmaUrl: 'https://www.figma.com/design/AAA',
        token: 'leak',
      });
      assert.equal(token.status, 400);
      assert.equal(importCalls.length, 0);

      const both = await postJson(port, importPath('design', 'pc'), {
        figmaUrl: 'https://www.figma.com/design/AAA',
        fileKey: 'AAA',
        nodeId: '1:2',
      });
      assert.equal(both.status, 400);

      const reBad = await postJson(port, reimportPath('design', 'pc'), {
        expectedImageRevision: REV1,
        figmaUrl: 'https://www.figma.com/design/AAA',
      });
      assert.equal(reBad.status, 400);
      assert.equal(reimportCalls.length, 0);

      const badMethod = await postJson(
        port,
        importPath('design', 'pc'),
        { fileKey: 'A', nodeId: '1:2' },
        { method: 'PUT' },
      );
      assert.equal(badMethod.status, 405);

      const badViewport = await postJson(port, importPath('design', 'tablet'), {
        fileKey: 'A',
        nodeId: '1:2',
      });
      assert.equal(badViewport.status, 400);

      const noBody = await request(port, {
        method: 'POST',
        path: importPath('design', 'pc'),
        headers: { 'Content-Type': 'application/json' },
      });
      assert.equal(noBody.status, 400);

      const badJson = await request(port, {
        method: 'POST',
        path: importPath('design', 'pc'),
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      });
      assert.equal(badJson.status, 400);
    });
  });

  it('同一 target の Import 二重は 409、別 viewport/screen は並行可', async () => {
    await withServer((port) => createApi(port), async (port, api) => {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      importImpl = async (opts) => {
        importCalls.push(opts);
        await gate;
        return successResult({
          screenId: opts.screenId,
          viewport: opts.viewport,
        });
      };

      const firstPromise = postJson(port, importPath('design', 'pc'), {
        fileKey: 'AAA',
        nodeId: '1:2',
      });
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(api.getRuntimeForTest('design', 'pc').status, 'importing');

      const second = await postJson(port, importPath('design', 'pc'), {
        fileKey: 'AAA',
        nodeId: '1:2',
      });
      assert.equal(second.status, 409);
      assert.equal(second.json.code, 'SPEC_REFERENCE_IMAGE_IN_PROGRESS');

      const otherVp = postJson(port, importPath('design', 'sp'), {
        fileKey: 'AAA',
        nodeId: '1:2',
      });
      const otherScreen = postJson(port, importPath('other', 'pc'), {
        fileKey: 'AAA',
        nodeId: '1:2',
      });

      release();
      const first = await firstPromise;
      assert.equal(first.status, 200);
      const vpRes = await otherVp;
      const scRes = await otherScreen;
      assert.equal(vpRes.status, 200);
      assert.equal(scRes.status, 200);
      assert.equal(api.getRuntimeForTest('design', 'pc').status, 'idle');
    });
  });

  it('Import + Reimport 共有 lock / 失敗後に再リクエスト可', async () => {
    await withServer((port) => createApi(port), async (port) => {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      importImpl = async (opts) => {
        importCalls.push(opts);
        await gate;
        return successResult();
      };
      const firstPromise = postJson(port, importPath('design', 'pc'), {
        fileKey: 'AAA',
        nodeId: '1:2',
      });
      await new Promise((r) => setTimeout(r, 20));
      const blocked = await postJson(port, reimportPath('design', 'pc'), {
        expectedImageRevision: REV1,
      });
      assert.equal(blocked.status, 409);
      release();
      await firstPromise;

      importImpl = async () => {
        const err = new Error('not found');
        err.code = 'SPEC_FIGMA_FILE_NOT_FOUND';
        throw err;
      };
      const failed = await postJson(port, importPath('design', 'pc'), {
        fileKey: 'AAA',
        nodeId: '1:2',
      });
      assert.equal(failed.status, 404);

      importImpl = async (opts) => {
        importCalls.push(opts);
        return successResult();
      };
      const again = await postJson(port, importPath('design', 'pc'), {
        fileKey: 'AAA',
        nodeId: '1:2',
      });
      assert.equal(again.status, 200);
    });
  });

  it('client disconnect で AbortSignal と lock 解放', async () => {
    await withServer((port) => createApi(port), async (port, api) => {
      let sawAbort = false;
      importImpl = async (opts) => {
        importCalls.push(opts);
        assert.ok(opts.signal);
        return new Promise((resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            sawAbort = true;
            const err = new Error('aborted');
            err.code = 'SPEC_FIGMA_ABORTED';
            reject(err);
          });
        });
      };

      await assert.rejects(
        () =>
          postJson(
            port,
            importPath('design', 'pc'),
            { fileKey: 'AAA', nodeId: '1:2' },
            { destroyAfterMs: 40 },
          ),
        (err) => err && (err.code === 'ECONNRESET' || err.message),
      );

      await new Promise((r) => setTimeout(r, 80));
      assert.equal(sawAbort, true);
      const runtime = api.getRuntimeForTest('design', 'pc');
      assert.ok(!runtime || runtime.status === 'idle');

      importImpl = async (opts) => {
        importCalls.push(opts);
        return successResult();
      };
      const again = await postJson(port, importPath('design', 'pc'), {
        fileKey: 'AAA',
        nodeId: '1:2',
      });
      assert.equal(again.status, 200);
    });
  });

  it('エラー HTTP マッピングと秘密非露出', async () => {
    const cases = [
      ['SPEC_FIGMA_TOKEN_MISSING', 500],
      ['SPEC_FIGMA_UNAUTHORIZED', 401],
      ['SPEC_FIGMA_FORBIDDEN', 403],
      ['SPEC_FIGMA_FILE_NOT_FOUND', 404],
      ['SPEC_FIGMA_NODE_NOT_FOUND', 404],
      ['SPEC_FIGMA_NODE_NOT_FRAME', 400],
      ['SPEC_FIGMA_TIMEOUT', 504],
      ['SPEC_FIGMA_EXPORT_FAILED', 502],
      ['SPEC_FIGMA_DOWNLOAD_FAILED', 502],
      ['SPEC_FIGMA_IMAGE_TOO_LARGE', 413],
      ['SPEC_FIGMA_SOURCE_MISSING', 400],
      ['SPEC_REFERENCE_IMAGE_REVISION_CONFLICT', 409],
      ['SPEC_REFERENCE_IMAGE_WRITE_FAILED', 500],
    ];

    await withServer((port) => createApi(port), async (port) => {
      for (const [code, status] of cases) {
        importImpl = async () => {
          const err = new Error(
            `fail ${code} token=sekrit fileKey=FK nodeId=1:9 https://images.figma.com/signed`,
          );
          err.name = code.startsWith('SPEC_REFERENCE')
            ? 'ReferenceImageError'
            : 'FigmaError';
          err.code = code;
          throw err;
        };
        const res = await postJson(port, importPath('design', 'pc'), {
          fileKey: 'AAA',
          nodeId: '1:2',
        });
        assert.equal(res.status, status, code);
        assert.equal(res.json.code, code);
        const text = JSON.stringify(res.json);
        assert.doesNotMatch(text, /sekrit/);
        assert.doesNotMatch(text, /"fileKey"\s*:/);
        assert.doesNotMatch(text, /stack/i);
      }

      importImpl = async () => {
        const err = new Error('rate');
        err.name = 'FigmaError';
        err.code = 'SPEC_FIGMA_RATE_LIMITED';
        err.details = {
          retryAfterSeconds: 15,
          planTier: 'starter',
          rateLimitType: 'low',
          upgradeLink: 'https://www.figma.com/pricing',
        };
        throw err;
      };
      const limited = await postJson(port, importPath('design', 'pc'), {
        fileKey: 'AAA',
        nodeId: '1:2',
      });
      assert.equal(limited.status, 429);
      assert.equal(limited.headers['retry-after'], '15');
      assert.equal(limited.json.retryAfterSeconds, 15);
      assert.equal(limited.json.upgradeLink, 'https://www.figma.com/pricing');
    });
  });

  it('confirmWidthMismatch=false で幅不一致なら confirmation-required', async () => {
    await withServer((port) => createApi(port), async (port) => {
      importImpl = async (opts) => {
        importCalls.push(opts);
        assert.equal(opts.confirmWidthMismatch, false);
        return {
          result: 'confirmation-required',
          confirmation: {
            code: 'SPEC_FIGMA_WIDTH_MISMATCH',
            frame: { frameName: 'Wide', width: 1600, height: 900 },
            viewport: { width: 1440, height: 900 },
          },
        };
      };
      const res = await postJson(port, importPath('design', 'pc'), {
        fileKey: 'AAA',
        nodeId: '1:2',
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.result, 'confirmation-required');
      assert.equal(res.json.confirmation.frame.width, 1600);
      assert.doesNotMatch(JSON.stringify(res.json), /"fileKey"/);
    });
  });

  it('status に importing を返す', async () => {
    await withServer((port) => createApi(port), async (port) => {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      importImpl = async () => {
        await gate;
        return successResult();
      };
      const pending = postJson(port, importPath('design', 'pc'), {
        fileKey: 'AAA',
        nodeId: '1:2',
      });
      await new Promise((r) => setTimeout(r, 20));
      const st = await request(port, {
        path: `${REFERENCE_IMAGE_STATUS_PATH}?screenId=design&viewport=pc`,
      });
      assert.equal(st.status, 200);
      assert.equal(st.json.runtime.status, 'importing');
      release();
      await pending;
    });
  });
});
