'use strict';

const { createWatchRuntime } = require('../lib/create-watch-runtime');
const { registerShutdown } = require('./register-shutdown');

/**
 * dev コマンドを実行します。
 * @param {object} options
 * @param {string|undefined} options.projectName
 * @param {string} [options.workspaceRoot]
 * @param {string} [options.usageLine]
 * @returns {Promise<void>}
 */
async function runDevCommand(options = {}) {
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const usageLine =
    options.usageLine || 'npm run dev -- <project-name>';

  const runtime = createWatchRuntime({
    mode: 'dev',
    workspaceRoot,
    projectName: options.projectName,
    commandName: 'dev',
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

    console.log('[JSKim] 開発サーバーを停止しました。');
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
    // cleanup 完了後に終了する。
    // IPC 接続があると exitCode だけではプロセスが残るため明示終了する。
    process.exit(1);
  }
}

module.exports = {
  runDevCommand,
};
