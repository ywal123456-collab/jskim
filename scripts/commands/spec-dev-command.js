'use strict';

const { createSpecDevRuntime } = require('../lib/create-spec-dev-runtime');
const { registerShutdown } = require('./register-shutdown');

/**
 * jskim spec dev を実行します。
 *
 * @param {object} options
 * @returns {Promise<void>}
 */
async function runSpecDevCommand(options = {}) {
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const usageLine =
    options.usageLine ||
    'jskim spec dev [<project>] [--host <host>] [--port <port>] [--open]';

  const runtime = createSpecDevRuntime({
    ...options,
    workspaceRoot,
    usageLine,
  });

  let stopping = false;

  async function shutdown() {
    if (stopping) {
      return;
    }
    stopping = true;

    try {
      await runtime.close();
    } catch {
      // 終了時エラーは無視
    }

    console.log('[JSKim] 画面設計書の開発serverを停止しました。');
    process.exit(0);
  }

  registerShutdown(shutdown);

  try {
    await runtime.start();
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error(message);
    try {
      await runtime.close();
    } catch {
      // ignore
    }
    process.exit(1);
  }
}

module.exports = {
  runSpecDevCommand,
};
