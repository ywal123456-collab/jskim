'use strict';

const { loadConfig } = require('../lib/load-config');
const { resolveProject } = require('../lib/resolve-project');
const { selectProjectName } = require('../lib/select-project-name');
const { applyServeCliOverrides } = require('../lib/apply-serve-cli-overrides');
const { createStaticServer } = require('../lib/create-static-server');
const { createSpecMount } = require('../lib/create-spec-mount');
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
 * @param {string} [options.host]
 * @param {string|number} [options.port]
 * @returns {Promise<void>}
 */
async function runServeCommand(options = {}) {
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const usageLine =
    options.usageLine || 'jskim serve [<project>] [--host <host>] [--port <port>]';

  const { config } = loadConfig(workspaceRoot);
  const projectName = selectProjectName({
    config,
    projectName: options.projectName,
    commandName: 'serve',
    usageLine,
  });

  let project = resolveProject({
    config,
    workspaceRoot,
    projectName,
    commandName: 'serve',
    usageLine,
  });
  project = applyServeCliOverrides(project, {
    host: options.host,
    port: options.port,
  });

  const buildHint =
    options.buildHint || `jskim build ${project.name}`;
  assertOutputDirReady(project, { buildHint });

  const host = project.serve.host.trim();
  const port = project.serve.port;
  const outputDisplay = toDisplayPath(project.outputDir, workspaceRoot);

  const specMount = createSpecMount({
    workspaceRoot,
    projectName: project.name,
  });

  const staticServer = createStaticServer({
    rootDir: project.outputDir,
    host,
    port,
    projectName: project.name,
    handleInternalRequest: (req, res, meta) =>
      specMount.handleRequest(req, res, meta),
  });

  try {
    await staticServer.start();
  } catch (err) {
    throw formatListenError(err, {
      projectName: project.name,
      host,
      port,
      kind: '静的',
      commandName: 'serve',
    });
  }

  console.log('[JSKim] 静的サーバーを起動しました。');
  console.log(`プロジェクト: ${project.name}`);
  console.log(`ルート: ${outputDisplay}`);
  console.log(`URL: ${staticServer.url}`);
  console.log(
    `画面設計書: ${staticServer.url.replace(/\/$/, '')}/spec/ （build 済みの場合）`
  );
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
