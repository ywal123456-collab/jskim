'use strict';

const { URL } = require('node:url');
const { serializeInlineScriptJson } = require('./serialize-inline-script-json');

const FEATURES_API_PATH = '/_jskim/spec/features';
const MAX_BODY_BYTES = 256 * 1024;

const FORBIDDEN_BODY_KEYS = new Set([
  'token',
  'password',
  'fileKey',
  'nodeId',
  'path',
  'repository',
  'displayOrder',
]);

/**
 * Feature mutation API（jskim spec dev 専用）。
 *
 * @param {object} options
 * @param {string} options.rootDir
 * @param {string} options.projectName
 * @param {string} [options.host]
 * @param {number|string} [options.port]
 * @param {() => string[]} options.listScreenIds
 * @param {object} options.facade companion feature operations facade
 */
function createFeatureApi(options) {
  const rootDir = options.rootDir;
  const projectName = options.projectName;
  const listScreenIds = options.listScreenIds;
  const facade = options.facade;

  const required = [
    'getScreenFeatureWorkingState',
    'createScreenFeature',
    'updateScreenFeature',
    'deleteScreenFeature',
    'reorderScreenFeatures',
    'moveScreenToFeature',
    'reorderFeatureScreens',
    'moveFeatureDirection',
    'moveScreenFeatureDirection',
  ];
  for (const name of required) {
    if (typeof facade[name] !== 'function') {
      throw new Error(`createFeatureApi: facade.${name} が必要です。`);
    }
  }

  function listenHost() {
    return String(options.host || '127.0.0.1').trim();
  }

  function listenPort() {
    return Number(options.port);
  }

  function ctx() {
    return {
      rootDir,
      projectName,
      knownScreenIds: listScreenIds(),
    };
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {{ pathname: string, method: string }} meta
   * @returns {Promise<boolean>}
   */
  async function handleRequest(req, res, meta) {
    const pathname = normalizePathname(meta.pathname);
    if (!pathname.startsWith(FEATURES_API_PATH)) {
      return false;
    }

    const method = (meta.method || req.method || 'GET').toUpperCase();
    const rest =
      pathname === FEATURES_API_PATH
        ? ''
        : pathname.slice(FEATURES_API_PATH.length);

    if (rest === '' || rest === '/') {
      if (method === 'GET' || method === 'HEAD') {
        return handleGet(res, method);
      }
      if (method === 'POST') {
        return handleCreate(req, res);
      }
      return sendMethodNotAllowed(res, 'GET, HEAD, POST');
    }

    if (rest === ':reorder') {
      if (method !== 'POST') return sendMethodNotAllowed(res, 'POST');
      return handleReorderFeatures(req, res);
    }

    if (rest === '/screens:move') {
      if (method !== 'POST') return sendMethodNotAllowed(res, 'POST');
      return handleMoveScreen(req, res);
    }

    const featureMatch = /^\/([^/]+)(\/screens:reorder)?$/.exec(rest);
    if (featureMatch) {
      let featureId;
      try {
        featureId = decodeURIComponent(featureMatch[1]);
      } catch {
        sendJson(res, 400, {
          code: 'SPEC_FEATURE_INVALID_INPUT',
          message: 'featureId の URL が不正です。',
        });
        return true;
      }
      if (!featureId || featureId.includes('..') || featureId.includes('\\')) {
        sendJson(res, 400, {
          code: 'SPEC_FEATURE_INVALID_INPUT',
          message: 'featureId が不正です。',
        });
        return true;
      }

      if (featureMatch[2] === '/screens:reorder') {
        if (method !== 'POST') return sendMethodNotAllowed(res, 'POST');
        return handleReorderFeatureScreens(req, res, featureId);
      }

      if (method === 'PATCH') {
        return handleUpdate(req, res, featureId);
      }
      if (method === 'DELETE') {
        return handleDelete(req, res, featureId);
      }
      return sendMethodNotAllowed(res, 'PATCH, DELETE');
    }

    sendJson(res, 404, {
      code: 'SPEC_FEATURE_ROUTE_NOT_FOUND',
      message: 'Feature API の経路が見つかりません。',
    });
    return true;
  }

  function handleGet(res, method) {
    try {
      const state = facade.getScreenFeatureWorkingState(ctx());
      if (method === 'HEAD') {
        sendHeadJson(res, 200);
        return true;
      }
      sendJson(res, 200, toWorkingResponse(state));
    } catch (err) {
      sendFeatureError(res, err);
    }
    return true;
  }

  async function handleCreate(req, res) {
    const body = await readMutationBody(req, res, listenHost(), listenPort());
    if (body === undefined) return true;

    const allowed = new Set(['featureId', 'name', 'description', 'expectedRevision']);
    if (!assertAllowedKeys(res, body, allowed)) return true;
    if (!assertExpectedRevisionField(res, body)) return true;

    try {
      const result = await facade.createScreenFeature(ctx(), body);
      sendJson(res, 201, toMutationResponse(result, stateFromResult(result)));
    } catch (err) {
      sendFeatureError(res, err);
    }
    return true;
  }

  async function handleUpdate(req, res, featureId) {
    const body = await readMutationBody(req, res, listenHost(), listenPort());
    if (body === undefined) return true;

    const allowed = new Set(['name', 'description', 'expectedRevision']);
    if (!assertAllowedKeys(res, body, allowed)) return true;
    if (!assertExpectedRevisionField(res, body)) return true;

    try {
      const result = await facade.updateScreenFeature(ctx(), featureId, body);
      sendJson(res, 200, toMutationResponse(result, stateFromResult(result)));
    } catch (err) {
      sendFeatureError(res, err);
    }
    return true;
  }

  async function handleDelete(req, res, featureId) {
    const body = await readMutationBody(req, res, listenHost(), listenPort());
    if (body === undefined) return true;

    const allowed = new Set(['expectedRevision']);
    if (!assertAllowedKeys(res, body, allowed)) return true;
    if (!assertExpectedRevisionField(res, body)) return true;

    try {
      const result = await facade.deleteScreenFeature(
        ctx(),
        featureId,
        body.expectedRevision,
      );
      sendJson(res, 200, toMutationResponse(result, stateFromResult(result)));
    } catch (err) {
      sendFeatureError(res, err);
    }
    return true;
  }

  async function handleReorderFeatures(req, res) {
    const body = await readMutationBody(req, res, listenHost(), listenPort());
    if (body === undefined) return true;

    const allowed = new Set([
      'orderedFeatureIds',
      'featureId',
      'direction',
      'expectedRevision',
    ]);
    if (!assertAllowedKeys(res, body, allowed)) return true;
    if (!assertExpectedRevisionField(res, body)) return true;

    try {
      let result;
      if (body.orderedFeatureIds !== undefined) {
        result = await facade.reorderScreenFeatures(ctx(), body);
      } else if (body.featureId !== undefined && body.direction !== undefined) {
        result = await facade.moveFeatureDirection(ctx(), body);
      } else {
        sendJson(res, 400, {
          code: 'SPEC_FEATURE_INVALID_INPUT',
          message:
            'orderedFeatureIds、または featureId + direction を指定してください。',
        });
        return true;
      }
      sendJson(res, 200, toMutationResponse(result, stateFromResult(result)));
    } catch (err) {
      sendFeatureError(res, err);
    }
    return true;
  }

  async function handleMoveScreen(req, res) {
    const body = await readMutationBody(req, res, listenHost(), listenPort());
    if (body === undefined) return true;

    const allowed = new Set([
      'screenId',
      'targetFeatureId',
      'targetIndex',
      'expectedRevision',
    ]);
    if (!assertAllowedKeys(res, body, allowed)) return true;
    if (!assertExpectedRevisionField(res, body)) return true;

    try {
      const result = await facade.moveScreenToFeature(ctx(), body);
      sendJson(res, 200, toMutationResponse(result, stateFromResult(result)));
    } catch (err) {
      sendFeatureError(res, err);
    }
    return true;
  }

  async function handleReorderFeatureScreens(req, res, featureId) {
    const body = await readMutationBody(req, res, listenHost(), listenPort());
    if (body === undefined) return true;

    const allowed = new Set([
      'orderedScreenIds',
      'screenId',
      'direction',
      'expectedRevision',
    ]);
    if (!assertAllowedKeys(res, body, allowed)) return true;
    if (!assertExpectedRevisionField(res, body)) return true;

    try {
      let result;
      if (body.orderedScreenIds !== undefined) {
        result = await facade.reorderFeatureScreens(ctx(), featureId, body);
      } else if (body.screenId !== undefined && body.direction !== undefined) {
        result = await facade.moveScreenFeatureDirection(ctx(), featureId, body);
      } else {
        sendJson(res, 400, {
          code: 'SPEC_FEATURE_INVALID_INPUT',
          message:
            'orderedScreenIds、または screenId + direction を指定してください。',
        });
        return true;
      }
      sendJson(res, 200, toMutationResponse(result, stateFromResult(result)));
    } catch (err) {
      sendFeatureError(res, err);
    }
    return true;
  }

  function toWorkingResponse(state) {
    return {
      revision: state.revision,
      sourceExists: state.sourceExists,
      features: state.features.map(toApiFeature),
      ungroupedScreenIds: [...state.ungroupedScreenIds],
    };
  }

  function stateFromResult(result) {
    return {
      revision: result.revision,
      sourceExists: result.revision !== null || result.features.length > 0,
      features: result.features,
      ungroupedScreenIds: result.ungroupedScreenIds,
    };
  }

  function toMutationResponse(result, state) {
    return {
      status: result.status,
      revision: result.revision,
      features: state.features.map(toApiFeature),
      ungroupedScreenIds: [...state.ungroupedScreenIds],
      ...(result.movedScreenIds
        ? { movedScreenIds: [...result.movedScreenIds] }
        : {}),
    };
  }

  function toApiFeature(feature) {
    return {
      featureId: feature.featureId,
      name: feature.name,
      displayOrder: feature.displayOrder,
      screenIds: [...feature.screenIds],
      ...(feature.description !== undefined
        ? { description: feature.description }
        : {}),
    };
  }

  return {
    handleRequest,
    FEATURES_API_PATH,
  };
}

function injectFeatureEditingBootstrap(html, options = {}) {
  if (typeof html !== 'string') {
    return html;
  }
  if (html.includes('__JSKIM_SPEC_FEATURE__')) {
    return html;
  }
  const apiBase = serializeInlineScriptJson(
    options.apiBase || FEATURES_API_PATH,
  );
  const snippet = [
    '<script>',
    '/* jskim-spec-feature */',
    'window.__JSKIM_SPEC_FEATURE__ = {',
    '  enabled: true,',
    "  mode: 'local-mutation',",
    `  apiBase: ${apiBase},`,
    '};',
    '</script>',
  ].join('\n');

  const bodyClose = html.search(/<\/body>/i);
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + snippet + html.slice(bodyClose);
  }
  return html + snippet;
}

