'use strict';

/**
 * CLI の SIGINT/SIGTERM と内部検証用 IPC を登録します。
 * @param {() => void|Promise<void>} shutdown
 */
function registerShutdown(shutdown) {
  process.on('SIGINT', () => {
    shutdown();
  });
  process.on('SIGTERM', () => {
    shutdown();
  });

  if (process.platform === 'win32' && process.stdin.isTTY) {
    const readline = require('node:readline');
    readline.createInterface({ input: process.stdin }).on('SIGINT', () => {
      shutdown();
    });
  }

  // 内部検証用 IPC（公開機能ではない。一般利用は Ctrl+C）
  process.on('message', (msg) => {
    if (msg === 'jskim:stop') {
      shutdown();
    }
  });
}

module.exports = {
  registerShutdown,
};
