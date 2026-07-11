'use strict';

const fs = require('node:fs');

/**
 * serve / dev 開始前に outputDir の存在を確認します。
 * @param {object} project
 * @param {object} [options]
 * @param {string} [options.buildHint]
 */
function assertOutputDirReady(project, options = {}) {
  const { name, outputDir, outputDirConfig } = project;
  const buildHint = options.buildHint || `npm run build -- ${name}`;

  if (!outputDir || String(outputDir).trim() === '') {
    throw new Error(
      `[JSKim] ビルド出力が見つかりません。\n` +
        `プロジェクト: ${name}\n` +
        `出力先: ${outputDirConfig || '(未設定)'}\n\n` +
        `先にビルドを実行してください:\n` +
        buildHint
    );
  }

  if (!fs.existsSync(outputDir)) {
    throw new Error(
      `[JSKim] ビルド出力が見つかりません。\n` +
        `プロジェクト: ${name}\n` +
        `出力先: ${outputDirConfig}\n\n` +
        `先にビルドを実行してください:\n` +
        buildHint
    );
  }

  if (!fs.statSync(outputDir).isDirectory()) {
    throw new Error(
      `[JSKim] ビルド出力が見つかりません。\n` +
        `プロジェクト: ${name}\n` +
        `出力先: ${outputDirConfig}\n` +
        `原因: outputDir はディレクトリではありません。\n\n` +
        `先にビルドを実行してください:\n` +
        buildHint
    );
  }
}

function formatListenError(err, { projectName, host, port, kind = '静的' }) {
  const code = err && err.code;

  if (code === 'EADDRINUSE') {
    return new Error(
      `[JSKim] ポート ${port} はすでに使用されています。\n` +
        `プロジェクト: ${projectName}\n` +
        `ホスト: ${host}\n\n` +
        `jskim.config.js の serve.port を変更してください。`
    );
  }

  if (code === 'EACCES') {
    return new Error(
      `[JSKim] ポート ${port} へのバインド権限がありません。\n` +
        `プロジェクト: ${projectName}\n` +
        `ホスト: ${host}\n\n` +
        `別の serve.port を指定するか、権限を確認してください。`
    );
  }

  const message = err && err.message ? err.message : String(err);
  const label = kind === '開発' ? '開発サーバー' : '静的サーバー';
  return new Error(
    `[JSKim] ${label}の起動に失敗しました。\n` +
      `プロジェクト: ${projectName}\n` +
      `ホスト: ${host}\n` +
      `ポート: ${port}\n` +
      `原因: ${message}`
  );
}

module.exports = {
  assertOutputDirReady,
  formatListenError,
};
