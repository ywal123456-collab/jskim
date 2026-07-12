'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { mergeConfig } = require('./merge-config');
const { formatConfigValidationError } = require('./format-diagnostic');

/**
 * 読み込んだ設定から名前付きプロジェクトを解決・検証します。
 *
 * @param {object} options
 * @param {object} options.config
 * @param {string} options.workspaceRoot
 * @param {string|undefined} options.projectName
 * @param {string} [options.commandName='build']
 * @param {string} [options.usageLine]
 * @returns {object} 解決済みプロジェクト
 */
function resolveProject({
  config,
  workspaceRoot,
  projectName,
  commandName = 'build',
  usageLine,
}) {
  if (!projectName || String(projectName).trim() === '') {
    const usage =
      usageLine || `npm run ${commandName} -- <project-name>`;
    throw new Error(
      `[JSKim] プロジェクト名を指定してください。\n` +
        `使用方法: ${usage}`
    );
  }

  const name = String(projectName).trim();
  const projects = config.projects || {};
  const projectConfig = projects[name];

  if (!projectConfig) {
    const available = Object.keys(projects);
    const list =
      available.length > 0 ? available.join(', ') : '(登録なし)';
    throw new Error(
      `[JSKim] 不明なプロジェクトです: ${name}\n` +
        `利用可能なプロジェクト: ${list}`
    );
  }

  const defaults = config.defaults || {};
  const merged = mergeConfig(defaults, projectConfig);

  if (!merged.sourceDir || String(merged.sourceDir).trim() === '') {
    throw new Error(
      `[JSKim] プロジェクト "${name}" に sourceDir がありません。\n` +
        `jskim.config.js の projects.${name}.sourceDir を設定してください。`
    );
  }

  if (!merged.outputDir || String(merged.outputDir).trim() === '') {
    throw new Error(
      `[JSKim] プロジェクト "${name}" に outputDir がありません。\n` +
        `jskim.config.js の projects.${name}.outputDir を設定してください。`
    );
  }

  const sourceDir = path.resolve(workspaceRoot, merged.sourceDir);
  const outputDir = path.resolve(workspaceRoot, merged.outputDir);

  if (!fs.existsSync(sourceDir)) {
    throw new Error(
      `[JSKim] プロジェクト "${name}" の sourceDir が存在しません。\n` +
        `パス: ${sourceDir}\n` +
        `設定: projects.${name}.sourceDir = ${merged.sourceDir}`
    );
  }

  if (!fs.statSync(sourceDir).isDirectory()) {
    throw new Error(
      `[JSKim] プロジェクト "${name}" の sourceDir はディレクトリではありません。\n` +
        `パス: ${sourceDir}`
    );
  }

  validateData(merged.data, name);
  validateNunjucks(merged.nunjucks, name);

  const hasFiles = Array.isArray(merged.files) && merged.files.length > 0;
  const hasRender = Array.isArray(merged.render) && merged.render.length > 0;
  const hasCopy = Array.isArray(merged.copy) && merged.copy.length > 0;

  if (hasFiles && (hasRender || hasCopy)) {
    const conflict = [];
    if (hasRender) {
      conflict.push('render');
    }
    if (hasCopy) {
      conflict.push('copy');
    }
    throw new Error(
      `[JSKim] files と ${conflict.join(' / ')} を同時に設定できません。\n` +
        `プロジェクト: ${name}\n` +
        `衝突: files と ${conflict.join(' / ')}\n` +
        `files mode を使う場合は render / copy を空にしてください。\n` +
        `legacy mode を使う場合は files を設定しないでください。`
    );
  }

  const pipelineMode = hasFiles ? 'files' : 'legacy';

  if (pipelineMode === 'files') {
    validateFilesRules(merged.files, name);
  } else {
    if (!hasRender) {
      throw new Error(
        `[JSKim] プロジェクト "${name}" の render 設定が無い、または空です。\n` +
          `jskim.config.js の defaults.render または projects.${name}.render を定義してください。\n` +
          `新しい files pipeline を使う場合は defaults.files を設定してください。`
      );
    }
    validateRenderRules(merged.render, name);
  }

  validateWatchConfig(merged.watch, name);
  validateServeConfig(merged.serve, name);
  validateDevConfig(merged.dev, name);

  return {
    name,
    sourceDir,
    outputDir,
    sourceDirConfig: merged.sourceDir,
    outputDirConfig: merged.outputDir,
    pipelineMode,
    render: merged.render,
    templates: merged.templates,
    copy: merged.copy,
    files: merged.files || [],
    data: merged.data,
    nunjucks: merged.nunjucks,
    build: merged.build,
    watch: merged.watch,
    serve: merged.serve,
    dev: merged.dev,
    workspaceRoot,
  };
}

