'use strict';

const { buildProject } = require('../lib/build-project');

/**
 * build コマンドを実行します。
 * @param {object} options
 * @param {string|undefined} options.projectName
 * @param {string} [options.workspaceRoot]
 * @param {string} [options.usageLine]
 * @returns {Promise<object>}
 */
async function runBuildCommand(options = {}) {
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const usageLine =
    options.usageLine || 'npm run build -- <project-name>';

  return buildProject(options.projectName, {
    workspaceRoot,
    commandName: 'build',
    usageLine,
    logTitle: 'ビルドが完了しました',
    includeOutput: true,
  });
}

module.exports = {
  runBuildCommand,
};
