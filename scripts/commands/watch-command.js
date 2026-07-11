'use strict';

const { createWatchRuntime } = require('../lib/create-watch-runtime');
const { registerShutdown } = require('./register-shutdown');

/**
 * watch コマンドを実行します。
 * @param {object} options
 * @param {string|undefined} options.projectName
 * @param {string} [options.workspaceRoot]
 * @param {string} [options.usageLine]
 * @returns {Promise<void>}
 */
async function runWatchCommand(options = {}) {
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const usageLine =
    options.usageLine || 'npm run watch -- <project-name>';

  const runtime = createWatchRuntime({
    mode: 'watch',
    workspaceRoot,
    projectName: options.projectName,
    commandName: 'watch',
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

    console.log('[JSKim] ウォッチを停止しました。');
    process.exit(0);
  }

  registerShutdown(shutdown);

  try {
    await runtime.start();
  } catch (err) {
    try {
      await runtime.close();
    } catch {
      // ignore
    }
    throw err;
  }
}

module.exports = {
  runWatchCommand,
};
