'use strict';

const { loadConfig } = require('../lib/load-config');
const { resolveProject } = require('../lib/resolve-project');
const { createStaticServer } = require('../lib/create-static-server');
const { registerShutdown } = require('./register-shutdown');
const { toDisplayPath } = require('./path-display');
const { assertOutputDirReady, formatListenError } = require('./serve-errors');

/**
 * serve コマンドを実行します。
 * @param {object} options
 * @param {string|undefined} options.projectName
 * @param {string} [options.workspaceRoot]
 * @param {string} [options.usageLine]
 * @param {string} [options.buildHint]
 * @returns {Promise<void>}
 */
async function runServeCommand(options = {}) {
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const usageLine =
    options.usageLine || 'npm run serve -- <project-name>';

  const { config } = loadConfig(workspaceRoot);
  const project = resolveProject({
    config,
    workspaceRoot,
    projectName: options.projectName,
    commandName: 'serve',
    usageLine,
  });

  const buildHint =
    options.buildHint || `npm run build -- ${project.name}`;
  assertOutputDirReady(project, { buildHint });

  const host = project.serve.host.trim();
  const port = project.serve.port;
  const outputDisplay = toDisplayPath(project.outputDir, workspaceRoot);

  const staticServer = createStaticServer({
    rootDir: project.outputDir,
    host,
    port,
    projectName: project.name,
  });

  try {
    await staticServer.start();
  } catch (err) {
    throw formatListenError(err, {
      projectName: project.name,
      host,
      port,
      kind: '静的',
    });
  }

  console.log('[JSKim] 静的サーバーを起動しました。');
  console.log(`プロジェクト: ${project.name}`);
  console.log(`ルート: ${outputDisplay}`);
  console.log(`URL: ${staticServer.url}`);
  console.log('終了するには Ctrl+C を押してください。');

  let stopping = false;

  async function shutdown() {
    if (stopping) {
      return;
    }
    stopping = true;

    try {
      await staticServer.stop();
    } catch {
      // 終了時の close エラーは無視
    }

    console.log('[JSKim] 静的サーバーを停止しました。');
    process.exit(0);
  }

  registerShutdown(shutdown);
}

module.exports = {
  runServeCommand,
};
