'use strict';

const { URL } = require('node:url');

const DESCRIPTION_API_PREFIX = '/_jskim/spec/descriptions';
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Description 編集 API（jskim spec dev 専用）。
 *
 * GET/PUT /_jskim/spec/descriptions/:screenId
 *
 * @param {object} options
 * @param {object} options.store FileDescriptionStore
 * @param {string} options.host listen host（same-origin 比較用）
 * @param {number} options.port
 */
function createDescriptionEditApi(options) {
  const store = options.store;

  function listenHost() {
    return String(options.host || '127.0.0.1').trim();
  }

  function listenPort() {
    return Number(options.port);
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {{ pathname: string, method: string }} meta
   * @returns {Promise<boolean>}
   */
  async function handleRequest(req, res, meta) {
    const pathname = normalizePathname(meta.pathname);
    if (!pathname.startsWith(`${DESCRIPTION_API_PREFIX}/`) && pathname !== DESCRIPTION_API_PREFIX) {
      return false;
    }

    const method = (meta.method || 'GET').toUpperCase();
    if (
      method !== 'GET' &&
      method !== 'PUT' &&
      method !== 'HEAD' &&
      method !== 'POST'
    ) {
      sendJson(res, 405, {
        code: 'SPEC_DESCRIPTION_METHOD_NOT_ALLOWED',
        message: 'このHTTPメソッドは使用できません。',
      });
      return true;
    }

    if (pathname === DESCRIPTION_API_PREFIX) {
      if (method !== 'POST') {
        sendJson(res, 405, {
          code: 'SPEC_DESCRIPTION_METHOD_NOT_ALLOWED',
          message: 'このHTTPメソッドは使用できません。',
        });
        return true;
      }
      return handleCreate(req, res);
    }

    const screenId = decodeScreenId(pathname);
    if (!screenId) {
      sendJson(res, 400, {
        code: 'SPEC_DESCRIPTION_INVALID_SCREEN_ID',
        message: '画面 ID が不正です。',
      });
      return true;
    }

    if (method === 'POST') {
      sendJson(res, 405, {
        code: 'SPEC_DESCRIPTION_METHOD_NOT_ALLOWED',
        message: 'このHTTPメソッドは使用できません。',
      });
      return true;
    }

    if (method === 'GET' || method === 'HEAD') {
      try {
        const result = store.read(screenId);
        if (method === 'HEAD') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end();
          return true;
        }
        sendJson(res, 200, {
          screenId: result.screenId,
          revision: result.revision,
          exists: result.exists,
          document: result.document,
        });
      } catch (err) {
        sendStoreError(res, err);
      }
      return true;
    }

    // PUT
    const body = await readSameOriginJsonBody(req, res);
    if (body === undefined) {
      // 既にエラー応答済み
      return true;
    }

    const expectedRevision = body && body.expectedRevision;
    const document = body && body.document;

    try {
      const result = store.write(screenId, document, expectedRevision);
      sendJson(res, 200, {
        screenId: result.screenId,
        revision: result.revision,
        saved: result.saved,
        written: result.written,
      });
    } catch (err) {
      sendStoreError(res, err);
    }
    return true;
  }

  /**
   * POST /_jskim/spec/descriptions（screenId 無しの新規作成）
   *
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @returns {Promise<boolean>}
   */
  async function handleCreate(req, res) {
    const body = await readSameOriginJsonBody(req, res);
    if (body === undefined) {
      return true;
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(res, 400, {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'リクエスト本文は object である必要があります。',
      });
      return true;
    }

    const allowedKeys = new Set(['screenId', 'name', 'description']);
    const unknownKey = Object.keys(body).find((key) => !allowedKeys.has(key));
    if (unknownKey) {
      sendJson(res, 400, {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `許可されていないフィールドです: ${unknownKey}`,
      });
      return true;
    }

    try {
      const result = store.create({
        screenId: body.screenId,
        name: body.name,
        description: body.description,
      });
      res.setHeader(
        'Location',
        `${DESCRIPTION_API_PREFIX}/${encodeURIComponent(result.screenId)}`
      );
      sendJson(res, 201, {
        screenId: result.screenId,
        revision: result.revision,
        document: result.document,
      });
    } catch (err) {
      sendStoreError(res, err);
    }
    return true;
  }

  /**
   * same-origin / JSON content-type / body size を検証して JSON body を返す。
   * 検証に失敗した場合はここで応答済みにして undefined を返す。
   *
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @returns {Promise<any>}
   */
  async function readSameOriginJsonBody(req, res) {
    if (!isSameOrigin(req, listenHost(), listenPort())) {
      sendJson(res, 403, {
        code: 'SPEC_DESCRIPTION_FORBIDDEN_ORIGIN',
        message: '同一 origin 以外からのリクエストは許可されていません。',
      });
      return undefined;
    }

    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.toLowerCase().includes('application/json')) {
      sendJson(res, 415, {
        code: 'SPEC_DESCRIPTION_UNSUPPORTED_MEDIA',
        message: 'Content-Type は application/json である必要があります。',
      });
      return undefined;
    }

    try {
      return await readJsonBody(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err && err.code === 'SPEC_DESCRIPTION_BODY_TOO_LARGE') {
        sendJson(res, 413, {
          code: err.code,
          message: 'リクエスト本文が大きすぎます。',
        });
        return undefined;
      }
      sendJson(res, 400, {
        code: 'SPEC_DESCRIPTION_MALFORMED_JSON',
        message: 'リクエスト本文の JSON が不正です。',
      });
      return undefined;
    }
  }

  return {
    pathPrefix: DESCRIPTION_API_PREFIX,
    handleRequest,
    maxBodyBytes: MAX_BODY_BYTES,
  };
}