function normalizePathname(pathname) {
  if (!pathname || pathname === '/') return pathname || '/';
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function sendMethodNotAllowed(res, allow) {
  if (allow) {
    res.setHeader('Allow', allow);
  }
  sendJson(res, 405, {
    code: 'SPEC_FEATURE_METHOD_NOT_ALLOWED',
    message: 'このHTTPメソッドは使用できません。',
  });
  return true;
}

function applyJsonSecurityHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendHeadJson(res, statusCode) {
  res.statusCode = statusCode;
  applyJsonSecurityHeaders(res);
  res.end();
}

function assertAllowedKeys(res, body, allowed) {
  const unknown = Object.keys(body).find(
    (key) => !allowed.has(key) || FORBIDDEN_BODY_KEYS.has(key),
  );
  if (unknown) {
    sendJson(res, 400, {
      code: 'SPEC_FEATURE_INVALID_INPUT',
      message: `許可されていないフィールドです: ${unknown}`,
    });
    return false;
  }
  return true;
}

function assertExpectedRevisionField(res, body) {
  if (!Object.prototype.hasOwnProperty.call(body, 'expectedRevision')) {
    sendJson(res, 400, {
      code: 'SPEC_FEATURE_INVALID_INPUT',
      message: 'expectedRevision は必須です。',
    });
    return false;
  }
  return true;
}

async function readMutationBody(req, res, listenHostValue, listenPortValue) {
  if (!isSameOrigin(req, listenHostValue, listenPortValue)) {
    sendJson(res, 403, {
      code: 'SPEC_FEATURE_FORBIDDEN_ORIGIN',
      message: '同一オリジンからのリクエストのみ受け付けます。',
    });
    return undefined;
  }
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const ct = String(req.headers['content-type'] || '');
    if (!ct.toLowerCase().startsWith('application/json')) {
      sendJson(res, 415, {
        code: 'SPEC_FEATURE_INVALID_CONTENT_TYPE',
        message: 'Content-Type は application/json である必要があります。',
      });
      return undefined;
    }
  }
  try {
    return await readJsonBody(req, MAX_BODY_BYTES);
  } catch (err) {
    if (err && err.code === 'SPEC_FEATURE_BODY_TOO_LARGE') {
      sendJson(res, 413, {
        code: 'SPEC_FEATURE_BODY_TOO_LARGE',
        message: 'リクエスト本文が大きすぎます。',
      });
      return undefined;
    }
    sendJson(res, 400, {
      code: 'SPEC_FEATURE_INVALID_INPUT',
      message: 'リクエスト本文が不正な JSON です。',
    });
    return undefined;
  }
}

