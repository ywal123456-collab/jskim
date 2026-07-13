'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { MIME_TYPES } = require('./create-static-server');

const SPEC_BASE = '/spec';

/**
 * /spec/ 配下を spec/{project}/dist から提供する handler を作成します。
 * SPA history fallback と asset/data の 404 を区別します。
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} options.projectName
 * @param {string} [options.specDistDir]
 * @returns {{ handleRequest: Function, specDistDir: string }}
 */
function createSpecMount(options) {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const projectName = options.projectName;
  const specDistDir = path.resolve(
    options.specDistDir ||
      path.join(workspaceRoot, 'spec', projectName, 'dist')
  );

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {{ pathname: string, method: string }} meta
   * @returns {Promise<boolean>}
   */
  async function handleRequest(req, res, meta) {
    const pathname = normalizePathname(meta.pathname);
    if (!isSpecPath(pathname)) {
      return false;
    }

    const method = (meta.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendText(res, 405, 'このHTTPメソッドは使用できません。\n');
      return true;
    }

    if (pathname === SPEC_BASE) {
      res.statusCode = 302;
      res.setHeader('Location', `${SPEC_BASE}/`);
      res.setHeader('Cache-Control', 'no-store');
      res.end();
      return true;
    }

    const distReady = await isSpecDistReady(specDistDir);
    if (!distReady) {
      sendText(
        res,
        404,
        [
          '画面設計書がまだ build されていません。',
          `次のコマンドを実行してください: jskim spec build ${projectName}`,
          '',
        ].join('\n')
      );
      return true;
    }

    const relative = pathname.slice(`${SPEC_BASE}/`.length);
    const wantsSpaFallback = shouldSpaFallback(relative);

    let candidatePath;
    if (relative === '' || relative.endsWith('/')) {
      candidatePath = path.join(specDistDir, relative, 'index.html');
    } else {
      candidatePath = path.join(specDistDir, relative);
    }

    const safePath = await resolveSafePath(specDistDir, candidatePath);
    if (safePath) {
      let stat;
      try {
        stat = await fsp.stat(safePath);
      } catch {
        stat = null;
      }

      if (stat && stat.isDirectory()) {
        const indexPath = path.join(safePath, 'index.html');
        const safeIndex = await resolveSafePath(specDistDir, indexPath);
        if (safeIndex) {
          try {
            const indexStat = await fsp.stat(safeIndex);
            if (indexStat.isFile()) {
              await sendFile(res, safeIndex, indexStat, method);
              return true;
            }
          } catch {
            // fall through
          }
        }
      } else if (stat && stat.isFile()) {
        await sendFile(res, safePath, stat, method);
        return true;
      }
    }

    if (wantsSpaFallback) {
      const indexPath = path.join(specDistDir, 'index.html');
      const safeIndex = await resolveSafePath(specDistDir, indexPath);
      if (safeIndex) {
        try {
          const indexStat = await fsp.stat(safeIndex);
          if (indexStat.isFile()) {
            await sendFile(res, safeIndex, indexStat, method);
            return true;
          }
        } catch {
          // fall through to 404
        }
      }
    }

    sendText(res, 404, 'ファイルが見つかりません。\n');
    return true;
  }

  return { handleRequest, specDistDir };
}

/**
 * /spec または /spec/... のみ。/specification は対象外。
 * @param {string} pathname
 */
function isSpecPath(pathname) {
  return pathname === SPEC_BASE || pathname.startsWith(`${SPEC_BASE}/`);
}

function normalizePathname(pathname) {
  return String(pathname || '/').replace(/\\/g, '/');
}

/**
 * 拡張子付き（assets / data / favicon など）は fallback しない。
 * @param {string} relative /spec/ 以降
 */
function shouldSpaFallback(relative) {
  if (!relative || relative.endsWith('/')) {
    return true;
  }
  const base = path.posix.basename(relative.replace(/\\/g, '/'));
  return !base.includes('.');
}

async function isSpecDistReady(specDistDir) {
  try {
    const indexPath = path.join(specDistDir, 'index.html');
    const stat = await fsp.stat(indexPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function resolveSafePath(rootDir, candidatePath) {
  const root = path.resolve(rootDir);
  const resolvedCandidate = path.resolve(candidatePath);

  if (!isInsideOrSame(root, resolvedCandidate)) {
    return null;
  }

  try {
    const realRoot = await fsp.realpath(root);
    let realCandidate;
    try {
      realCandidate = await fsp.realpath(resolvedCandidate);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        const parent = path.dirname(resolvedCandidate);
        const base = path.basename(resolvedCandidate);
        let realParent;
        try {
          realParent = await fsp.realpath(parent);
        } catch {
          return null;
        }
        realCandidate = path.join(realParent, base);
      } else {
        return null;
      }
    }

    if (!isInsideOrSame(realRoot, realCandidate)) {
      return null;
    }

    return realCandidate;
  } catch {
    return null;
  }
}

async function sendFile(res, filePath, stat, method) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'no-store');

  if (method === 'HEAD') {
    res.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', (err) => {
    const message = err && err.message ? err.message : String(err);
    console.error(
      `[JSKim] ファイルの読み込みに失敗しました。\n原因: ${message}`
    );
    if (!res.headersSent) {
      sendText(res, 500, 'ファイルの読み込み中にエラーが発生しました。\n');
    } else {
      res.destroy();
    }
  });

  try {
    await pipeline(stream, res);
  } catch (err) {
    if (err && err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      return;
    }
  }
}

function sendText(res, statusCode, body) {
  const payload = Buffer.from(body, 'utf8');
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', String(payload.length));
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}

function samePath(a, b) {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  if (process.platform === 'win32') {
    return na.toLowerCase() === nb.toLowerCase();
  }
  return na === nb;
}

function isInsideOrSame(parent, child) {
  if (samePath(parent, child)) {
    return true;
  }
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = {
  createSpecMount,
  isSpecPath,
  shouldSpaFallback,
  SPEC_BASE,
};
