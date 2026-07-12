'use strict';

const {
  isSameOriginStylesheetHref,
  appendCacheBustParam,
} = require('./stylesheet-reload');

const LIVE_RELOAD_PATH = '/_jskim/live-reload';
const HEARTBEAT_MS = 20000;
const CSS_LOAD_TIMEOUT_MS = 8000;
const OVERLAY_HOST_ID = '__jskim_error_overlay__';

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
  /** @type {string|null} */
  let configError = null;
  /** @type {string|null} */
  let buildError = null;

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

  function writeEvent(res, eventName, data) {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(payload);
  }

  function broadcast(eventName, data) {
    if (!enabled || closed) {
      return;
    }
    for (const res of [...clients]) {
      try {
        writeEvent(res, eventName, data);
      } catch {
        removeClient(res);
      }
    }
  }

  function getActiveErrorMessage() {
    return configError || buildError;
  }

  function hasConfigError() {
    return Boolean(configError);
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
    res.setHeader('X-Accel-Buffering', 'no');

    if (method === 'HEAD') {
      res.end();
      return true;
    }

    res.write(': connected\n\n');
    clients.add(res);
    ensureHeartbeat();

    const active = getActiveErrorMessage();
    if (active) {
      try {
        writeEvent(res, 'error', {
          project: projectName,
          message: active,
        });
      } catch {
        removeClient(res);
      }
    }

    const onClose = () => {
      removeClient(res);
    };
    req.on('close', onClose);
    res.on('close', onClose);
    res.on('error', onClose);

    return true;
  }

  function getClientScript() {
    return buildClientScript({
      liveReloadPath: LIVE_RELOAD_PATH,
      overlayHostId: OVERLAY_HOST_ID,
      cssLoadTimeoutMs: CSS_LOAD_TIMEOUT_MS,
    });
  }

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

  function broadcastConfigError(message) {
    if (!enabled || closed) {
      return;
    }
    configError = normalizeErrorMessage(message);
    broadcast('error', {
      project: projectName,
      message: configError,
    });
  }

  function broadcastBuildError(message) {
    if (!enabled || closed) {
      return;
    }
    buildError = normalizeErrorMessage(message);
    // 未解決の config error がある間は config を優先表示する
    if (!configError) {
      broadcast('error', {
        project: projectName,
        message: buildError,
      });
    }
  }

  /**
   * 後方互換: source を指定して error を送る。
   * @param {unknown} message
   * @param {'build'|'config'} [source='build']
   */
  function broadcastError(message, source = 'build') {
    if (source === 'config') {
      broadcastConfigError(message);
      return;
    }
    broadcastBuildError(message);
  }

  function clearConfigError() {
    configError = null;
  }

  function clearBuildError() {
    buildError = null;
  }

  function clearErrorState() {
    configError = null;
    buildError = null;
  }

  function broadcastClearError() {
    if (!enabled || closed) {
      return;
    }
    clearErrorState();
    broadcast('clear-error', {
      project: projectName,
    });
  }

  function broadcastCssReload() {
    if (!enabled || closed) {
      return false;
    }
    // 未解決の config エラー中は source 成功で overlay を消さない
    if (configError) {
      return false;
    }
    clearBuildError();
    broadcast('clear-error', {
      project: projectName,
    });
    broadcast('css', {
      project: projectName,
    });
    return true;
  }

  function broadcastReload() {
    if (!enabled || closed) {
      return false;
    }
    // reconnect で stale error が復帰しないよう、reload 前に server 状態を消す
    clearErrorState();
    broadcast('reload', {
      project: projectName,
    });
    return true;
  }

  /**
   * source rebuild 成功時専用。config error が残っていれば何もしない。
   * @param {'css'|'reload'} kind
   * @returns {boolean}
   */
  function notifySourceBuildSuccess(kind) {
    if (!enabled || closed) {
      return false;
    }
    if (configError) {
      return false;
    }
    if (kind === 'css') {
      return broadcastCssReload();
    }
    return broadcastReload();
  }

  function close() {
    if (closed) {
      return;
    }
    closed = true;
    clearErrorState();

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
    broadcastError,
    broadcastConfigError,
    broadcastBuildError,
    broadcastClearError,
    broadcastCssReload,
    notifySourceBuildSuccess,
    clearConfigError,
    clearBuildError,
    clearErrorState,
    hasConfigError,
    getClientScript,
    close,
    get clientCount() {
      return clients.size;
    },
    get lastErrorMessage() {
      return getActiveErrorMessage();
    },
    get configErrorMessage() {
      return configError;
    },
    get buildErrorMessage() {
      return buildError;
    },
  };
}