function validateFilesRules(files, projectName) {
  for (let i = 0; i < files.length; i += 1) {
    const rule = files[i];
    if (!rule || typeof rule !== 'object') {
      throw new Error(
        `[JSKim] プロジェクト "${projectName}" の files[${i}] が不正です。\n` +
          `原因: 各 files ルールはオブジェクトである必要があります。`
      );
    }
    if (!rule.from || String(rule.from).trim() === '') {
      throw new Error(
        `[JSKim] プロジェクト "${projectName}" の files[${i}].from が不正です。\n` +
          `原因: from は必須です（sourceDir 基準）。`
      );
    }
    if (rule.include !== undefined) {
      if (!Array.isArray(rule.include) || rule.include.length === 0) {
        throw new Error(
          `[JSKim] プロジェクト "${projectName}" の files[${i}].include が不正です。\n` +
            `原因: include は空でない glob 配列である必要があります。`
        );
      }
    }
    if (rule.exclude !== undefined && !Array.isArray(rule.exclude)) {
      throw new Error(
        `[JSKim] プロジェクト "${projectName}" の files[${i}].exclude が不正です。\n` +
          `原因: exclude は配列である必要があります。`
      );
    }
  }
}

function validateRenderRules(render, projectName) {
  for (let i = 0; i < render.length; i += 1) {
    const rule = render[i];
    if (!rule || typeof rule !== 'object') {
      throw new Error(
        `[JSKim] プロジェクト "${projectName}" の render[${i}] が不正です。\n` +
          `原因: 各 render ルールはオブジェクトである必要があります。`
      );
    }
    if (!rule.from || String(rule.from).trim() === '') {
      throw new Error(
        `[JSKim] プロジェクト "${projectName}" の render[${i}].from が不正です。\n` +
          `原因: from は必須です（sourceDir 基準）。`
      );
    }
    if (!Array.isArray(rule.include) || rule.include.length === 0) {
      throw new Error(
        `[JSKim] プロジェクト "${projectName}" の render[${i}].include が不正です。\n` +
          `原因: include は空でない glob パターン配列である必要があります。`
      );
    }
    if (!rule.extension || String(rule.extension).trim() === '') {
      throw new Error(
        `[JSKim] プロジェクト "${projectName}" の render[${i}].extension が不正です。\n` +
          `原因: extension は必須です（例: ".html"）。`
      );
    }
  }
}

function validateData(data, projectName) {
  if (data == null) {
    return;
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      formatConfigValidationError({
        projectName,
        configKey: 'data',
        detail:
          'plain object を指定してください（null / array / primitive は不可）。',
        received: Array.isArray(data) ? 'array' : typeof data,
      })
    );
  }
}

function validateNunjucks(nunjucks, projectName) {
  if (nunjucks == null) {
    return;
  }
  if (typeof nunjucks !== 'object' || Array.isArray(nunjucks)) {
    throw new Error(
      formatConfigValidationError({
        projectName,
        configKey: 'nunjucks',
        detail: 'plain object を指定してください。',
        received: Array.isArray(nunjucks) ? 'array' : typeof nunjucks,
      })
    );
  }

  const filters = nunjucks.filters || {};
  if (typeof filters !== 'object' || Array.isArray(filters)) {
    throw new Error(
      formatConfigValidationError({
        projectName,
        configKey: 'nunjucks.filters',
        detail: 'plain object を指定してください。',
        received: Array.isArray(filters) ? 'array' : typeof filters,
      })
    );
  }
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value !== 'function') {
      throw new Error(
        formatConfigValidationError({
          projectName,
          configKey: `nunjucks.filters.${key}`,
          detail: 'filter は function である必要があります。',
          received: typeof value,
        })
      );
    }
  }

  const globals = nunjucks.globals || {};
  if (typeof globals !== 'object' || Array.isArray(globals)) {
    throw new Error(
      formatConfigValidationError({
        projectName,
        configKey: 'nunjucks.globals',
        detail: 'plain object を指定してください。',
        received: Array.isArray(globals) ? 'array' : typeof globals,
      })
    );
  }
}

function validateWatchConfig(watch, projectName) {
  const debounce = watch && watch.debounce;

  if (
    typeof debounce !== 'number' ||
    !Number.isFinite(debounce) ||
    debounce < 0
  ) {
    throw new Error(
      formatConfigValidationError({
        projectName,
        configKey: 'watch.debounce',
        detail: '0以上の有限な数値を指定してください。',
        received: String(debounce),
      })
    );
  }
}

function validateServeConfig(serve, projectName) {
  const host = serve && serve.host;
  const port = serve && serve.port;

  if (typeof host !== 'string' || host.trim() === '') {
    throw new Error(
      formatConfigValidationError({
        projectName,
        configKey: 'serve.host',
        detail: '空でない文字列を指定してください。',
        received: String(host),
      })
    );
  }

  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      formatConfigValidationError({
        projectName,
        configKey: 'serve.port',
        detail: '1から65535までの整数を指定してください。',
        received: String(port),
      })
    );
  }
}

function validateDevConfig(dev, projectName) {
  const liveReload = dev && dev.liveReload;

  if (typeof liveReload !== 'boolean') {
    throw new Error(
      formatConfigValidationError({
        projectName,
        configKey: 'dev.liveReload',
        detail: 'boolean を指定してください。',
        received: String(liveReload),
      })
    );
  }
}

module.exports = {
  resolveProject,
};