function listenHostFromReq(req) {
  return String(req.headers.host || '127.0.0.1').split(':')[0];
}

function listenPortFromReq(req) {
  const host = String(req.headers.host || '127.0.0.1:0');
  const idx = host.lastIndexOf(':');
  if (idx === -1) return 0;
  return Number(host.slice(idx + 1));
}

function isSameOrigin(req, listenHost, listenPort) {
  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const expected = expandHostAliases(listenHost);
  return (
    expected.has(parsed.hostname.toLowerCase()) &&
    Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)) ===
      Number(listenPort)
  );
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
      if (settled) return;
      settled = true;
      reject(err);
    }

    function succeed(value) {
      if (settled) return;
      settled = true;
      resolve(value);
    }

    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        const err = new Error('body too large');
        err.code = 'SPEC_FEATURE_BODY_TOO_LARGE';
        fail(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge || settled) return;
      if (!req.readableEnded && size === 0 && req.headers['content-length'] === '0') {
        succeed({});
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        if (text.trim() === '') {
          succeed({});
          return;
        }
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          const err = new Error('invalid body');
          err.code = 'SPEC_FEATURE_INVALID_INPUT';
          fail(err);
          return;
        }
        succeed(parsed);
      } catch (err) {
        fail(err);
      }
    });
    req.on('error', fail);
    req.on('aborted', () => {
      const err = new Error('aborted');
      err.code = 'SPEC_FEATURE_ABORTED';
      fail(err);
    });
  });
}

