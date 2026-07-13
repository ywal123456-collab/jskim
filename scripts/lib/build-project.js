'use strict';

const path = require('node:path');
const { loadConfig } = require('./load-config');
const { resolveProject } = require('./resolve-project');
const { createNunjucksEnv } = require('./create-nunjucks-env');
const { cleanOutput } = require('./clean-output');
const { renderPages } = require('./render-pages');
const { copyFiles } = require('./copy-files');
const { processFiles } = require('./process-files');

/**
 * 設定を読み込み、プロジェクトを解決してフルビルドを実行します。
 *
 * @param {string|undefined} projectName
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function buildProject(projectName, options = {}) {
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const commandName = options.commandName || 'build';

  const { config } = loadConfig(workspaceRoot);
  const project = resolveProject({
    config,
    workspaceRoot,
    projectName,
    commandName,
    usageLine: options.usageLine,
  });

  return runBuild(project, options);
}

/**
 * 解決済みプロジェクトに対して clean → pipeline を実行します。
 *
 * @param {object} project
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function runBuild(project, options = {}) {
  const logTitle = options.logTitle || 'ビルドが完了しました';
  const includeOutput = options.includeOutput !== false;
  const shouldLog = options.log !== false;

  // Screen Spec collector など一時出力用。config ファイルは変更しない。
  if (options.outputDir) {
    project = {
      ...project,
      outputDir: path.resolve(options.outputDir),
    };
  }

  if (project.build.clean) {
    await cleanOutput({
      outputDir: project.outputDir,
      sourceDir: project.sourceDir,
      workspaceRoot: project.workspaceRoot,
      projectName: project.name,
    });
  }

  const env = createNunjucksEnv({
    sourceDir: project.sourceDir,
    templates: project.templates,
    nunjucks: project.nunjucks,
  });

  let renderedCount = 0;
  let copiedCount = 0;

  if (project.pipelineMode === 'files') {
    const result = await processFiles({
      env,
      project,
      preserveScreenSpecAttributes: options.preserveScreenSpecAttributes === true,
    });
    renderedCount = result.renderedCount;
    copiedCount = result.copiedCount;
  } else {
    const rendered = await renderPages({
      env,
      project,
      preserveScreenSpecAttributes: options.preserveScreenSpecAttributes === true,
    });
    const copied = await copyFiles({ project });
    renderedCount = rendered.renderedCount;
    copiedCount = copied.copiedCount;
  }

  const outputDisplay = path
    .relative(project.workspaceRoot, project.outputDir)
    .split(path.sep)
    .join('/');

  const result = {
    project,
    renderedCount,
    copiedCount,
    outputDisplay: outputDisplay || project.outputDir,
  };

  if (shouldLog) {
    printBuildResult(result, { logTitle, includeOutput });
  }

  return result;
}

function printBuildResult(result, options = {}) {
  const logTitle = options.logTitle || 'ビルドが完了しました';
  const includeOutput = options.includeOutput !== false;

  console.log(`[JSKim] ${logTitle}`);
  console.log(`プロジェクト: ${result.project.name}`);
  console.log(`レンダリングしたファイル数: ${result.renderedCount}`);
  console.log(`コピーしたファイル数: ${result.copiedCount}`);
  if (includeOutput) {
    console.log(`出力先: ${result.outputDisplay}`);
  }
}

module.exports = {
  buildProject,
  runBuild,
  printBuildResult,
};
