'use strict';

const { spawn } = require('node:child_process');

/**
 * JSKim CLI を一時ワークスペースで起動します。
 *
 * @param {object} options
 * @param {string} options.scriptPath
 * @param {string} options.cwd
 * @param {string[]} [options.args]
 * @param {boolean} [options.ipc]
 * @param {number} [options.timeoutMs]
 */
function runCli(options) {
  const {
    scriptPath,
    cwd,
    args = [],
    ipc = false,
    timeoutMs = 20000,
    env = {},
  } = options;

  const stdio = ipc
    ? ['ignore', 'pipe', 'pipe', 'ipc']
    : ['ignore', 'pipe', 'pipe'];

  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd,
    stdio,
    env: { ...process.env, FORCE_COLOR: '0', ...env },
  });

  let output = '';
  let settled = false;
  let timeoutId = null;

  const onData = (chunk) => {
    output += chunk.toString();
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  const exitPromise = new Promise((resolve, reject) => {
    child.on('error', (err) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(err);
    });

    child.on('exit', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve({ code, signal, output });
    });
  });

  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      forceKill(child);
    }, timeoutMs);
  }

  return {
    child,
    get output() {
      return output;
    },
    waitForExit: () => exitPromise,
    async stop() {
      if (child.exitCode !== null || child.killed) {
        return exitPromise;
      }
      if (ipc && typeof child.send === 'function') {
        try {
          child.send('jskim:stop');
        } catch {
          forceKill(child);
        }
      } else {
        forceKill(child);
      }
      return exitPromise;
    },
    forceKill() {
      forceKill(child);
      return exitPromise;
    },
  };
}

function forceKill(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // ignore
  }
  setTimeout(() => {
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  }, 1000).unref?.();
}

module.exports = {
  runCli,
};
