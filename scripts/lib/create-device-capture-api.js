'use strict';

const { URL } = require('node:url');
const crypto = require('node:crypto');

const DEVICE_CAPTURE_COLLECT_PATH = '/_jskim/spec/device-captures:collect';
const DEVICE_CAPTURE_STATUS_PATH = '/_jskim/spec/device-captures/status';
const MAX_BODY_BYTES = 256 * 1024;

const ALLOWED_VIEWPORTS = new Set(['pc', 'sp']);
const SCREEN_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 128;

/**
 * Device Capture HTTP API（jskim spec dev 専用）。
 *
 * POST /_jskim/spec/device-captures:collect
 * GET  /_jskim/spec/device-captures/status?screenId=&stateId=&viewport=
 *
 * project 直列化は companion の collectDeviceCapture（既存 queue）に委譲する。
 * この API に別 queue は持たない。同一 key の重複は 409 で拒否する。
 *
 * @param {object} options
 * @param {string} options.rootDir
 * @param {string} options.projectName
 * @param {string} options.host
 * @param {number} options.port
 * @param {string} options.baseUrl http://127.0.0.1:<port>
 * @param {Function} options.collectDeviceCapture
 * @param {Function} options.getDeviceCapturePublicInfo
 * @param {Function} options.loadScreenSpecProject
 * @param {() => object|undefined} [options.getCollectHooks] テスト用 hooks
 */