function normalizePathname(pathname) {
  return String(pathname || '/').replace(/\\/g, '/');
}

function decodeScreenId(pathname) {
  const prefix = `${DESCRIPTION_API_PREFIX}/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const rest = pathname.slice(prefix.length);
  if (!rest || rest.includes('/') || rest.includes('..')) {
    return null;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (
    decoded.includes('..') ||
    decoded.includes('/') ||
    decoded.includes('\\') ||
    decoded.includes('\0')
  ) {
    return null;
  }
  return decoded;
}

function isSameOrigin(req, listenHost, listenPort) {
  const origin = req.headers.origin;
  if (!origin) {
    // 同一 origin の fetch（一部環境）では Origin が無いことがある。
    // Host ヘッダで待受と一致するか確認する。
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
    // Host ヘッダに port が含まれる場合はそちらを優先比較済み
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
        err.code = 'SPEC_DESCRIPTION_BODY_TOO_LARGE';
        // destroy せず end まで待ち、クライアントへ 413 を返せるようにする
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

function sendStoreError(res, err) {
  const statusCode = (err && err.statusCode) || 500;
  const payload = {
    code: (err && err.code) || 'SPEC_DESCRIPTION_INTERNAL',
    message:
      err && err.message
        ? err.message
        : '画面設計書の保存中にエラーが発生しました。',
  };
  if (err && err.expectedRevision) {
    payload.expectedRevision = err.expectedRevision;
  }
  if (err && err.currentRevision) {
    payload.currentRevision = err.currentRevision;
  }
  sendJson(res, statusCode, payload);
}

function sendJson(res, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(payload.length));
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}

/**
 * /spec/ HTML に編集用 bootstrap を注入する。
 */
function injectDescriptionEditingBootstrap(html, options = {}) {
  if (typeof html !== 'string') {
    return html;
  }
  if (html.includes('__JSKIM_SPEC_EDIT__')) {
    return html;
  }
  const apiBase = JSON.stringify(
    options.apiBase || DESCRIPTION_API_PREFIX
  );
  const snippet = [
    '<script>',
    '/* jskim-spec-edit */',
    'window.__JSKIM_SPEC_EDIT__ = {',
    '  enabled: true,',
    `  apiBase: ${apiBase}`,
    '};',
    '</script>',
  ].join('\n');

  const bodyClose = html.search(/<\/body>/i);
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + snippet + html.slice(bodyClose);
  }
  return html + snippet;
}

module.exports = {
  createDescriptionEditApi,
  injectDescriptionEditingBootstrap,
  DESCRIPTION_API_PREFIX,
  MAX_BODY_BYTES,
};
