'use strict';

const path = require('node:path');
const fse = require('fs-extra');
const fg = require('fast-glob');

/**
 * 出力ファイルのディレクトリから outputDir までの相対パスとして rootPath を計算します。
 * HTML 用に常に `/` 区切りを使います。
 *
 * @param {string} outputFilePath HTML ファイルの絶対パス
 * @param {string} outputDir 出力ルートの絶対パス
 * @returns {string} "./" | "../" | "../../" | ...
 */
function computeRootPath(outputFilePath, outputDir) {
  const outFileDir = path.dirname(path.resolve(outputFilePath));
  const outRoot = path.resolve(outputDir);
  let relative = path.relative(outFileDir, outRoot);

  if (!relative || relative === '') {
    return './';
  }

  relative = relative.split(path.sep).join('/');

  if (!relative.endsWith('/')) {
    relative += '/';
  }

  return relative;
}

/**
 * render ルールに従ってページをレンダリングします。
 *
 * @param {object} options
 * @param {import('nunjucks').Environment} options.env
 * @param {object} options.project 解決済みプロジェクト
 * @returns {Promise<{ renderedCount: number, files: string[] }>}
 */
async function renderPages({ env, project }) {
  const { name, sourceDir, outputDir, render } = project;
  let renderedCount = 0;
  const files = [];

  for (let i = 0; i < render.length; i += 1) {
    const rule = render[i];
    const fromDir = path.resolve(sourceDir, rule.from);
    const toDir = path.resolve(outputDir, rule.to || '');
    const extension = rule.extension.startsWith('.')
      ? rule.extension
      : `.${rule.extension}`;

    if (!(await fse.pathExists(fromDir))) {
      throw new Error(
        `[JSKim] プロジェクト "${name}" の render[${i}].from が存在しません。\n` +
          `パス: ${fromDir}\n` +
          `設定: render[${i}].from = ${rule.from}`
      );
    }

    const matches = await fg(rule.include, {
      cwd: fromDir,
      onlyFiles: true,
      dot: false,
      absolute: false,
    });

    matches.sort();

    for (const relativeMatch of matches) {
      const sourceFile = path.join(fromDir, relativeMatch);
      const parsed = path.parse(relativeMatch);
      const outRelative = path.join(parsed.dir, `${parsed.name}${extension}`);
      const outputFile = path.join(toDir, outRelative);

      // Nunjucks loader 用に sourceDir からの相対パスへ
      const templatePath = path
        .relative(sourceDir, sourceFile)
        .split(path.sep)
        .join('/');

      const rootPath = computeRootPath(outputFile, outputDir);

      let html;
      try {
        html = env.render(templatePath, { rootPath });
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        throw new Error(
          `[JSKim] プロジェクト "${name}" の Nunjucks レンダリングに失敗しました。\n` +
            `ソース: ${sourceFile}\n` +
            `テンプレート: ${templatePath}\n` +
            `原因: ${message}`
        );
      }

      try {
        await fse.ensureDir(path.dirname(outputFile));
        await fse.writeFile(outputFile, html, 'utf8');
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        throw new Error(
          `[JSKim] プロジェクト "${name}" のレンダリング結果の書き込みに失敗しました。\n` +
            `出力: ${outputFile}\n` +
            `原因: ${message}`
        );
      }

      renderedCount += 1;
      files.push(outputFile);
    }
  }

  return { renderedCount, files };
}

module.exports = {
  renderPages,
  computeRootPath,
};