function sendFeatureError(res, err) {
  const code = err && err.code ? String(err.code) : 'SPEC_FEATURE_INTERNAL';
  const statusCode = mapFeatureStatus(code);
  const payload = {
    code,
    message:
      err && err.message
        ? err.message
        : 'Feature の保存中にエラーが発生しました。',
  };
  if (err && Object.prototype.hasOwnProperty.call(err, 'expectedRevision')) {
    payload.expectedRevision = err.expectedRevision;
  }
  if (err && Object.prototype.hasOwnProperty.call(err, 'currentRevision')) {
    payload.currentRevision = err.currentRevision;
  }
  sendJson(res, statusCode, payload);
}

function mapFeatureStatus(code) {
  switch (code) {
    case 'SPEC_FEATURE_INVALID_INPUT':
    case 'SPEC_FEATURE_INVALID_FORMAT':
    case 'SPEC_FEATURE_UNSUPPORTED_SCHEMA':
    case 'SPEC_FEATURE_DUPLICATE_ID':
    case 'SPEC_FEATURE_ORDER_CONFLICT':
    case 'SPEC_FEATURE_DUPLICATE_MEMBERSHIP':
    case 'SPEC_FEATURE_DUPLICATE_KNOWN_SCREEN':
      return 400;
    case 'SPEC_FEATURE_NOT_FOUND':
    case 'SPEC_FEATURE_UNKNOWN_SCREEN':
    case 'SPEC_FEATURE_FILE_NOT_FOUND':
      return 404;
    case 'SPEC_FEATURE_REVISION_CONFLICT':
      return 409;
    case 'SPEC_FEATURE_IN_PROGRESS':
      return 409;
    case 'SPEC_FEATURE_BODY_TOO_LARGE':
      return 413;
    case 'SPEC_FEATURE_METHOD_NOT_ALLOWED':
      return 405;
    default:
      return 500;
  }
}

function sendJson(res, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.statusCode = statusCode;
  applyJsonSecurityHeaders(res);
  res.setHeader('Content-Length', String(payload.length));
  res.end(payload);
}

module.exports = {
  createFeatureApi,
  injectFeatureEditingBootstrap,
  FEATURES_API_PATH,
};
