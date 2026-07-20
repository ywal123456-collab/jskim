'use strict';

const { serializeInlineScriptJson } = require('./serialize-inline-script-json');

const VERSION_API_PREFIX = '/_jskim/spec/version';
const FEATURES_API_PATH = '/_jskim/spec/features';

const MAX_QUERY_VALUE_LENGTH = 256;
const MAX_REVISION_PATH_LENGTH = 128;

/**
 * Screen Spec ローカル版管理の read-only Revision API（spec dev 専用）。
 *
 * @param {object} options
 * @param {string} options.rootDir
 * @param {string} options.projectName
 * @param {string} [options.host]
 * @param {number|string} [options.port]
 * @param {object} options.facade companion revision-query facade
 */
function createVersionHistoryApi(options) {
  const rootDir = options.rootDir;
  const projectName = options.projectName;
  const facade = options.facade;
  if (!rootDir || typeof rootDir !== 'string') {
    throw new Error('createVersionHistoryApi: rootDir が必要です。');
  }
  if (!projectName || typeof projectName !== 'string') {
    throw new Error('createVersionHistoryApi: projectName が必要です。');
  }
  if (!facade || typeof facade !== 'object') {
    throw new Error('createVersionHistoryApi: facade が必要です。');
  }

  const required = [
    'getBrowserVersionStatus',
    'listBrowserVersionRevisions',
    'getBrowserVersionRevisionDetail',
    'getBrowserVersionRevisionDiff',
    'listBrowserVersionFeatures',
    'listBrowserVersionBranches',
    'listBrowserVersionTags',
  ];
  for (const name of required) {
    if (typeof facade[name] !== 'function') {
      throw new Error(`createVersionHistoryApi: facade.${name} が必要です。`);
    }
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {{ pathname: string, method: string }} meta
   * @returns {Promise<boolean>}
   */
  async function handleRequest(req, res, meta) {
    const pathname = meta.pathname || '';
    const method = (meta.method || req.method || 'GET').toUpperCase();

    if (pathname === FEATURES_API_PATH) {
      if (method !== 'GET') {
        return sendMethodNotAllowed(res);
      }
      return handleFeatures(res);
    }

    if (!pathname.startsWith(VERSION_API_PREFIX)) {
      return false;
    }

    const rest =
      pathname === VERSION_API_PREFIX
        ? ''
        : pathname.slice(VERSION_API_PREFIX.length);

    if (rest === '/status') {
      if (method !== 'GET') return sendMethodNotAllowed(res);
      return handleStatus(res);
    }
    if (rest === '/revisions') {
      if (method !== 'GET') return sendMethodNotAllowed(res);
      return handleRevisions(req, res);
    }
    if (rest === '/diff') {
      if (method !== 'GET') return sendMethodNotAllowed(res);
      return handleDiff(req, res);
    }
    if (rest === '/branches') {
      if (method !== 'GET') return sendMethodNotAllowed(res);
      return handleBranches(res);
    }
    if (rest === '/tags') {
      if (method !== 'GET') return sendMethodNotAllowed(res);
      return handleTags(res);
    }

    const revMatch = /^\/revisions\/([^/]+)$/.exec(rest);
    if (revMatch) {
      if (method !== 'GET') return sendMethodNotAllowed(res);
      let revision;
      try {
        revision = decodeURIComponent(revMatch[1]);
      } catch {
        sendJson(res, 400, {
          code: 'SPEC_VERSION_INVALID_QUERY',
          message: 'revision の URL が不正です。',
        });
        return true;
      }
      if (
        !revision ||
        revision.length > MAX_REVISION_PATH_LENGTH ||
        revision.includes('..') ||
        revision.includes('\\')
      ) {
        sendJson(res, 400, {
          code: 'SPEC_VERSION_INVALID_QUERY',
          message: 'revision が不正です。',
        });
        return true;
      }
      return handleRevisionDetail(res, revision);
    }

    sendJson(res, 404, {
      code: 'SPEC_VERSION_ROUTE_NOT_FOUND',
      message: '版管理 API の経路が見つかりません。',
    });
    return true;
  }

  function handleStatus(res) {
    try {
      const body = facade.getBrowserVersionStatus({ rootDir, projectName });
      sendJson(res, 200, body);
    } catch (err) {
      sendMappedError(res, err);
    }
    return true;
  }

  function handleFeatures(res) {
    try {
      const body = facade.listBrowserVersionFeatures({ rootDir, projectName });
      sendJson(res, 200, body);
    } catch (err) {
      sendMappedError(res, err);
    }
    return true;
  }

  function handleBranches(res) {
    try {
      const branches = facade.listBrowserVersionBranches({
        rootDir,
        projectName,
      });
      sendJson(res, 200, { branches });
    } catch (err) {
      sendMappedError(res, err);
    }
    return true;
  }

  function handleTags(res) {
    try {
      const tags = facade.listBrowserVersionTags({ rootDir, projectName });
      sendJson(res, 200, { tags });
    } catch (err) {
      sendMappedError(res, err);
    }
    return true;
  }

  function handleRevisions(req, res) {
    try {
      const query = parseQuery(req);
      const scope = singleQuery(query, 'scope') || 'project';
      if (scope !== 'project' && scope !== 'feature' && scope !== 'screen') {
        sendJson(res, 400, {
          code: 'SPEC_VERSION_INVALID_QUERY',
          message: 'scope は project / feature / screen のいずれかです。',
        });
        return true;
      }
      const featureId = singleQuery(query, 'featureId');
      const screenId = singleQuery(query, 'screenId');
      const cursor = singleQuery(query, 'cursor');
      const historyHead = singleQuery(query, 'historyHead');
      const limitRaw = singleQuery(query, 'limit');
      let limit;
      if (limitRaw !== undefined) {
        if (!/^\d+$/.test(limitRaw)) {
          sendJson(res, 400, {
            code: 'SPEC_VERSION_INVALID_QUERY',
            message: 'limit は正の整数である必要があります。',
          });
          return true;
        }
        limit = Number(limitRaw);
      }
      if (scope === 'screen' && !screenId) {
        sendJson(res, 400, {
          code: 'SPEC_VERSION_INVALID_QUERY',
          message: 'scope=screen では screenId が必要です。',
        });
        return true;
      }
      if (scope === 'feature' && !featureId) {
        sendJson(res, 400, {
          code: 'SPEC_VERSION_INVALID_QUERY',
          message: 'scope=feature では featureId が必要です。',
        });
        return true;
      }
      const body = facade.listBrowserVersionRevisions({
        rootDir,
        projectName,
        scope,
        featureId,
        screenId,
        limit,
        cursor,
        historyHead,
      });
      sendJson(res, 200, body);
    } catch (err) {
      sendMappedError(res, err);
    }
    return true;
  }

  function handleRevisionDetail(res, revision) {
    try {
      const body = facade.getBrowserVersionRevisionDetail({
        rootDir,
        projectName,
        revision,
      });
      sendJson(res, 200, body);
    } catch (err) {
      sendMappedError(res, err);
    }
    return true;
  }

  function handleDiff(req, res) {
    try {
      const query = parseQuery(req);
      const from = singleQuery(query, 'from');
      const to = singleQuery(query, 'to');
      const body = facade.getBrowserVersionRevisionDiff({
        rootDir,
        projectName,
        from,
        to,
      });
      sendJson(res, 200, body);
    } catch (err) {
      sendMappedError(res, err);
    }
    return true;
  }

  return {
    handleRequest,
    VERSION_API_PREFIX,
    FEATURES_API_PATH,
  };
}

/**
 * /spec/ HTML に改訂履歴 bootstrap を注入する（spec dev 専用）。
 * @param {string} html
 * @param {object} [options]
 * @param {string} [options.apiBase]
 * @param {string} [options.featuresApiBase]
 */
function injectVersionHistoryBootstrap(html, options = {}) {
  if (typeof html !== 'string') {
    return html;
  }
  if (html.includes('__JSKIM_SPEC_VERSION__')) {
    return html;
  }
  const apiBase = serializeInlineScriptJson(
    options.apiBase || VERSION_API_PREFIX
  );
  const featuresApiBase = serializeInlineScriptJson(
    options.featuresApiBase || FEATURES_API_PATH
  );
  const snippet = [
    '<script>',
    '/* jskim-spec-version */',
    'window.__JSKIM_SPEC_VERSION__ = {',
    '  available: true,',
    "  mode: 'local-read-only',",
    `  apiBase: ${apiBase},`,
    `  featuresApiBase: ${featuresApiBase}`,
    '};',
    '</script>',
  ].join('\n');

  const bodyClose = html.search(/<\/body>/i);
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + snippet + html.slice(bodyClose);
  }
  return html + snippet;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {URLSearchParams}
 */
function parseQuery(req) {
  const host = req.headers.host || '127.0.0.1';
  const url = new URL(req.url || '/', `http://${host}`);
  return url.searchParams;
}

/**
 * 重複 query は拒否。空文字・過長も拒否。
 * @param {URLSearchParams} params
 * @param {string} name
 * @returns {string|undefined}
 */
function singleQuery(params, name) {
  const all = params.getAll(name);
  if (all.length === 0) return undefined;
  if (all.length > 1) {
    const err = new Error(`${name} が重複しています。`);
    err.code = 'SPEC_VERSION_INVALID_QUERY';
    throw err;
  }
  const value = all[0];
  if (value === '') {
    const err = new Error(`${name} が空です。`);
    err.code = 'SPEC_VERSION_INVALID_QUERY';
    throw err;
  }
  if (value.length > MAX_QUERY_VALUE_LENGTH) {
    const err = new Error(`${name} が長すぎます。`);
    err.code = 'SPEC_VERSION_INVALID_QUERY';
    throw err;
  }
  return value;
}

/**
 * @param {import('node:http').ServerResponse} res
 */
function sendMethodNotAllowed(res) {
  res.statusCode = 405;
  res.setHeader('Allow', 'GET');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const payload = Buffer.from(
    JSON.stringify({
      code: 'SPEC_VERSION_METHOD_NOT_ALLOWED',
      message: 'この API は GET のみ受け付けます。',
    }),
    'utf8'
  );
  res.setHeader('Content-Length', String(payload.length));
  res.end(payload);
  return true;
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} err
 */
function sendMappedError(res, err) {
  const code =
    err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
      ? err.code
      : 'SPEC_VERSION_INTERNAL';
  const message =
    err && typeof err === 'object' && err instanceof Error && err.message
      ? sanitizeMessage(err.message)
      : '版管理 API で内部エラーが発生しました。';

  const status = mapStatus(code);
  sendJson(res, status, {
    code: normalizePublicCode(code),
    message,
  });
}

/**
 * @param {string} code
 * @returns {number}
 */
function mapStatus(code) {
  switch (code) {
    case 'SPEC_VERSION_INVALID_QUERY':
    case 'SPEC_VERSION_INVALID_OBJECT':
    case 'SPEC_VERSION_INVALID_HASH':
    case 'SPEC_VERSION_AUTHOR_INVALID':
      return 400;
    case 'SPEC_VERSION_REVISION_NOT_FOUND':
    case 'SPEC_VERSION_REF_NOT_FOUND':
    case 'SPEC_VERSION_BRANCH_NOT_FOUND':
    case 'SPEC_VERSION_TAG_NOT_FOUND':
    case 'SPEC_VERSION_OBJECT_NOT_FOUND':
    case 'SPEC_VERSION_SCREEN_NOT_FOUND':
    case 'SPEC_VERSION_FEATURE_NOT_FOUND':
      return 404;
    case 'SPEC_VERSION_NOT_INITIALIZED':
    case 'SPEC_VERSION_HEAD_CHANGED':
    case 'SPEC_VERSION_RECOVERY_REQUIRED':
    case 'SPEC_VERSION_REPOSITORY_IN_PROGRESS':
      return 409;
    case 'SPEC_VERSION_OBJECT_CORRUPT':
    case 'SPEC_VERSION_OBJECT_HASH_MISMATCH':
    case 'SPEC_VERSION_REPOSITORY_CORRUPT':
    case 'SPEC_VERSION_HEAD_CORRUPT':
    case 'SPEC_VERSION_INDEX_CORRUPT':
    case 'SPEC_VERSION_REF_CORRUPT':
      return 500;
    default:
      if (code.startsWith('SPEC_VERSION_')) return 500;
      return 500;
  }
}

/**
 * @param {string} code
 */
function normalizePublicCode(code) {
  if (code === 'SPEC_VERSION_INVALID_OBJECT') {
    return 'SPEC_VERSION_INVALID_QUERY';
  }
  if (code.startsWith('SPEC_VERSION_') || code.startsWith('SPEC_FEATURE_')) {
    return code;
  }
  return 'SPEC_VERSION_INTERNAL';
}

/**
 * @param {string} message
 */
function sanitizeMessage(message) {
  // 絶対 path / Windows drive / UNC らしき断片を落とす
  return message
    .replace(/[A-Za-z]:\\[^\s]+/g, '[path]')
    .replace(/\\\\[^\s]+/g, '[path]')
    .replace(/\/(?:Users|home|tmp|var|private)\/[^\s]+/g, '[path]')
    .slice(0, 500);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {object} body
 */
function sendJson(res, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(payload.length));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(payload);
}

module.exports = {
  createVersionHistoryApi,
  injectVersionHistoryBootstrap,
  VERSION_API_PREFIX,
  FEATURES_API_PATH,
};
