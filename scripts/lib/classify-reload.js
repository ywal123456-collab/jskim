'use strict';

const path = require('node:path');
const fs = require('node:fs');

/**
 * rebuild 単位の watcher events から browser 更新方法を分類します。
 * 不確実な場合は必ず full reload にします。
 *
 * @param {object} options
 * @param {Array<{ event?: string, absolutePath?: string, file?: string }>} options.events
 * @param {string} options.sourceDir
 * @param {string[]} [options.templates]
 * @returns {'css'|'reload'}
 */
function classifyReload(options) {
  const events = Array.isArray(options.events) ? options.events : [];
  if (events.length === 0) {
    return 'reload';
  }

  const templateRoots = resolveTemplateRoots(
    options.sourceDir,
    options.templates
  );

  for (const item of events) {
    if (!item || typeof item !== 'object') {
      return 'reload';
    }

    const eventName = item.event;
    if (eventName !== 'change') {
      return 'reload';
    }

    const absolutePath = resolveEventAbsolutePath(item);
    if (!absolutePath) {
      return 'reload';
    }

    if (isInsideAny(templateRoots, absolutePath)) {
      return 'reload';
    }

    if (!isCssSourcePath(absolutePath)) {
      return 'reload';
    }
  }

  return 'css';
}

/**
 * @param {{ absolutePath?: string, file?: string }} item
 * @returns {string|null}
 */
function resolveEventAbsolutePath(item) {
  if (item.absolutePath && typeof item.absolutePath === 'string') {
    const abs = path.resolve(item.absolutePath);
    if (path.isAbsolute(abs)) {
      return abs;
    }
  }
  return null;
}

/**
 * 末尾が .css または .css.njk のときだけ true（大文字小文字は無視）。
 * @param {string} absolutePath
 * @returns {boolean}
 */
function isCssSourcePath(absolutePath) {
  const normalized = absolutePath.split(path.sep).join('/').toLowerCase();
  return normalized.endsWith('.css.njk') || normalized.endsWith('.css');
}

function resolveTemplateRoots(sourceDir, templates) {
  const roots = [];
  if (!sourceDir) {
    return roots;
  }
  for (const rel of Array.isArray(templates) ? templates : []) {
    if (!rel) {
      continue;
    }
    const abs = path.resolve(sourceDir, rel);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        roots.push(abs);
      }
    } catch {
      // 存在確認失敗は root として扱わない
    }
  }
  return roots;
}

function isInsideAny(roots, candidate) {
  for (const root of roots) {
    if (isInsideOrSame(root, candidate)) {
      return true;
    }
  }
  return false;
}

function isInsideOrSame(parent, child) {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  if (samePath(p, c)) {
    return true;
  }
  const rel = path.relative(p, c);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function samePath(a, b) {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  if (process.platform === 'win32') {
    return na.toLowerCase() === nb.toLowerCase();
  }
  return na === nb;
}

module.exports = {
  classifyReload,
  isCssSourcePath,
  resolveTemplateRoots,
};
