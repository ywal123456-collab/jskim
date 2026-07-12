'use strict';

const path = require('node:path');
const fs = require('node:fs');
const fse = require('fs-extra');
const fg = require('fast-glob');
const { computeRootPath } = require('./render-pages');
const { toDisplayPath } = require('./to-display-path');
const {
  formatRenderError,
  formatCollisionError,
  formatPathOutsideError,
  formatIoError,
} = require('./format-diagnostic');

const RESERVED_CONTEXT_KEYS = new Set(['rootPath']);

/**
 * files pipeline を実行します。
 * *.njk → render（末尾 .njk のみ削除）
 * それ以外 → byte copy
 *
 * @param {object} options
 * @param {import('nunjucks').Environment} options.env
 * @param {object} options.project
 * @returns {Promise<{ renderedCount: number, copiedCount: number, files: string[] }>}
 */
async function processFiles({ env, project }) {
  const { name, sourceDir, outputDir, files, templates, data } = project;
  const rules = Array.isArray(files) ? files : [];
  const templateRoots = resolveTemplateRoots(sourceDir, templates);

  assertNoReservedDataCollision(data, name);

  /** @type {Map<string, { sourceFile: string, outputFile: string, kind: string, relative: string, ruleIndex: number }>} */
  const planned = new Map();

  for (let i = 0; i < rules.length; i += 1) {
    const rule = normalizeFilesRule(rules[i], name, i);
    const fromDir = path.resolve(sourceDir, rule.from);
    const toDir = path.resolve(outputDir, rule.to);

    assertInside(sourceDir, fromDir, name, `files[${i}].from`, 'sourceDir', project.workspaceRoot);
    assertInside(outputDir, toDir, name, `files[${i}].to`, 'outputDir', project.workspaceRoot);

    if (!(await fse.pathExists(fromDir))) {
      throw new Error(
        `[JSKim] プロジェクト "${name}" の files[${i}].from が存在しません。\n` +
          `設定キー: files[${i}].from\n` +
          `設定値: ${rule.from}\n` +
          `パス: ${toDisplayPath(fromDir, project.workspaceRoot)}`
      );
    }

    const matches = await fg(rule.include, {
      cwd: fromDir,
      onlyFiles: true,
      dot: false,
      absolute: false,
      ignore: rule.exclude,
    });
    matches.sort();

    for (const relativeMatch of matches) {
      const normalizedRel = relativeMatch.split(path.sep).join('/');
      const sourceFile = path.join(fromDir, relativeMatch);

      if (isInsideAny(templateRoots, sourceFile)) {
        continue;
      }

      const isNjk = normalizedRel.endsWith('.njk');
      const outRel = isNjk
        ? stripTrailingNjk(normalizedRel)
        : normalizedRel;
      const outputFile = path.resolve(toDir, outRel.split('/').join(path.sep));

      assertInside(
        outputDir,
        outputFile,
        name,
        `files[${i}] output`,
        'outputDir',
        project.workspaceRoot
      );

      const collisionKey =
        process.platform === 'win32'
          ? outputFile.toLowerCase()
          : outputFile;

      if (planned.has(collisionKey)) {
        const previous = planned.get(collisionKey);
        throw new Error(
          formatCollisionError({
            projectName: name,
            outputFile,
            sourceFileA: previous.sourceFile,
            sourceFileB: sourceFile,
            ruleIndexA: previous.ruleIndex,
            ruleIndexB: i,
            workspaceRoot: project.workspaceRoot,
          })
        );
      }

      planned.set(collisionKey, {
        sourceFile,
        outputFile,
        kind: isNjk ? 'render' : 'copy',
        relative: normalizedRel,
        ruleIndex: i,
      });
    }
  }

  let renderedCount = 0;
  let copiedCount = 0;
  const outputFiles = [];

  for (const item of planned.values()) {
    await fse.ensureDir(path.dirname(item.outputFile));

    if (item.kind === 'copy') {
      try {
        await fse.copy(item.sourceFile, item.outputFile, { overwrite: true });
      } catch (err) {
        throw new Error(
          formatIoError({
            projectName: name,
            actionLabel: 'ファイルコピー',
            targetFile: item.sourceFile,
            workspaceRoot: project.workspaceRoot,
            err,
          }) +
            `\n出力: ${toDisplayPath(item.outputFile, project.workspaceRoot)}`
        );
      }
      copiedCount += 1;
      outputFiles.push(item.outputFile);
      continue;
    }

    const templatePath = path
      .relative(sourceDir, item.sourceFile)
      .split(path.sep)
      .join('/');
    const rootPath = computeRootPath(item.outputFile, outputDir);
    const context = buildRenderContext(data, rootPath);

    let text;
    try {
      text = env.render(templatePath, context);
    } catch (err) {
      throw new Error(
        formatRenderError({
          projectName: name,
          sourceFile: item.sourceFile,
          templatePath,
          workspaceRoot: project.workspaceRoot,
          err,
        })
      );
    }

    try {
      await fse.writeFile(item.outputFile, text, 'utf8');
    } catch (err) {
      throw new Error(
        formatIoError({
          projectName: name,
          actionLabel: 'レンダリング結果の書き込み',
          targetFile: item.outputFile,
          workspaceRoot: project.workspaceRoot,
          err,
        })
      );
    }
    renderedCount += 1;
    outputFiles.push(item.outputFile);
  }

  return { renderedCount, copiedCount, files: outputFiles };
}

