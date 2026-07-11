'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 解決済みプロジェクト設定から監視ディレクトリを計算します。
 * files mode: files[].from / templates[]
 * legacy mode: render[].from / templates[] / copy[].from
 * outputDir / dist / node_modules は監視しません。
 *
 * @param {object} project
 * @returns {{ absolutePaths: string[], displayPaths: string[] }}
 */
function resolveWatchPaths(project) {
  const {
    name,
    sourceDir,
    outputDir,
    workspaceRoot,
    render,
    templates,
    copy,
    files,
    pipelineMode,
  } = project;

  const absolutePaths = [];
  const seen = new Set();

  function addCandidate(absPath) {
    const resolved = path.resolve(absPath);
    const key =
      process.platform === 'win32' ? resolved.toLowerCase() : resolved;

    if (seen.has(key)) {
      return;
    }

    if (isForbiddenWatchPath(resolved, outputDir, workspaceRoot)) {
      return;
    }

    if (!fs.existsSync(resolved)) {
      return;
    }

    seen.add(key);
    absolutePaths.push(resolved);
  }

  if (pipelineMode === 'files') {
    for (const rule of Array.isArray(files) ? files : []) {
      if (rule && rule.from) {
        addCandidate(path.join(sourceDir, rule.from));
      }
    }
  } else {
    for (const rule of Array.isArray(render) ? render : []) {
      if (rule && rule.from) {
        addCandidate(path.join(sourceDir, rule.from));
      }
    }

    for (const rule of Array.isArray(copy) ? copy : []) {
      if (rule && rule.from) {
        addCandidate(path.join(sourceDir, rule.from));
      }
    }
  }

  for (const rel of Array.isArray(templates) ? templates : []) {
    if (rel) {
      addCandidate(path.join(sourceDir, rel));
    }
  }

  if (absolutePaths.length === 0) {
    throw new Error(
      `[JSKim] プロジェクト "${name}" の監視パスがありません。\n` +
        `原因: files[].from / render[].from / templates[] / copy[].from のいずれも既存パスに解決できませんでした。\n` +
        `sourceDir: ${sourceDir}`
    );
  }

  absolutePaths.sort(comparePaths);

  const displayPaths = absolutePaths.map((abs) =>
    toDisplayPath(abs, workspaceRoot)
  );

  return { absolutePaths, displayPaths };
}

function isForbiddenWatchPath(candidate, outputDir, workspaceRoot) {
  const resolved = path.resolve(candidate);
  const out = path.resolve(outputDir);
  const root = path.resolve(workspaceRoot);
  const distRoot = path.join(root, 'dist');

  if (samePath(resolved, out) || isInsideOrSame(out, resolved)) {
    return true;
  }

  if (samePath(resolved, distRoot) || isInsideOrSame(distRoot, resolved)) {
    return true;
  }

  const parts = resolved.split(path.sep);
  if (parts.some((part) => part.toLowerCase() === 'node_modules')) {
    return true;
  }

  return false;
}

function toDisplayPath(abs, workspaceRoot) {
  const rel = path.relative(workspaceRoot, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return abs.split(path.sep).join('/');
  }
  return rel.split(path.sep).join('/');
}

function samePath(a, b) {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  if (process.platform === 'win32') {
    return na.toLowerCase() === nb.toLowerCase();
  }
  return na === nb;
}

function isInsideOrSame(parent, child) {
  if (samePath(parent, child)) {
    return true;
  }
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function comparePaths(a, b) {
  const left = process.platform === 'win32' ? a.toLowerCase() : a;
  const right = process.platform === 'win32' ? b.toLowerCase() : b;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

module.exports = {
  resolveWatchPaths,
};