function createDeviceCaptureApi(options) {
  const rootDir = options.rootDir;
  const projectName = options.projectName;
  const collectDeviceCapture = options.collectDeviceCapture;
  const getDeviceCapturePublicInfo = options.getDeviceCapturePublicInfo;
  const loadScreenSpecProject = options.loadScreenSpecProject;
  const getCollectHooks =
    typeof options.getCollectHooks === 'function'
      ? options.getCollectHooks
      : () => undefined;

  /** @type {Map<string, object>} */
  const runtimeByKey = new Map();
  /** @type {Set<string>} */
  const inProgressKeys = new Set();

  function listenHost() {
    return String(options.host || '127.0.0.1').trim();
  }

  function listenPort() {
    return Number(options.port);
  }

  function captureKey(screenId, stateId, viewport) {
    return `${screenId}\0${stateId}\0${viewport}`;
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {{ pathname: string, method: string }} meta
   * @returns {Promise<boolean>}
   */
  async function handleRequest(req, res, meta) {
    const pathname = normalizePathname(meta.pathname);
    const method = (meta.method || 'GET').toUpperCase();

    if (pathname === DEVICE_CAPTURE_COLLECT_PATH) {
      if (method !== 'POST') {
        sendJson(res, 405, {
          code: 'SPEC_DEVICE_CAPTURE_METHOD_NOT_ALLOWED',
          message: 'このHTTPメソッドは使用できません。',
        });
        return true;
      }
      return handleCollect(req, res);
    }

    if (pathname === DEVICE_CAPTURE_STATUS_PATH) {
      if (method !== 'GET' && method !== 'HEAD') {
        sendJson(res, 405, {
          code: 'SPEC_DEVICE_CAPTURE_METHOD_NOT_ALLOWED',
          message: 'このHTTPメソッドは使用できません。',
        });
        return true;
      }
      return handleStatus(req, res, method);
    }

    return false;
  }

  async function handleCollect(req, res) {
    const body = await readSameOriginJsonBody(req, res);
    if (body === undefined) {
      return true;
    }

    const parsed = parseCollectBody(body);
    if (!parsed.ok) {
      sendJson(res, 400, {
        code: parsed.code,
        message: parsed.message,
      });
      return true;
    }

    const { screenId, stateId, viewport } = parsed;
    const resolved = resolveCaptureTarget(screenId, stateId);
    if (!resolved.ok) {
      sendJson(res, resolved.statusCode, {
        code: resolved.code,
        message: resolved.message,
      });
      return true;
    }

    const key = captureKey(screenId, stateId, viewport);
    if (inProgressKeys.has(key)) {
      sendJson(res, 409, {
        code: 'SPEC_DEVICE_CAPTURE_IN_PROGRESS',
        message:
          '同じDevice Previewを収集中です。完了後に再度実行してください。',
      });
      return true;
    }

    const requestId = crypto.randomBytes(8).toString('hex');
    const startedAt = new Date().toISOString();
    inProgressKeys.add(key);
    runtimeByKey.set(key, {
      status: 'collecting',
      requestId,
      startedAt,
    });

    try {
      const hooks = getCollectHooks({ screenId, stateId, viewport }) || {};
      const result = await collectDeviceCapture({
        rootDir,
        projectName,
        baseUrl: options.baseUrl,
        screenId,
        stateId,
        viewport,
        hooks,
      });

      runtimeByKey.set(key, { status: 'idle' });

      const capture = getDeviceCapturePublicInfo({
        rootDir,
        projectName,
        screenId,
        stateId,
        viewport,
      });

      sendJson(res, 200, {
        screenId,
        stateId,
        viewport,
        result: result.status,
        capture: toCaptureResponse(capture),
      });
    } catch (err) {
      const mapped = mapCollectError(err);
      runtimeByKey.set(key, {
        status: 'failed',
        failedAt: new Date().toISOString(),
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      });
      sendJson(res, mapped.statusCode, {
        code: mapped.code,
        message: mapped.message,
      });
    } finally {
      inProgressKeys.delete(key);
    }

    return true;
  }

  async function handleStatus(req, res, method) {
    if (!isSameOrigin(req, listenHost(), listenPort())) {
      sendJson(res, 403, {
        code: 'SPEC_DEVICE_CAPTURE_FORBIDDEN_ORIGIN',
        message: '同一 origin 以外からのリクエストは許可されていません。',
      });
      return true;
    }

    let url;
    try {
      url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    } catch {
      sendJson(res, 400, {
        code: 'SPEC_DEVICE_CAPTURE_INVALID_QUERY',
        message: 'クエリが不正です。',
      });
      return true;
    }

    const screenId = url.searchParams.get('screenId');
    const stateId = url.searchParams.get('stateId');
    const viewport = url.searchParams.get('viewport');

    const parsed = parseIds(screenId, stateId, viewport);
    if (!parsed.ok) {
      sendJson(res, 400, {
        code: parsed.code,
        message: parsed.message,
      });
      return true;
    }

    const resolved = resolveCaptureTarget(
      parsed.screenId,
      parsed.stateId,
    );
    if (!resolved.ok) {
      sendJson(res, resolved.statusCode, {
        code: resolved.code,
        message: resolved.message,
      });
      return true;
    }

    const key = captureKey(
      parsed.screenId,
      parsed.stateId,
      parsed.viewport,
    );
    const runtime = runtimeByKey.get(key) || { status: 'idle' };
    const capture = getDeviceCapturePublicInfo({
      rootDir,
      projectName,
      screenId: parsed.screenId,
      stateId: parsed.stateId,
      viewport: parsed.viewport,
    });

    if (method === 'HEAD') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end();
      return true;
    }

    sendJson(res, 200, {
      screenId: parsed.screenId,
      stateId: parsed.stateId,
      viewport: parsed.viewport,
      runtime: toRuntimeResponse(runtime),
      capture: toCaptureResponse(capture),
    });
    return true;
  }

  function resolveCaptureTarget(screenId, stateId) {
    let project;
    try {
      project = loadScreenSpecProject({
        rootDir,
        projectName,
      });
    } catch (err) {
      return {
        ok: false,
        statusCode: 500,
        code: 'SPEC_DEVICE_CAPTURE_INTERNAL',
        message:
          err && err.message
            ? err.message
            : '画面情報の読み込みに失敗しました。',
      };
    }

    const screen = (project.screens || []).find((s) => s.screenId === screenId);
    if (!screen) {
      return {
        ok: false,
        statusCode: 404,
        code: 'SPEC_DEVICE_CAPTURE_SCREEN_NOT_FOUND',
        message: `画面が見つかりません: screenId=${screenId}`,
      };
    }

    if (
      screen.status === 'design-only' ||
      !screen.hasImplementation ||
      !screen.source
    ) {
      return {
        ok: false,
        statusCode: 404,
        code: 'SPEC_DEVICE_CAPTURE_IMPLEMENTATION_NOT_FOUND',
        message:
          `実装画面が見つかりません。Device Preview を収集できません。` +
          ` screenId=${screenId}`,
      };
    }

    const state = (screen.source.states || []).find((s) => s.id === stateId);
    if (!state) {
      return {
        ok: false,
        statusCode: 404,
        code: 'SPEC_DEVICE_CAPTURE_STATE_NOT_FOUND',
        message: `state が見つかりません: screenId=${screenId} stateId=${stateId}`,
      };
    }

    return { ok: true, screen, state };
  }

  /** テスト用 */
  function getRuntimeForTest(screenId, stateId, viewport) {
    return runtimeByKey.get(captureKey(screenId, stateId, viewport));
  }

  /** テスト用 */
  function resetRuntimeForTest() {
    runtimeByKey.clear();
    inProgressKeys.clear();
  }

  return {
    collectPath: DEVICE_CAPTURE_COLLECT_PATH,
    statusPath: DEVICE_CAPTURE_STATUS_PATH,
    handleRequest,
    maxBodyBytes: MAX_BODY_BYTES,
    getRuntimeForTest,
    resetRuntimeForTest,
  };

  async function readSameOriginJsonBody(req, res) {
    if (!isSameOrigin(req, listenHost(), listenPort())) {
      sendJson(res, 403, {
        code: 'SPEC_DEVICE_CAPTURE_FORBIDDEN_ORIGIN',
        message: '同一 origin 以外からのリクエストは許可されていません。',
      });
      return undefined;
    }

    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.toLowerCase().includes('application/json')) {
      sendJson(res, 415, {
        code: 'SPEC_DEVICE_CAPTURE_UNSUPPORTED_MEDIA',
        message: 'Content-Type は application/json である必要があります。',
      });
      return undefined;
    }

    try {
      return await readJsonBody(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err && err.code === 'SPEC_DEVICE_CAPTURE_BODY_TOO_LARGE') {
        sendJson(res, 413, {
          code: err.code,
          message: 'リクエスト本文が大きすぎます。',
        });
        return undefined;
      }
      sendJson(res, 400, {
        code: 'SPEC_DEVICE_CAPTURE_MALFORMED_JSON',
        message: 'リクエスト本文の JSON が不正です。',
      });
      return undefined;
    }
  }
}

function parseCollectBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      code: 'SPEC_DEVICE_CAPTURE_INVALID_BODY',
      message: 'リクエスト本文が不正です。',
    };
  }

  const allowed = new Set(['screenId', 'stateId', 'viewport']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      return {
        ok: false,
        code: 'SPEC_DEVICE_CAPTURE_UNKNOWN_FIELD',
        message: `未知のフィールドがあります: ${key}`,
      };
    }
  }

  return parseIds(body.screenId, body.stateId, body.viewport);
}

function parseIds(screenId, stateId, viewport) {
  if (typeof screenId !== 'string' || screenId.length === 0) {
    return {
      ok: false,
      code: 'SPEC_DEVICE_CAPTURE_INVALID_SCREEN_ID',
      message: 'screenId が不正です。',
    };
  }
  if (
    screenId.length > MAX_ID_LENGTH ||
    !SCREEN_ID_RE.test(screenId) ||
    screenId.includes('..') ||
    screenId.includes('/') ||
    screenId.includes('\\')
  ) {
    return {
      ok: false,
      code: 'SPEC_DEVICE_CAPTURE_INVALID_SCREEN_ID',
      message: 'screenId が不正です。',
    };
  }

  if (typeof stateId !== 'string' || stateId.length === 0) {
    return {
      ok: false,
      code: 'SPEC_DEVICE_CAPTURE_INVALID_STATE_ID',
      message: 'stateId が不正です。',
    };
  }
  if (
    stateId.length > MAX_ID_LENGTH ||
    !SCREEN_ID_RE.test(stateId) ||
    stateId.includes('..') ||
    stateId.includes('/') ||
    stateId.includes('\\') ||
    /^[a-z]+:\/\//i.test(stateId)
  ) {
    return {
      ok: false,
      code: 'SPEC_DEVICE_CAPTURE_INVALID_STATE_ID',
      message: 'stateId が不正です。',
    };
  }

  if (typeof viewport !== 'string' || !ALLOWED_VIEWPORTS.has(viewport)) {
    return {
      ok: false,
      code: 'SPEC_DEVICE_CAPTURE_INVALID_VIEWPORT',
      message: 'viewport は pc または sp である必要があります。',
    };
  }

  return { ok: true, screenId, stateId, viewport };
}

