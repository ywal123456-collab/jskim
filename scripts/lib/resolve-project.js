'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { mergeConfig } = require('./merge-config');

/**
 * 読み込んだ設定から名前付きプロジェクトを解決・検証します。
 *
 * @param {object} options
 * @param {object} options.config
 * @param {string} options.workspaceRoot
 * @param {string|undefined} options.projectName
 * @param {string} [options.commandName='build']
 * @param {string} [options.usageLine] プロジェクト名欠落時の使用方法行
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

  const merged = mergeConfig(config.defaults || {}, projectConfig);

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

  if (!Array.isArray(merged.render) || merged.render.length === 0) {
    throw new Error(
      `[JSKim] プロジェクト "${name}" の render 設定が無い、または空です。\n` +
        `jskim.config.js の defaults.render または projects.${name}.render を定義してください。`
    );
  }

  for (let i = 0; i < merged.render.length; i += 1) {
    const rule = merged.render[i];
    if (!rule || typeof rule !== 'object') {
      throw new Error(
        `[JSKim] プロジェクト "${name}" の render[${i}] が不正です。\n` +
          `原因: 各 render ルールはオブジェクトである必要があります。`
      );
    }
    if (!rule.from || String(rule.from).trim() === '') {
      throw new Error(
        `[JSKim] プロジェクト "${name}" の render[${i}].from が不正です。\n` +
          `原因: from は必須です（sourceDir 基準）。`
      );
    }
    if (!Array.isArray(rule.include) || rule.include.length === 0) {
      throw new Error(
        `[JSKim] プロジェクト "${name}" の render[${i}].include が不正です。\n` +
          `原因: include は空でない glob パターン配列である必要があります。`
      );
    }
    if (!rule.extension || String(rule.extension).trim() === '') {
      throw new Error(
        `[JSKim] プロジェクト "${name}" の render[${i}].extension が不正です。\n` +
          `原因: extension は必須です（例: ".html"）。`
      );
    }
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
    render: merged.render,
    templates: merged.templates,
    copy: merged.copy,
    build: merged.build,
    watch: merged.watch,
    serve: merged.serve,
    dev: merged.dev,
    workspaceRoot,
  };
}

function validateWatchConfig(watch, projectName) {
  const debounce = watch && watch.debounce;

  if (
    typeof debounce !== 'number' ||
    !Number.isFinite(debounce) ||
    debounce < 0
  ) {
    throw new Error(
      `[JSKim] 設定値が不正です: watch.debounce\n` +
        `プロジェクト: ${projectName}\n` +
        `0以上の有限な数値を指定してください。\n` +
        `受け取った値: ${String(debounce)}`
    );
  }
}

function validateServeConfig(serve, projectName) {
  const host = serve && serve.host;
  const port = serve && serve.port;

  if (typeof host !== 'string' || host.trim() === '') {
    throw new Error(
      `[JSKim] 設定値が不正です: serve.host\n` +
        `プロジェクト: ${projectName}\n` +
        `空でない文字列を指定してください。\n` +
        `受け取った値: ${String(host)}`
    );
  }

  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      `[JSKim] 設定値が不正です: serve.port\n` +
        `プロジェクト: ${projectName}\n` +
        `1から65535までの整数を指定してください。\n` +
        `受け取った値: ${String(port)}`
    );
  }
}

function validateDevConfig(dev, projectName) {
  const liveReload = dev && dev.liveReload;

  if (typeof liveReload !== 'boolean') {
    throw new Error(
      `[JSKim] 設定値が不正です: dev.liveReload\n` +
        `プロジェクト: ${projectName}\n` +
        `boolean を指定してください。\n` +
        `受け取った値: ${String(liveReload)}`
    );
  }
}

module.exports = {
  resolveProject,
};
