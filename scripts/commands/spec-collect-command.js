'use strict';

const path = require('node:path');
const { loadConfig } = require('../lib/load-config');
const { selectProjectName } = require('../lib/select-project-name');
const { resolveProject } = require('../lib/resolve-project');
const { resolveScreenSpecModule } = require('../lib/resolve-screen-spec-module');
const { runScreenSpecCollect } = require('../lib/run-screen-spec-collect');
const { toDisplayPath } = require('./path-display');

/**
 * jskim spec collect を実行します。
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

  const collectResult = await runScreenSpecCollect({
    project,
    workspaceRoot,
    projectName,
    collectScreenSpecProject,
    log: true,
  });

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
  if (typeof collectResult.stylesheets === 'number') {
    console.log(`stylesheets: ${collectResult.stylesheets}`);
  }
  if (typeof collectResult.resources === 'number') {
    console.log(`resources: ${collectResult.resources}`);
  }
  if (typeof collectResult.resourcesReused === 'number') {
    console.log(`resources reused: ${collectResult.resourcesReused}`);
  }
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
      projectName +
      ' または jskim spec dev ' +
      projectName
  );

  return collectResult;
}

module.exports = {
  runSpecCollectCommand,
};