function toCaptureResponse(info) {
  if (!info || info.status === 'missing') {
    return { status: 'missing' };
  }
  if (info.status === 'invalid') {
    return {
      status: 'invalid',
      diagnosticCode: 'SPEC_DEVICE_CAPTURE_INVALID',
    };
  }
  return {
    status: info.status,
    inputRevision: info.inputRevision,
    imageRevision: info.imageRevision,
    capturedAt: info.capturedAt,
    imageWidth: info.imageWidth,
    imageHeight: info.imageHeight,
  };
}

function toRuntimeResponse(runtime) {
  if (!runtime || runtime.status === 'idle') {
    return { status: 'idle' };
  }
  if (runtime.status === 'collecting') {
    return {
      status: 'collecting',
      requestId: runtime.requestId,
      startedAt: runtime.startedAt,
    };
  }
  if (runtime.status === 'failed') {
    return {
      status: 'failed',
      failedAt: runtime.failedAt,
      error: runtime.error,
    };
  }
  return { status: 'idle' };
}

function mapCollectError(err) {
  const code =
    (err && err.code) ||
    (err && err.name === 'DeviceCaptureError' && err.code) ||
    'SPEC_DEVICE_CAPTURE_FAILED';
  const message =
    err && err.message
      ? sanitizeErrorMessage(err.message)
      : 'Device Previewの収集に失敗しました。';

  if (code === 'SPEC_DEVICE_CAPTURE_IN_PROGRESS') {
    return { statusCode: 409, code, message };
  }
  if (code === 'SPEC_DEVICE_CAPTURE_INPUT_CHANGED') {
    return { statusCode: 409, code, message };
  }
  if (
    code === 'SPEC_DEVICE_CAPTURE_SCREEN_NOT_FOUND' ||
    code === 'SPEC_DEVICE_CAPTURE_STATE_NOT_FOUND' ||
    code === 'SPEC_DEVICE_CAPTURE_SNAPSHOT_MISSING' ||
    code === 'SPEC_DEVICE_CAPTURE_IMPLEMENTATION_NOT_FOUND'
  ) {
    return { statusCode: 404, code, message };
  }
  if (
    code === 'SPEC_COLLECT_ACTION_TARGET_NOT_FOUND' ||
    code === 'SPEC_COLLECT_ACTION_TARGET_DUPLICATE' ||
    code === 'SPEC_COLLECT_ACTION_FAILED' ||
    code === 'SPEC_COLLECT_NAVIGATION_FAILED' ||
    code === 'SPEC_COLLECT_EXTERNAL_REDIRECT' ||
    code === 'SPEC_COLLECT_BROWSER_NOT_FOUND' ||
    code === 'SPEC_DEVICE_CAPTURE_STABILIZE_TIMEOUT' ||
    code === 'SPEC_DEVICE_CAPTURE_INVALID_PNG' ||
    code === 'SPEC_DEVICE_CAPTURE_DIMENSION_LIMIT' ||
    code === 'SPEC_DEVICE_CAPTURE_WRITE_FAILED'
  ) {
    return {
      statusCode: 500,
      code: code.startsWith('SPEC_DEVICE_CAPTURE_')
        ? code
        : 'SPEC_DEVICE_CAPTURE_FAILED',
      message,
    };
  }

  return {
    statusCode: 500,
    code: 'SPEC_DEVICE_CAPTURE_FAILED',
    message,
  };
}

