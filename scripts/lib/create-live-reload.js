'use strict';

const LIVE_RELOAD_PATH = '/_jskim/live-reload';
const HEARTBEAT_MS = 20000;

/**
 * SSE ベースのライブリロード管理です。
 * dist には書き込まず、dev の HTML レスポンス注入と SSE 配信だけを担当します。
 *
 * @param {object} options
 * @param {string} options.projectName
 * @param {boolean} [options.enabled=true]
 */
function createLiveReload({ projectName, enabled = true }) {
  const clients = new Set();
  let heartbeatTimer = null;
  let closed = false;

  function ensureHeartbeat() {
    if (!enabled || heartbeatTimer || closed) {
      return;
    }
    heartbeatTimer = setInterval(() => {
      for (const res of [...clients]) {
        try {
          res.write(': heartbeat\n\n');
        } catch {
          removeClient(res);
        }
      }
    }, HEARTBEAT_MS);
    if (typeof heartbeatTimer.unref === 'function') {
      heartbeatTimer.unref();
    }
  }

  function removeClient(res) {
    if (!clients.has(res)) {
      return;
    }
    clients.delete(res);
    try {
      res.end();
    } catch {
      // 切断済み
    }
  }

  /**
   * 内部 SSE リクエストを処理します。
   * @returns {boolean} 処理したら true
   */
  function handleRequest(req, res, context = {}) {
    if (!enabled || closed) {
      return false;
    }

    const pathname = context.pathname || '';
    if (pathname !== LIVE_RELOAD_PATH) {
      return false;
    }

    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      const body = Buffer.from('このHTTPメソッドは使用できません。\n', 'utf8');
      res.setHeader('Content-Length', String(body.length));
      if (method === 'HEAD') {
        res.end();
      } else {
        res.end(body);
      }
      return true;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    // nginx 等のバッファリング回避（ローカルでも無害）
    res.setHeader('X-Accel-Buffering', 'no');

    if (method === 'HEAD') {
      res.end();
      return true;
    }

    res.write(': connected\n\n');
    clients.add(res);
    ensureHeartbeat();

    const onClose = () => {
      removeClient(res);
    };
    req.on('close', onClose);
    res.on('close', onClose);
    res.on('error', onClose);

    return true;
  }

  function getClientScript() {
    return [
      '<script>',
      '(function () {',
      '  try {',
      `    var source = new EventSource(${JSON.stringify(LIVE_RELOAD_PATH)});`,
      "    source.addEventListener('reload', function () {",
      '      window.location.reload();',
      '    });',
      '    source.onerror = function () {',
      "      console.info('[JSKim] ライブリロード接続を再試行しています…');",
      '    };',
      '  } catch (err) {',
      "    console.warn('[JSKim] ライブリロードを開始できませんでした。');",
      '  }',
      '})();',
      '</script>',
    ].join('');
  }

  /**
   * HTML 文字列に client script を注入します（メモリ上のみ）。
   * @param {string} html
   * @returns {string}
   */
  function injectHtml(html) {
    if (!enabled || typeof html !== 'string') {
      return html;
    }

    const script = getClientScript();
    const bodyClose = html.search(/<\/body>/i);
    if (bodyClose !== -1) {
      return html.slice(0, bodyClose) + script + html.slice(bodyClose);
    }

    const htmlClose = html.search(/<\/html>/i);
    if (htmlClose !== -1) {
      return html.slice(0, htmlClose) + script + html.slice(htmlClose);
    }

    return html + script;
  }

  function broadcastReload() {
    if (!enabled || closed) {
      return;
    }

    const payload = `event: reload\ndata: ${JSON.stringify({
      project: projectName,
    })}\n\n`;

    for (const res of [...clients]) {
      try {
        res.write(payload);
      } catch {
        removeClient(res);
      }
    }
  }

  function close() {
    if (closed) {
      return;
    }
    closed = true;

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    for (const res of [...clients]) {
      removeClient(res);
    }
    clients.clear();
  }

  return {
    enabled: Boolean(enabled),
    path: LIVE_RELOAD_PATH,
    handleRequest,
    injectHtml,
    broadcastReload,
    getClientScript,
    close,
    get clientCount() {
      return clients.size;
    },
  };
}

module.exports = {
  createLiveReload,
  LIVE_RELOAD_PATH,
};
