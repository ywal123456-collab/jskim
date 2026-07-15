'use strict';

const http = require('node:http');

/**
 * 生の HTTP リクエストを送ります（path の自動正規化を避けるため）。
 *
 * @param {object} options
 * @param {string} [options.hostname='127.0.0.1']
 * @param {number} options.port
 * @param {string} [options.method='GET']
 * @param {string} options.path
 * @param {object} [options.headers]
 * @param {string|Buffer} [options.body]
 * @param {number} [options.timeoutMs=5000]
 */
function httpRequest(options) {
  const {
    hostname = '127.0.0.1',
    port,
    method = 'GET',
    path: reqPath,
    headers = {},
    body,
    timeoutMs = 5000,
  } = options;

  const payload =
    body == null
      ? null
      : Buffer.isBuffer(body)
        ? body
        : Buffer.from(String(body), 'utf8');

  const nextHeaders = { ...headers };
  if (payload && nextHeaders['Content-Length'] == null) {
    nextHeaders['Content-Length'] = String(payload.length);
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname,
        port,
        method,
        path: reqPath,
        headers: nextHeaders,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`HTTP タイムアウト: ${method} ${reqPath}`));
    });
    req.on('error', reject);
    if (payload) {
      req.end(payload);
    } else {
      req.end();
    }
  });
}

/**
 * SSE フレームを解析します。
 * @param {string} frame
 * @returns {{ name: string, data: string, raw: string }|null}
 */
function parseSseFrame(frame) {
  if (!frame || typeof frame !== 'string') {
    return null;
  }
  let name = 'message';
  const dataLines = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) {
      name = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  if (dataLines.length === 0 && name === 'message') {
    return null;
  }
  return {
    name,
    data: dataLines.join('\n'),
    raw: frame,
  };
}

/**
 * SSE 接続を開き、名前付きイベントを収集します。
 *
 * 互換のため `events` は reload の raw frame 配列のままです。
 * 新しい検証は `typedEvents` / `count(name)` を使います。
 */
function openSse(options) {
  const {
    hostname = '127.0.0.1',
    port,
    path: reqPath = '/_jskim/live-reload',
    timeoutMs = 5000,
  } = options;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname,
        port,
        method: 'GET',
        path: reqPath,
        headers: { Accept: 'text/event-stream' },
      },
      (res) => {
        let buffer = '';
        const events = [];
        const typedEvents = [];

        res.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            const parsed = parseSseFrame(part);
            if (!parsed) {
              continue;
            }
            typedEvents.push(parsed);
            if (parsed.name === 'reload') {
              events.push(part);
            }
          }
        });

        resolve({
          status: res.statusCode,
          headers: res.headers,
          events,
          typedEvents,
          count(name) {
            return typedEvents.filter((item) => item.name === name).length;
          },
          last(name) {
            for (let i = typedEvents.length - 1; i >= 0; i -= 1) {
              if (typedEvents[i].name === name) {
                return typedEvents[i];
              }
            }
            return null;
          },
          close() {
            req.destroy();
            res.destroy();
          },
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('SSE 接続タイムアウト'));
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = {
  httpRequest,
  openSse,
  parseSseFrame,
};