function sanitizeErrorMessage(message) {
  // 絶対 path っぽい断片を落とす（Windows / POSIX）
  return String(message)
    .replace(/[A-Za-z]:\\[^\s]+/g, '[path]')
    .replace(/\/(?:Users|home|tmp|var)\/[^\s]+/g, '[path]');
}

function normalizePathname(pathname) {
  return String(pathname || '/').replace(/\\/g, '/');
}

function isSameOrigin(req, listenHost, listenPort) {
  const origin = req.headers.origin;
  if (!origin) {
    const hostHeader = String(req.headers.host || '');
    return hostMatches(hostHeader, listenHost, listenPort);
  }

  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const hostHeader = String(req.headers.host || '');
  if (!hostMatches(hostHeader, listenHost, listenPort)) {
    return false;
  }

  const originHost = originUrl.hostname;
  const originPort =
    originUrl.port ||
    (originUrl.protocol === 'https:' ? '443' : '80');

  const expectedHosts = expandHostAliases(listenHost);
  if (!expectedHosts.has(originHost.toLowerCase())) {
    return false;
  }

  if (Number(originPort) !== Number(listenPort)) {
    const hostPort = hostHeader.includes(':')
      ? hostHeader.split(':').pop()
      : String(listenPort);
    if (Number(hostPort) !== Number(originPort)) {
      return false;
    }
  }

  return true;
}

function hostMatches(hostHeader, listenHost, listenPort) {
  const raw = String(hostHeader || '').trim().toLowerCase();
  if (!raw) {
    return false;
  }
  const expected = expandHostAliases(listenHost);
  let hostname = raw;
  let port = String(listenPort);
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    hostname = raw.slice(1, end);
    const rest = raw.slice(end + 1);
    if (rest.startsWith(':')) {
      port = rest.slice(1);
    }
  } else if (raw.includes(':')) {
    const parts = raw.split(':');
    hostname = parts[0];
    port = parts[1];
  }
  if (!expected.has(hostname)) {
    return false;
  }
  return Number(port) === Number(listenPort);
}

function expandHostAliases(listenHost) {
  const host = String(listenHost || '').toLowerCase();
  const set = new Set([host]);
  if (host === '0.0.0.0' || host === '::' || host === '::0') {
    set.add('127.0.0.1');
    set.add('localhost');
  }
  if (host === '127.0.0.1') {
    set.add('localhost');
  }
  if (host === 'localhost') {
    set.add('127.0.0.1');
  }
  return set;
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    let settled = false;

    function fail(err) {
      if (settled) {
        return;
      }
      settled = true;
      reject(err);
    }

    function succeed(value) {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    }

    req.on('data', (chunk) => {
      if (tooLarge) {
        return;
      }
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        const err = new Error('body too large');
        err.code = 'SPEC_DEVICE_CAPTURE_BODY_TOO_LARGE';
        fail(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge || settled) {
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        succeed(JSON.parse(text));
      } catch (err) {
        fail(err);
      }
    });
    req.on('error', fail);
  });
}

function sendJson(res, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(payload.length));
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}

module.exports = {
  createDeviceCaptureApi,
  DEVICE_CAPTURE_COLLECT_PATH,
  DEVICE_CAPTURE_STATUS_PATH,
  MAX_BODY_BYTES,
};
