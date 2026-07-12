'use strict';

const { loadConfig } = require('../lib/load-config');
const { resolveProject } = require('../lib/resolve-project');
const { buildProject, runBuild } = require('../lib/build-project');
const { listProjectNames, selectProjectName } = require('../lib/select-project-name');
const {
  assertCompatibleOutputDirs,
} = require('../lib/assert-output-dirs-compatible');

/**
 * build コマンドを実行します。
 * @param {object} options
 * @param {string|undefined} options.projectName
 * @param {boolean} [options.all]
 * @param {string} [options.workspaceRoot]
 * @param {string} [options.usageLine]
 * @returns {Promise<object>}
 */
async function runBuildCommand(options = {}) {
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const usageLine =
    options.usageLine || 'jskim build [<project>]';

  if (options.all) {
    return runBuildAllProjects({
      workspaceRoot,
      usageLine,
    });
  }

  const { config } = loadConfig(workspaceRoot);
  const projectName = selectProjectName({
    config,
    projectName: options.projectName,
    commandName: 'build',
    usageLine,
  });

  return buildProject(projectName, {
    workspaceRoot,
    commandName: 'build',
    usageLine,
    logTitle: 'ビルドが完了しました',
    includeOutput: true,
  });
}

/**
 * @param {object} options
 * @returns {Promise<object>}
 */
async function runBuildAllProjects({ workspaceRoot, usageLine }) {
  const { config } = loadConfig(workspaceRoot);
  const names = listProjectNames(config);

  if (names.length === 0) {
    throw new Error(
      `[JSKim] 設定にprojectがありません。\n` +
        `jskim.config.js の projects に1件以上定義してください。\n` +
        `使用方法: jskim build --all`
    );
  }

  /** @type {object[]} */
  const resolved = [];
  /** @type {Array<{ name: string, stage: string, message: string }>} */
  const failures = [];
  /** @type {string[]} */
  const successes = [];

  for (const name of names) {
    try {
      const project = resolveProject({
        config,
        workspaceRoot,
        projectName: name,
        commandName: 'build',
        usageLine,
      });
      resolved.push(project);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      failures.push({ name, stage: 'resolve', message });
      console.error(message);
    }
  }

  if (resolved.length > 0) {
    assertCompatibleOutputDirs(resolved);
  }

  for (const project of resolved) {
    console.log(`[JSKim] project "${project.name}" のbuildを開始します`);
    try {
      await runBuild(project, {
        logTitle: 'ビルドが完了しました',
        includeOutput: true,
      });
      successes.push(project.name);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      failures.push({ name: project.name, stage: 'build', message });
      console.error(message);
    }
  }

  const total = names.length;
  const failCount = failures.length;
  const successCount = successes.length;

  console.log('');
  console.log(
    `[JSKim] ${total}件中${successCount}件のprojectのbuildが完了しました`
  );
  if (failCount > 0) {
    console.log(`[JSKim] 失敗: ${failCount}件`);
    for (const item of failures) {
      console.log(`- ${item.name} (${item.stage})`);
    }
    const error = new Error(
      `[JSKim] build --all が失敗しました（成功 ${successCount} / 失敗 ${failCount} / 全 ${total}）。`
    );
    throw error;
  }

  return {
    total,
    successCount,
    failCount,
    successes,
    failures,
  };
}

module.exports = {
  runBuildCommand,
  runBuildAllProjects,
};