function normalizeFilesRule(rule, projectName, index) {
  if (!rule || typeof rule !== 'object') {
    throw new Error(
      `[JSKim] プロジェクト "${projectName}" の files[${index}] が不正です。\n` +
        `原因: 各 files ルールはオブジェクトである必要があります。`
    );
  }
  if (!rule.from || String(rule.from).trim() === '') {
    throw new Error(
      `[JSKim] プロジェクト "${projectName}" の files[${index}].from が不正です。\n` +
        `原因: from は必須です（sourceDir 基準）。`
    );
  }

  const include = Array.isArray(rule.include) ? rule.include : ['**/*'];
  if (include.length === 0) {
    throw new Error(
      `[JSKim] プロジェクト "${projectName}" の files[${index}].include が不正です。\n` +
        `原因: include は空でない glob 配列である必要があります。`
    );
  }

  const exclude = Array.isArray(rule.exclude) ? rule.exclude : [];

  return {
    from: String(rule.from).trim(),
    to: rule.to == null ? '' : String(rule.to),
    include: [...include],
    exclude: [...exclude],
  };
}

function stripTrailingNjk(relativePath) {
  if (relativePath.endsWith('.njk')) {
    return relativePath.slice(0, -4);
  }
  return relativePath;
}

function resolveTemplateRoots(sourceDir, templates) {
  const roots = [];
  for (const rel of Array.isArray(templates) ? templates : []) {
    if (!rel) {
      continue;
    }
    const abs = path.resolve(sourceDir, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      roots.push(abs);
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

function assertInside(root, candidate, projectName, label, rootKind, workspaceRoot) {
  if (!isInsideOrSame(root, candidate)) {
    throw new Error(
      formatPathOutsideError({
        projectName,
        label,
        root,
        candidate,
        rootKind,
        workspaceRoot,
      })
    );
  }
}

function assertNoReservedDataCollision(data, projectName) {
  const keys = Object.keys(data || {});
  for (const key of keys) {
    if (RESERVED_CONTEXT_KEYS.has(key)) {
      throw new Error(
        `[JSKim] data のキーが予約語と衝突しています: ${key}\n` +
          `プロジェクト: ${projectName}\n` +
          `設定キー: data.${key}\n` +
          `予約キー: ${[...RESERVED_CONTEXT_KEYS].join(', ')}`
      );
    }
  }
}

function buildRenderContext(data, rootPath) {
  return {
    ...(data && typeof data === 'object' ? data : {}),
    rootPath,
  };
}

module.exports = {
  processFiles,
  stripTrailingNjk,
  RESERVED_CONTEXT_KEYS,
};
