'use strict';

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runBuild } = require('./build-project');
const { createStaticServer } = require('./create-static-server');
const { getFreePort } = require('./get-free-port');

/**
 * preserve ビルド → 一時サーバー → companion collect を実行します。
 * 成功・失敗どちらでも TEMP / server を整理します。
 *
 * @param {object} options
 * @param {object} options.project resolve 済み project
 * @param {string} options.workspaceRoot
 * @param {string} options.projectName
 * @param {(opts: object) => Promise<object>} options.collectScreenSpecProject
 * @param {boolean} [options.log=false]
 * @returns {Promise<object>}
 */
async function runScreenSpecCollect(options) {
  const project = options.project;
  const workspaceRoot = options.workspaceRoot;
  const projectName = options.projectName;
  const collectScreenSpecProject = options.collectScreenSpecProject;
  const log = Boolean(options.log);

  if (typeof collectScreenSpecProject !== 'function') {
    throw new Error(
      '[JSKim] runScreenSpecCollect には collectScreenSpecProject が必要です。'
    );
  }

  const tempDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), `jskim-spec-collect-${projectName}-`)
  );

  let staticServer = null;
  let collectResult = null;

  const collectProject = {
    ...project,
    build: {
      ...project.build,
      clean: true,
    },
  };

  try {
    if (log) {
      console.log('[JSKim] 画面設計書を収集しています。');
    }

    await runBuild(collectProject, {
      preserveScreenSpecAttributes: true,
      outputDir: tempDir,
      log: false,
      includeOutput: false,
    });

    const port = await getFreePort();
    staticServer = createStaticServer({
      rootDir: tempDir,
      host: '127.0.0.1',
      port,
      projectName,
    });
    await staticServer.start();

    const baseUrl = `http://127.0.0.1:${port}`;

    collectResult = await collectScreenSpecProject({
      rootDir: workspaceRoot,
      projectName,
      baseUrl,
      renderedRootDir: tempDir,
    });
  } finally {
    if (staticServer) {
      try {
        await staticServer.stop();
      } catch {
        // 終了時の close エラーは無視
      }
    }
    try {
      await fsp.rm(tempDir, { recursive: true, force: true });
    } catch {
      console.warn(`[JSKim] 一時ビルドの削除に失敗しました: ${tempDir}`);
    }
  }

  return collectResult;
}

module.exports = {
  runScreenSpecCollect,
};
