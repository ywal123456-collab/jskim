'use strict';

const { loadConfig } = require('../lib/load-config');
const { resolveProject } = require('../lib/resolve-project');
const { createProjectWatcher } = require('../lib/create-project-watcher');
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

  const { config } = loadConfig(workspaceRoot);
  const project = resolveProject({
    config,
    workspaceRoot,
    projectName: options.projectName,
    commandName: 'watch',
    usageLine,
  });

  const projectWatcher = createProjectWatcher(project, {
    runInitialBuild: true,
    logChanges: true,
  });

  projectWatcher.on('ready', ({ displayPaths, debounceMs }) => {
    console.log(`[JSKim] プロジェクトを監視しています: ${project.name}`);
    console.log('パス:');
    for (const display of displayPaths) {
      console.log(`- ${display}`);
    }
    console.log('');
    console.log(`Debounce: ${debounceMs}ms`);
    console.log('終了するには Ctrl+C を押してください。');
  });

  await projectWatcher.start();

  let stopping = false;

  async function shutdown() {
    if (stopping) {
      return;
    }
    stopping = true;

    try {
      await projectWatcher.close();
    } catch {
      // 終了時エラーは無視
    }

    console.log('[JSKim] ウォッチを停止しました。');
    process.exit(0);
  }

  registerShutdown(shutdown);
}

module.exports = {
  runWatchCommand,
};
