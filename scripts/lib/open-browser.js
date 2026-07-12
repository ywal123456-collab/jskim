'use strict';

const { spawn } = require('node:child_process');

/**
 * browser で開く URL を組み立てます（listen host と分離）。
 *
 * @param {{ host: string, port: number }} options
 * @returns {string}
 */
function buildBrowserOpenUrl({ host, port }) {
  let browserHost = String(host || '').trim();
  if (browserHost === '0.0.0.0') {
    browserHost = '127.0.0.1';
  } else if (browserHost === '::') {
    browserHost = 'localhost';
  }

  const portText = String(port);
  if (browserHost.includes(':') && !browserHost.startsWith('[')) {
    return `http://[${browserHost}]:${portText}/`;
  }
  return `http://${browserHost}:${portText}/`;
}

/**
 * OS別の open 用 executable / args を返します（shell 不使用）。
 *
 * @param {string} url
 * @param {string} [platform=process.platform]
 * @returns {{ command: string, args: string[] }}
 */
function buildOpenBrowserCommand(url, platform = process.platform) {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error('[JSKim] browser URLが空です。');
  }

  if (platform === 'win32') {
    return {
      command: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', url],
    };
  }

  if (platform === 'darwin') {
    return {
      command: 'open',
      args: [url],
    };
  }

  return {
    command: 'xdg-open',
    args: [url],
  };
}

/**
 * browser を開きます。失敗しても throw せず結果を返します。
 *
 * @param {string} url
 * @param {object} [options]
 * @param {typeof spawn} [options.spawnFn]
 * @param {string} [options.platform]
 * @returns {{ ok: boolean, error?: Error, command: string, args: string[] }}
 */
function openBrowser(url, options = {}) {
  const spawnFn = options.spawnFn || spawn;
  const platform = options.platform || process.platform;
  const { command, args } = buildOpenBrowserCommand(url, platform);

  try {
    const child = spawnFn(command, args, {
      shell: false,
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    if (child && typeof child.unref === 'function') {
      child.unref();
    }
    if (child && typeof child.on === 'function') {
      child.on('error', () => {
        // warning は呼び出し側で扱う
      });
    }
    return { ok: true, command, args };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err : new Error(String(err)),
      command,
      args,
    };
  }
}

module.exports = {
  buildBrowserOpenUrl,
  buildOpenBrowserCommand,
  openBrowser,
};
