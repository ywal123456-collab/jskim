'use strict';

/**
 * config.projects のキーを定義順で返します。
 * @param {object} config
 * @returns {string[]}
 */
function listProjectNames(config) {
  const projects = config && config.projects;
  if (!projects || typeof projects !== 'object') {
    return [];
  }
  return Object.keys(projects);
}

/**
 * positional project が無い場合の自動選択、または明示名を返します。
 *
 * @param {object} options
 * @param {object} options.config
 * @param {string|undefined} options.projectName
 * @param {string} [options.commandName]
 * @param {string} [options.usageLine]
 * @returns {string}
 */
function selectProjectName({
  config,
  projectName,
  commandName = 'build',
  usageLine,
}) {
  const names = listProjectNames(config);
  const usage =
    usageLine || `jskim ${commandName} [<project>]`;

  if (projectName && String(projectName).trim() !== '') {
    return String(projectName).trim();
  }

  if (names.length === 0) {
    throw new Error(
      `[JSKim] 設定にprojectがありません。\n` +
        `jskim.config.js の projects に1件以上定義してください。\n` +
        `使用方法: ${usage}`
    );
  }

  if (names.length === 1) {
    return names[0];
  }

  const list = names.map((name) => `- ${name}`).join('\n');
  throw new Error(
    `[JSKim] projectを指定してください。\n` +
      `使用方法: ${usage}\n\n` +
      `利用可能なproject:\n` +
      list
  );
}

module.exports = {
  listProjectNames,
  selectProjectName,
};
