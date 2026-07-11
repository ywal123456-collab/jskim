'use strict';

const path = require('node:path');
const fs = require('node:fs');
const fse = require('fs-extra');

/**
 * ビルド前に outputDir だけを安全に削除します。
 *
 * 次のパスは削除しません:
 * - ファイルシステムルート
 * - ワークスペースルート
 * - sourceDir
 * - sourceDir の祖先
 * - 空 / 不正なパス
 *
 * @param {object} options
 * @param {string} options.outputDir
 * @param {string} options.sourceDir
 * @param {string} options.workspaceRoot
 * @param {string} options.projectName
 */
async function cleanOutput({
  outputDir,
  sourceDir,
  workspaceRoot,
  projectName,
}) {
  const resolvedOutput = path.resolve(outputDir);
  const resolvedSource = path.resolve(sourceDir);
  const resolvedWorkspace = path.resolve(workspaceRoot);

  assertSafeToClean({
    outputDir: resolvedOutput,
    sourceDir: resolvedSource,
    workspaceRoot: resolvedWorkspace,
    projectName,
  });

  if (fs.existsSync(resolvedOutput)) {
    await fse.remove(resolvedOutput);
  }
}

function assertSafeToClean({
  outputDir,
  sourceDir,
  workspaceRoot,
  projectName,
}) {
  if (!outputDir || String(outputDir).trim() === '') {
    throw new Error(
      `[JSKim] クリーンを拒否しました: outputDir が空です。\n` +
        `プロジェクト: ${projectName}`
    );
  }

  const parsed = path.parse(outputDir);
  // ファイルシステムルート（例: C:\ や /）
  if (outputDir === parsed.root || outputDir === path.sep) {
    throw new Error(
      `[JSKim] クリーンを拒否しました: outputDir がファイルシステムルートです。\n` +
        `プロジェクト: ${projectName}\n` +
        `パス: ${outputDir}`
    );
  }

  if (samePath(outputDir, workspaceRoot)) {
    throw new Error(
      `[JSKim] クリーンを拒否しました: outputDir がワークスペースルートです。\n` +
        `プロジェクト: ${projectName}\n` +
        `パス: ${outputDir}`
    );
  }

  if (samePath(outputDir, sourceDir)) {
    throw new Error(
      `[JSKim] クリーンを拒否しました: outputDir が sourceDir と同じです。\n` +
        `プロジェクト: ${projectName}\n` +
        `パス: ${outputDir}`
    );
  }

  if (isAncestorPath(outputDir, sourceDir)) {
    throw new Error(
      `[JSKim] クリーンを拒否しました: outputDir が sourceDir の祖先です。\n` +
        `プロジェクト: ${projectName}\n` +
        `outputDir: ${outputDir}\n` +
        `sourceDir: ${sourceDir}`
    );
  }
}

function samePath(a, b) {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  if (process.platform === 'win32') {
    return na.toLowerCase() === nb.toLowerCase();
  }
  return na === nb;
}

/**
 * ancestor が descendant の厳密な祖先ディレクトリなら true。
 */
function isAncestorPath(ancestor, descendant) {
  const a = path.resolve(ancestor);
  const d = path.resolve(descendant);
  if (samePath(a, d)) {
    return false;
  }
  const rel = path.relative(a, d);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = {
  cleanOutput,
  assertSafeToClean,
};
