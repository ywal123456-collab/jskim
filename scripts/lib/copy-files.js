'use strict';

const path = require('node:path');
const fse = require('fs-extra');
const fg = require('fast-glob');

/**
 * copy ルールに従って静的ファイルをコピーします。
 * copy.from が無い場合は警告して続行します。
 *
 * @param {object} options
 * @param {object} options.project
 * @returns {Promise<{ copiedCount: number, files: string[] }>}
 */
async function copyFiles({ project }) {
  const { name, sourceDir, outputDir, copy } = project;
  const rules = Array.isArray(copy) ? copy : [];
  let copiedCount = 0;
  const files = [];

  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];

    if (!rule || typeof rule !== 'object') {
      throw new Error(
        `[JSKim] プロジェクト "${name}" の copy[${i}] が不正です。\n` +
          `原因: 各 copy ルールは from/to を持つオブジェクトである必要があります。`
      );
    }

    if (!rule.from || String(rule.from).trim() === '') {
      throw new Error(
        `[JSKim] プロジェクト "${name}" の copy[${i}].from が不正です。\n` +
          `原因: from は必須です（sourceDir 基準）。`
      );
    }

    const fromDir = path.resolve(sourceDir, rule.from);
    const toDir = path.resolve(outputDir, rule.to || '');

    if (!(await fse.pathExists(fromDir))) {
      console.warn(
        `[JSKim] 警告: copy[${i}].from が存在しないためスキップします。\n` +
          `  プロジェクト: ${name}\n` +
          `  パス: ${fromDir}\n` +
          `  設定: copy[${i}].from = ${rule.from}`
      );
      continue;
    }

    const stat = await fse.stat(fromDir);

    if (stat.isFile()) {
      try {
        await fse.ensureDir(path.dirname(toDir));
        await fse.copy(fromDir, toDir, { overwrite: true });
        copiedCount += 1;
        files.push(toDir);
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        throw new Error(
          `[JSKim] プロジェクト "${name}" のファイルコピーに失敗しました。\n` +
            `From: ${fromDir}\n` +
            `To: ${toDir}\n` +
            `原因: ${message}`
        );
      }
      continue;
    }

    if (!stat.isDirectory()) {
      console.warn(
        `[JSKim] 警告: copy[${i}].from はファイルでもディレクトリでもないためスキップします。\n` +
          `  プロジェクト: ${name}\n` +
          `  パス: ${fromDir}`
      );
      continue;
    }

    const matches = await fg('**/*', {
      cwd: fromDir,
      onlyFiles: true,
      dot: false,
      absolute: false,
    });

    matches.sort();

    for (const relativeMatch of matches) {
      const srcFile = path.join(fromDir, relativeMatch);
      const destFile = path.join(toDir, relativeMatch);

      try {
        await fse.ensureDir(path.dirname(destFile));
        await fse.copy(srcFile, destFile, { overwrite: true });
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        throw new Error(
          `[JSKim] プロジェクト "${name}" のアセットコピーに失敗しました。\n` +
            `From: ${srcFile}\n` +
            `To: ${destFile}\n` +
            `原因: ${message}`
        );
      }

      copiedCount += 1;
      files.push(destFile);
    }
  }

  return { copiedCount, files };
}

module.exports = {
  copyFiles,
};