function normalizeErrorMessage(message) {
  if (message == null) {
    return String(message);
  }
  if (typeof message === 'string') {
    return message;
  }
  if (typeof message === 'object' && typeof message.message === 'string') {
    return message.message;
  }
  return String(message);
}

/**
 * browser に注入する runtime script を組み立てます。
 * stylesheet 判定は stylesheet-reload.js の関数本体を埋め込み、実装 drift を防ぎます。
 *
 * @param {object} options
 * @returns {string}
 */
function buildClientScript(options) {
  const liveReloadPath = JSON.stringify(options.liveReloadPath);
  const overlayHostId = JSON.stringify(options.overlayHostId);
  const cssLoadTimeoutMs = Number(options.cssLoadTimeoutMs) || CSS_LOAD_TIMEOUT_MS;

  return [
    '<script>',
    '(function () {',
    '  var LIVE_RELOAD_PATH = ' + liveReloadPath + ';',
    '  var OVERLAY_HOST_ID = ' + overlayHostId + ';',
    '  var CSS_LOAD_TIMEOUT_MS = ' + cssLoadTimeoutMs + ';',
    '  var overlayHost = null;',
    '  var fallbackReloadScheduled = false;',
    '  var isSameOriginStylesheetHref = ' +
      isSameOriginStylesheetHref.toString() +
      ';',
    '  var appendCacheBustParam = ' + appendCacheBustParam.toString() + ';',
    '',
    '  function scheduleFullReload() {',
    '    if (fallbackReloadScheduled) {',
    '      return;',
    '    }',
    '    fallbackReloadScheduled = true;',
    '    window.location.reload();',
    '  }',
    '',
    '  function ensureOverlayHost() {',
    '    var existing = document.getElementById(OVERLAY_HOST_ID);',
    '    if (existing) {',
    '      overlayHost = existing;',
    '      return existing;',
    '    }',
    '    var host = document.createElement("div");',
    '    host.id = OVERLAY_HOST_ID;',
    '    host.setAttribute("data-jskim-overlay", "true");',
    '    host.style.all = "initial";',
    '    host.style.position = "fixed";',
    '    host.style.inset = "0";',
    '    host.style.zIndex = "2147483646";',
    '    host.style.pointerEvents = "none";',
    '    document.documentElement.appendChild(host);',
    '    overlayHost = host;',
    '    return host;',
    '  }',
    '',
    '  function showErrorOverlay(message) {',
    '    var host = ensureOverlayHost();',
    '    var shadow = host.shadowRoot || host.attachShadow({ mode: "open" });',
    '    while (shadow.firstChild) {',
    '      shadow.removeChild(shadow.firstChild);',
    '    }',
    '    var style = document.createElement("style");',
    '    style.textContent = [',
    '      ":host { all: initial; }",',
    '      ".wrap { pointer-events: auto; position: fixed; inset: 0; display: flex; align-items: flex-start; justify-content: center; padding: 24px 16px; box-sizing: border-box; background: rgba(20, 20, 20, 0.55); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }",',
    '      ".panel { width: min(920px, 100%); max-height: min(80vh, 720px); display: flex; flex-direction: column; background: #111; color: #f5f5f5; border: 1px solid #444; box-shadow: 0 12px 40px rgba(0,0,0,0.45); }",',
    '      ".head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #333; background: #1a1a1a; }",',
    '      ".title { font-size: 14px; font-weight: 700; letter-spacing: 0.02em; }",',
    '      ".close { pointer-events: auto; border: 1px solid #666; background: #222; color: #fff; padding: 4px 10px; cursor: pointer; font: inherit; }",',
    '      ".body { overflow: auto; padding: 14px; margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; }"',
    '    ].join("");',
    '    var wrap = document.createElement("div");',
    '    wrap.className = "wrap";',
    '    var panel = document.createElement("div");',
    '    panel.className = "panel";',
    '    var head = document.createElement("div");',
    '    head.className = "head";',
    '    var title = document.createElement("div");',
    '    title.className = "title";',
    '    title.textContent = "JSKim dev error";',
    '    var closeBtn = document.createElement("button");',
    '    closeBtn.type = "button";',
    '    closeBtn.className = "close";',
    '    closeBtn.textContent = "Close";',
    '    closeBtn.addEventListener("click", function () {',
    '      hideErrorOverlay();',
    '    });',
    '    var body = document.createElement("pre");',
    '    body.className = "body";',
    '    body.textContent = String(message == null ? "" : message);',
    '    head.appendChild(title);',
    '    head.appendChild(closeBtn);',
    '    panel.appendChild(head);',
    '    panel.appendChild(body);',
    '    wrap.appendChild(panel);',
    '    shadow.appendChild(style);',
    '    shadow.appendChild(wrap);',
    '    host.style.display = "block";',
    '    host.style.pointerEvents = "none";',
    '  }',
    '',
    '  function hideErrorOverlay() {',
    '    var host = overlayHost || document.getElementById(OVERLAY_HOST_ID);',
    '    if (!host) {',
    '      return;',
    '    }',
    '    if (host.shadowRoot) {',
    '      while (host.shadowRoot.firstChild) {',
    '        host.shadowRoot.removeChild(host.shadowRoot.firstChild);',
    '      }',
    '    }',
    '    host.style.display = "none";',
    '  }',
    '',
    '  function isSameOriginHref(href) {',
    '    return isSameOriginStylesheetHref(href, window.location.href);',
    '  }',
    '',
    '  function withCacheBust(href, token) {',
    '    return appendCacheBustParam(href, window.location.href, token);',
    '  }',
    '',
    '  function reloadStylesheets() {',
    '    var links = Array.prototype.slice.call(',
    '      document.querySelectorAll(\'link[rel~="stylesheet"]\')',
    '    );',
    '    var targets = [];',
    '    for (var i = 0; i < links.length; i += 1) {',
    '      var link = links[i];',
    '      var href = link.getAttribute("href") || link.href;',
    '      if (isSameOriginHref(href)) {',
    '        targets.push(link);',
    '      }',
    '    }',
    '    if (targets.length === 0) {',
    '      scheduleFullReload();',
    '      return;',
    '    }',
    '',
    '    var token = String(Date.now());',
    '    var remaining = targets.length;',
    '    var failed = false;',
    '',
    '    function doneOne(ok) {',
    '      if (failed) {',
    '        return;',
    '      }',
    '      if (!ok) {',
    '        failed = true;',
    '        scheduleFullReload();',
    '        return;',
    '      }',
    '      remaining -= 1;',
    '      if (remaining <= 0) {',
    '        fallbackReloadScheduled = false;',
    '      }',
    '    }',
    '',
    '    for (var j = 0; j < targets.length; j += 1) {',
    '      (function (oldLink) {',
    '        var nextHref = withCacheBust(oldLink.getAttribute("href") || oldLink.href, token);',
    '        if (!nextHref) {',
    '          doneOne(false);',
    '          return;',
    '        }',
    '        var clone = oldLink.cloneNode(true);',
    '        clone.setAttribute("href", nextHref);',
    '        var settled = false;',
    '        var timer = setTimeout(function () {',
    '          if (settled) {',
    '            return;',
    '          }',
    '          settled = true;',
    '          doneOne(false);',
    '        }, CSS_LOAD_TIMEOUT_MS);',
    '        function finish(ok) {',
    '          if (settled) {',
    '            return;',
    '          }',
    '          settled = true;',
    '          clearTimeout(timer);',
    '          if (ok) {',
    '            if (oldLink.parentNode) {',
    '              oldLink.parentNode.removeChild(oldLink);',
    '            }',
    '          }',
    '          doneOne(ok);',
    '        }',
    '        clone.addEventListener("load", function () { finish(true); });',
    '        clone.addEventListener("error", function () { finish(false); });',
    '        if (oldLink.parentNode) {',
    '          oldLink.parentNode.insertBefore(clone, oldLink.nextSibling);',
    '        } else {',
    '          finish(false);',
    '        }',
    '      })(targets[j]);',
    '    }',
    '  }',
    '',
    '  try {',
    '    var source = new EventSource(LIVE_RELOAD_PATH);',
    '    source.addEventListener("reload", function () {',
    '      window.location.reload();',
    '    });',
    '    source.addEventListener("error", function (event) {',
    '      if (event && typeof event.data === "string" && event.data) {',
    '        try {',
    '          var payload = JSON.parse(event.data);',
    '          showErrorOverlay(payload.message || "Build error");',
    '        } catch (err) {',
    '          showErrorOverlay("Build error");',
    '        }',
    '        return;',
    '      }',
    '      console.info("[JSKim] ライブリロード接続を再試行しています…");',
    '    });',
    '    source.addEventListener("clear-error", function () {',
    '      hideErrorOverlay();',
    '    });',
    '    source.addEventListener("css", function () {',
    '      try {',
    '        reloadStylesheets();',
    '      } catch (err) {',
    '        scheduleFullReload();',
    '      }',
    '    });',
    '  } catch (err) {',
    '    console.warn("[JSKim] ライブリロードを開始できませんでした。");',
    '  }',
    '})();',
    '</script>',
  ].join('\n');
}

module.exports = {
  createLiveReload,
  LIVE_RELOAD_PATH,
  OVERLAY_HOST_ID,
  CSS_LOAD_TIMEOUT_MS,
  buildClientScript,
  normalizeErrorMessage,
};
