'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../lib/load-config');
const { selectProjectName } = require('../lib/select-project-name');
const { resolveProject } = require('../lib/resolve-project');
const { runBuild } = require('../lib/build-project');
const { createStaticServer } = require('../lib/create-static-server');
const { getFreePort } = require('../lib/get-free-port');
const { resolveScreenSpecModule } = require('../lib/resolve-screen-spec-module');
const { toDisplayPath } = require('./path-display');

/**
 * jskim spec collect を実行します。
 *
 * 流れ:
 * 1. preserve build → OS TEMP
 * 2. 127.0.0.1 の一時サーバー
 * 3. companion collectScreenSpecProject
 * 4. 成功・失敗どちらでも TEMP / server を整理
 *
 * @param {object} options
 * @param {string|undefined} options.projectName
 * @param {string} [options.workspaceRoot]
 * @param {string} [options.usageLine]
 * @param {string} [options.modulePath]
 * @returns {Promise<object>}
 */
async function runSpecCollectCommand(options = {}) {
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const usageLine =
    options.usageLine || 'jskim spec collect [<project>]';

  const { config } = loadConfig(workspaceRoot);
  const projectName = selectProjectName({
    config,
    projectName: options.projectName,
    commandName: 'spec collect',
    usageLine,
  });

  const project = resolveProject({
    config,
    workspaceRoot,
    projectName,
    commandName: 'spec collect',
    usageLine,
  });

  const { collectScreenSpecProject } = await resolveScreenSpecModule({
    projectRoot: workspaceRoot,
    modulePath: options.modulePath,
    requireCollect: true,
  });

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
      // TEMP 削除失敗は警告のみ
      console.warn(`[JSKim] 一時ビルドの削除に失敗しました: ${tempDir}`);
    }
  }

  const snapDisplay = toDisplayPath(
    path.join(workspaceRoot, 'spec', projectName, 'src', 'snapshots'),
    workspaceRoot
  );

  console.log('[JSKim] 画面設計書用の snapshot を収集しました。');
  console.log(`プロジェクト: ${projectName}`);
  console.log(`screens: ${collectResult.screens}`);
  console.log(`states: ${collectResult.states}`);
  console.log(`updated: ${collectResult.updated}`);
  console.log(`unchanged: ${collectResult.unchanged}`);
  if (collectResult.warnings && collectResult.warnings.length > 0) {
    console.log(`warnings: ${collectResult.warnings.length}`);
    for (const warning of collectResult.warnings) {
      console.log(`- ${warning}`);
    }
  }
  console.log(`出力: ${snapDisplay}`);
  console.log(
    '次の手順: jskim spec build ' +
      projectName +
      ' → jskim dev ' +
      projectName
  );

  return collectResult;
}

module.exports = {
  runSpecCollectCommand,
};
