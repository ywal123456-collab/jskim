'use strict';

const { toDisplayPath } = require('./to-display-path');

/**
 * Error から短い原因メッセージを取り出します（stack は含めません）。
 * @param {unknown} err
 * @returns {string}
 */
function getCauseMessage(err) {
  if (!err) {
    return String(err);
  }
  if (typeof err === 'string') {
    return err;
  }
  if (err && typeof err.message === 'string' && err.message.trim() !== '') {
    return err.message;
  }
  return String(err);
}

/**
 * Nunjucks が lineno / colno を提供する場合だけ位置を返します。
 * message 本文の正規表現解析は行いません。
 *
 * @param {unknown} err
 * @returns {{ line?: number, column?: number }}
 */
function readNunjucksLocation(err) {
  if (!err || typeof err !== 'object') {
    return {};
  }

  const lineno = err.lineno;
  const colno = err.colno;
  const result = {};

  if (Number.isInteger(lineno) && lineno > 0) {
    result.line = lineno;
  }
  if (Number.isInteger(colno) && colno > 0) {
    result.column = colno;
  }

  return result;
}

/**
 * Nunjucks レンダリング失敗の診断メッセージを組み立てます。
 *
 * @param {object} options
 * @param {string} options.projectName
 * @param {string} options.sourceFile
 * @param {string} options.templatePath
 * @param {string} [options.workspaceRoot]
 * @param {unknown} options.err
 * @returns {string}
 */
function formatRenderError(options) {
  const {
    projectName,
    sourceFile,
    templatePath,
    workspaceRoot,
    err,
  } = options;

  const sourceDisplay = toDisplayPath(sourceFile, workspaceRoot);
  const location = readNunjucksLocation(err);
  const cause = getCauseMessage(err);

  const lines = [
    `[JSKim] プロジェクト "${projectName}" の Nunjucks レンダリングに失敗しました。`,
    `ソース: ${sourceDisplay}`,
    `テンプレート: ${templatePath}`,
  ];

  if (location.line != null) {
    lines.push(`行: ${location.line}`);
  }
  if (location.column != null) {
    lines.push(`列: ${location.column}`);
  }

  lines.push(`原因: ${cause}`);
  lines.push('テンプレート構文または参照先（extends / include）を確認してください。');

  return lines.join('\n');
}

/**
 * 出力パス衝突の診断メッセージを組み立てます。
 *
 * @param {object} options
 * @param {string} options.projectName
 * @param {string} options.outputFile
 * @param {string} options.sourceFileA
 * @param {string} options.sourceFileB
 * @param {number} [options.ruleIndexA]
 * @param {number} [options.ruleIndexB]
 * @param {string} [options.workspaceRoot]
 * @returns {string}
 */
function formatCollisionError(options) {
  const {
    projectName,
    outputFile,
    sourceFileA,
    sourceFileB,
    ruleIndexA,
    ruleIndexB,
    workspaceRoot,
  } = options;

  const lines = [
    `[JSKim] 出力パスが衝突しています。`,
    `プロジェクト: ${projectName}`,
    `出力: ${toDisplayPath(outputFile, workspaceRoot)}`,
    formatCollisionSource('ソース1', sourceFileA, ruleIndexA, workspaceRoot),
    formatCollisionSource('ソース2', sourceFileB, ruleIndexB, workspaceRoot),
    '同じ出力になるソースを分けるか、どちらかを除外してください。',
  ];

  return lines.join('\n');
}

function formatCollisionSource(label, sourceFile, ruleIndex, workspaceRoot) {
  const display = toDisplayPath(sourceFile, workspaceRoot);
  if (Number.isInteger(ruleIndex) && ruleIndex >= 0) {
    return `${label}: ${display} (files[${ruleIndex}])`;
  }
  return `${label}: ${display}`;
}

/**
 * sourceDir / outputDir 外へのパス逸脱メッセージを組み立てます。
 *
 * @param {object} options
 * @param {string} options.projectName
 * @param {string} options.label
 * @param {string} options.root
 * @param {string} options.candidate
 * @param {'sourceDir'|'outputDir'|string} [options.rootKind]
 * @param {string} [options.workspaceRoot]
 * @returns {string}
 */
function formatPathOutsideError(options) {
  const {
    projectName,
    label,
    root,
    candidate,
    rootKind,
    workspaceRoot,
  } = options;

  const kindLabel =
    rootKind === 'sourceDir'
      ? 'sourceDir'
      : rootKind === 'outputDir'
        ? 'outputDir'
        : '許可ルート';

  return [
    `[JSKim] プロジェクト "${projectName}" の ${label} が許可範囲外です。`,
    `種別: ${kindLabel} の外への参照`,
    `ルート: ${toDisplayPath(root, workspaceRoot)}`,
    `対象: ${toDisplayPath(candidate, workspaceRoot)}`,
    '相対パスが sourceDir / outputDir 内に収まるように設定してください。',
  ].join('\n');
}

/**
 * 設定バリデーション向けの共通ヘッダー行を組み立てます。
 *
 * @param {object} options
 * @param {string} options.projectName
 * @param {string} options.configKey
 * @param {string} [options.detail]
 * @param {string} [options.received]
 * @param {string} [options.hint]
 * @returns {string}
 */
function formatConfigValidationError(options) {
  const { projectName, configKey, detail, received, hint } = options;
  const lines = [
    `[JSKim] 設定値が不正です: ${configKey}`,
    `プロジェクト: ${projectName}`,
    `設定キー: projects.${projectName} または defaults の ${configKey}`,
  ];

  if (detail) {
    lines.push(detail);
  }
  if (received !== undefined) {
    lines.push(`受け取った値: ${received}`);
  }
  if (hint) {
    lines.push(hint);
  }

  return lines.join('\n');
}

/**
 * 書き込み失敗などの I/O エラーメッセージを組み立てます。
 *
 * @param {object} options
 * @param {string} options.projectName
 * @param {string} options.actionLabel
 * @param {string} options.targetFile
 * @param {string} [options.workspaceRoot]
 * @param {unknown} options.err
 * @returns {string}
 */
function formatIoError(options) {
  const { projectName, actionLabel, targetFile, workspaceRoot, err } = options;
  return [
    `[JSKim] プロジェクト "${projectName}" の${actionLabel}に失敗しました。`,
    `対象: ${toDisplayPath(targetFile, workspaceRoot)}`,
    `原因: ${getCauseMessage(err)}`,
  ].join('\n');
}

module.exports = {
  getCauseMessage,
  readNunjucksLocation,
  formatRenderError,
  formatCollisionError,
  formatPathOutsideError,
  formatConfigValidationError,
  formatIoError,
};
