'use strict';

const path = require('node:path');
const { loadConfig } = require('../lib/load-config');
const { selectProjectName } = require('../lib/select-project-name');
const { resolveProject } = require('../lib/resolve-project');
const { resolveScreenSpecModule } = require('../lib/resolve-screen-spec-module');
const { toDisplayPath } = require('./path-display');

/**
 * jskim spec build を実行します。
 *
 * @param {object} options
 * @param {string|undefined} options.projectName
 * @param {string} [options.workspaceRoot]
 * @param {string} [options.usageLine]
 * @param {string} [options.modulePath] companion entry 明示（test 用）
 * @returns {Promise<{ outDir: string, projectName: string }>}
 */
async function runSpecBuildCommand(options = {}) {
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const usageLine =
    options.usageLine || 'jskim spec build [<project>]';

  const { config } = loadConfig(workspaceRoot);
  const projectName = selectProjectName({
    config,
    projectName: options.projectName,
    commandName: 'spec build',
    usageLine,
  });

  // project が設定に存在することを確認する（未定義 project を防ぐ）
  resolveProject({
    config,
    workspaceRoot,
    projectName,
    commandName: 'spec build',
    usageLine,
  });

  const { buildScreenSpecViewer } = await resolveScreenSpecModule({
    projectRoot: workspaceRoot,
    modulePath: options.modulePath,
  });

  const result = await buildScreenSpecViewer({
    rootDir: workspaceRoot,
    projectName,
    base: '/spec/',
  });

  const outDisplay = toDisplayPath(result.outDir, workspaceRoot);
  console.log('[JSKim] 画面設計書を build しました。');
  console.log(`プロジェクト: ${projectName}`);
  console.log(`出力: ${outDisplay}`);
  console.log(`URL: /spec/ （jskim dev ${projectName} で確認）`);

  return {
    outDir: result.outDir,
    projectName,
  };
}

/**
 * companion dist entry の既定相対パス（リポジトリ開発用のヒント）。
 * public API では使わず、test が明示 modulePath を渡す。
 */
function defaultCompanionDistEntry(repoRoot) {
  return path.join(repoRoot, 'jskim-screen-spec', 'dist', 'index.js');
}

module.exports = {
  runSpecBuildCommand,
  defaultCompanionDistEntry,
};
