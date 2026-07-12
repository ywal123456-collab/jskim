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
    '  jskim build [<project>]',
    '  jskim build --all',
    '  jskim watch [<project>]',
    '  jskim serve [<project>] [--host <host>] [--port <port>]',
    '  jskim dev [<project>] [--host <host>] [--port <port>] [--open]',
    '',
    'コマンド:',
    '  build   静的ファイルをビルドします。',
    '  watch   ファイルの変更を監視して再ビルドします。',
    '  serve   ビルド済みのファイルを配信します。',
    '  dev     ビルド・監視・サーバー・ライブリロードを起動します。',
    '',
    'オプション:',
    '  --all           設定内の全projectを順にbuildします（buildのみ）。',
    '  --host <host>   serve / dev の待受ホストを上書きします。',
    '  --port <port>   serve / dev の待受ポートを上書きします。',
    '  --open          listen成功後にbrowserを1回開きます（devのみ）。',
    '  -h, --help      ヘルプを表示します。',
    '  -v, --version   バージョンを表示します。',
    '',
    '補足:',
    '  projectを省略できるのは、設定内のprojectが1件だけの場合です。',
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
    '  build [<project>]',
    '  build --all',
    '  watch [<project>]',
    '  serve [<project>] [--host <host>] [--port <port>]',
    '  dev [<project>] [--host <host>] [--port <port>] [--open]',
  ].join('\n');
}

module.exports = {
  getHelpText,
  getUnknownCommandText,
};
