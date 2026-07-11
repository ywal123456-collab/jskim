'use strict';

/**
 * CLI ヘルプ文言を返します。
 * @returns {string}
 */
function getHelpText() {
  return [
    'JSKim - Nunjucksを使用した静的HTMLビルド環境',
    '',
    '使用方法:',
    '  jskim <command> <project>',
    '',
    'コマンド:',
    '  build <project>  静的ファイルをビルドします。',
    '  watch <project>  ファイルの変更を監視して再ビルドします。',
    '  serve <project>  ビルド済みのファイルを配信します。',
    '  dev <project>    ビルド・監視・サーバー・ライブリロードを起動します。',
    '',
    'オプション:',
    '  -h, --help       ヘルプを表示します。',
    '  -v, --version    バージョンを表示します。',
  ].join('\n');
}

/**
 * 不明なコマンド時の案内を返します。
 * @param {string} command
 * @returns {string}
 */
function getUnknownCommandText(command) {
  return [
    `[JSKim] 不明なコマンドです: ${command}`,
    '',
    '使用できるコマンド:',
    '  build <project>',
    '  watch <project>',
    '  serve <project>',
    '  dev <project>',
  ].join('\n');
}

module.exports = {
  getHelpText,
  getUnknownCommandText,
};
