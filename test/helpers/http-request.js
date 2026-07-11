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
 * @param {number} [options.timeoutMs=5000]
 */
function httpRequest(options) {
  const {
    hostname = '127.0.0.1',
    port,
    method = 'GET',
    path: reqPath,
    headers = {},
    timeoutMs = 5000,
  } = options;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname,
        port,
        method,
        path: reqPath,
        headers,
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
    req.end();
  });
}

/**
 * SSE 接続を開き、reload イベントを収集します。
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

        res.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            if (part.includes('event: reload')) {
              events.push(part);
            }
          }
        });

        resolve({
          status: res.statusCode,
          headers: res.headers,
          events,
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
};
