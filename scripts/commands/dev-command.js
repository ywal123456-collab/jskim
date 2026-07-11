'use strict';

const { loadConfig } = require('../lib/load-config');
const { resolveProject } = require('../lib/resolve-project');
const { createProjectWatcher } = require('../lib/create-project-watcher');
const { createStaticServer } = require('../lib/create-static-server');
const { createLiveReload } = require('../lib/create-live-reload');
const { registerShutdown } = require('./register-shutdown');
const { toDisplayPath } = require('./path-display');
const { formatListenError } = require('./serve-errors');

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

  const { config } = loadConfig(workspaceRoot);
  const project = resolveProject({
    config,
    workspaceRoot,
    projectName: options.projectName,
    commandName: 'dev',
    usageLine,
  });

  const host = project.serve.host.trim();
  const port = project.serve.port;
  const liveReloadEnabled = project.dev.liveReload;
  const outputDisplay = toDisplayPath(project.outputDir, workspaceRoot);

  const liveReload = createLiveReload({
    projectName: project.name,
    enabled: liveReloadEnabled,
  });

  const staticServer = createStaticServer({
    rootDir: project.outputDir,
    host,
    port,
    projectName: project.name,
    handleInternalRequest: (req, res, meta) =>
      liveReload.handleRequest(req, res, meta),
    transformHtml: liveReloadEnabled
      ? (html) => liveReload.injectHtml(html)
      : undefined,
  });

  const projectWatcher = createProjectWatcher(project, {
    runInitialBuild: true,
    logChanges: true,
  });

  // 成功した再ビルドのあとだけ reload（初回はクライアント未接続のため不要）
  projectWatcher.on('build:success', ({ initial }) => {
    if (!initial && liveReloadEnabled) {
      liveReload.broadcastReload();
    }
  });

  let stopping = false;
  let watcherStarted = false;

  async function shutdown() {
    if (stopping) {
      return;
    }
    stopping = true;

    try {
      if (watcherStarted) {
        await projectWatcher.close();
      }
    } catch {
      // 終了時エラーは無視
    }

    try {
      liveReload.close();
    } catch {
      // 終了時エラーは無視
    }

    try {
      await staticServer.stop();
    } catch {
      // 終了時エラーは無視
    }

    console.log('[JSKim] 開発サーバーを停止しました。');
    process.exit(0);
  }

  async function failStartup(err) {
    const message = err && err.message ? err.message : String(err);
    console.error(message);

    try {
      if (watcherStarted) {
        await projectWatcher.close();
      }
    } catch {
      // ignore
    }

    try {
      liveReload.close();
    } catch {
      // ignore
    }

    try {
      await staticServer.stop();
    } catch {
      // ignore
    }

    // cleanup 完了後に終了する。
    // IPC 接続があると exitCode だけではプロセスが残るため明示終了する。
    process.exit(1);
  }

  registerShutdown(shutdown);

  // 初回 build → server → watcher
  await projectWatcher.start({ watchFiles: false });
  watcherStarted = true;

  try {
    await staticServer.start();
  } catch (err) {
    await failStartup(
      formatListenError(err, {
        projectName: project.name,
        host,
        port,
        kind: '開発',
      })
    );
    return;
  }

  await projectWatcher.startWatching();

  console.log('[JSKim] 開発サーバーを起動しました。');
  console.log(`プロジェクト: ${project.name}`);
  console.log(`ルート: ${outputDisplay}`);
  console.log(`URL: ${staticServer.url}`);
  console.log(
    `ライブリロード: ${liveReloadEnabled ? '有効' : '無効'}`
  );
  console.log('終了するには Ctrl+C を押してください。');
}

module.exports = {
  runDevCommand,
};
