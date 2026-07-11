'use strict';

const path = require('node:path');

const CONFIG_FILENAME = 'jskim.config.js';

/**
 * ワークスペースルートから jskim.config.js を読み込みます。
 * @param {string} workspaceRoot
 * @returns {object}
 */
function loadConfig(workspaceRoot) {
  const configPath = path.join(workspaceRoot, CONFIG_FILENAME);

  let config;
  try {
    // 同一プロセス内の再実行でも最新設定を読むためキャッシュを消す
    delete require.cache[require.resolve(configPath)];
    config = require(configPath);
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') {
      const missingConfig =
        typeof err.message === 'string' &&
        err.message.includes(CONFIG_FILENAME);

      if (missingConfig) {
        throw new Error(
          `[JSKim] 設定ファイルが見つかりません: ${configPath}\n` +
            `ワークスペースルートに ${CONFIG_FILENAME} を作成してください。`
        );
      }
    }

    throw new Error(
      `[JSKim] 設定ファイルの読み込みに失敗しました: ${configPath}\n` +
        `原因: ${err && err.message ? err.message : String(err)}`
    );
  }

  if (!config || typeof config !== 'object') {
    throw new Error(
      `[JSKim] 設定が不正です: ${configPath}\n` +
        `原因: module.exports はオブジェクトである必要があります。`
    );
  }

  if (!config.projects || typeof config.projects !== 'object') {
    throw new Error(
      `[JSKim] 設定が不正です: projects が無い、またはオブジェクトではありません。\n` +
        `設定: ${configPath}`
    );
  }

  return {
    config,
    configPath,
    workspaceRoot,
  };
}

module.exports = {
  loadConfig,
  CONFIG_FILENAME,
};
