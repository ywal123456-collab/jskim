'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

/**
 * outputDir をルートとするローカル静的 HTTP サーバーを作成します。
 * serve / dev の両方から再利用します。
 *
 * @param {object} options
 * @param {string} options.rootDir 提供ルート（通常は outputDir）
 * @param {string} options.host
 * @param {number} options.port
 * @param {string} [options.projectName]
 * @param {(html: string, meta: object) => string|Promise<string>} [options.transformHtml]
 * @param {(req, res, meta: object) => boolean|Promise<boolean>} [options.handleInternalRequest]
 * @returns {{ server: import('node:http').Server, start: Function, stop: Function, url: string }}
 */
function createStaticServer({
  rootDir,
  host,
  port,
  projectName,
  transformHtml,
  handleInternalRequest,
}) {
  const rootResolved = path.resolve(rootDir);
  const displayName = projectName || '';

  const server = http.createServer((req, res) => {
    handleRequest(req, res, {
      rootDir: rootResolved,
      projectName: displayName,
      transformHtml,
      handleInternalRequest,
    }).catch((err) => {
      const message = err && err.message ? err.message : String(err);
      console.error(
        `[JSKim] リクエスト処理中にエラーが発生しました。\n` +
          (displayName ? `プロジェクト: ${displayName}\n` : '') +
          `原因: ${message}`
      );
      if (!res.headersSent) {
        sendText(res, 500, 'ファイルの読み込み中にエラーが発生しました。\n');
      } else {
        res.destroy();
      }
    });
  });

  const url = `http://${host}:${port}/`;

  function start() {
    return new Promise((resolve, reject) => {
      const onError = (err) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve({
          host,
          port,
          url,
          rootDir: rootResolved,
        });
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  }

  function stop() {
    return new Promise((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  return { server, start, stop, url, rootDir: rootResolved };
}

async function handleRequest(req, res, context) {
  const method = (req.method || 'GET').toUpperCase();

  let pathname;
  try {
    const base = 'http://127.0.0.1';
    const parsed = new URL(req.url || '/', base);
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    sendText(res, 400, 'リクエストURLが不正です。\n');
    return;
  }

  const normalizedPath = pathname.replace(/\\/g, '/');

  if (typeof context.handleInternalRequest === 'function') {
    const handled = await context.handleInternalRequest(req, res, {
      pathname: normalizedPath,
      method,
    });
    if (handled) {
      return;
    }
  }

  if (method !== 'GET' && method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    sendText(res, 405, 'このHTTPメソッドは使用できません。\n');
    return;
  }

  const relativeUrlPath = normalizedPath.replace(/^\/+/, '');

  let candidatePath;
  if (relativeUrlPath === '' || normalizedPath.endsWith('/')) {
    candidatePath = path.join(
      context.rootDir,
      relativeUrlPath,
      'index.html'
    );
  } else {
    candidatePath = path.join(context.rootDir, relativeUrlPath);
  }

  const safePath = await resolveSafePath(context.rootDir, candidatePath);
  if (!safePath) {
    sendText(res, 404, 'ファイルが見つかりません。\n');
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(safePath);
  } catch {
    sendText(res, 404, 'ファイルが見つかりません。\n');
    return;
  }

  if (stat.isDirectory()) {
    const indexPath = path.join(safePath, 'index.html');
    const safeIndex = await resolveSafePath(context.rootDir, indexPath);
    if (!safeIndex) {
      sendText(res, 404, 'ファイルが見つかりません。\n');
      return;
    }
    try {
      const indexStat = await fsp.stat(safeIndex);
      if (!indexStat.isFile()) {
        sendText(res, 404, 'ファイルが見つかりません。\n');
        return;
      }
      await sendFile(req, res, safeIndex, indexStat, method, context);
    } catch {
      sendText(res, 404, 'ファイルが見つかりません。\n');
    }
    return;
  }

  if (!stat.isFile()) {
    sendText(res, 404, 'ファイルが見つかりません。\n');
    return;
  }

  await sendFile(req, res, safePath, stat, method, context);
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

async function sendFile(req, res, filePath, stat, method, context) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const shouldTransform =
    typeof context.transformHtml === 'function' && ext === '.html';

  if (shouldTransform) {
    let html;
    try {
      html = await fsp.readFile(filePath, 'utf8');
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      console.error(
        `[JSKim] ファイルの読み込みに失敗しました。\n` +
          `原因: ${message}`
      );
      sendText(res, 500, 'ファイルの読み込み中にエラーが発生しました。\n');
      return;
    }

    const transformed = await context.transformHtml(html, {
      filePath,
      req,
      method,
    });
    const body = Buffer.from(
      typeof transformed === 'string' ? transformed : html,
      'utf8'
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('Cache-Control', 'no-store');

    if (method === 'HEAD') {
      res.end();
      return;
    }

    res.end(body);
    return;
  }

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
      `[JSKim] ファイルの読み込みに失敗しました。\n` +
        `原因: ${message}`
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
  createStaticServer,
  MIME_TYPES,
};
