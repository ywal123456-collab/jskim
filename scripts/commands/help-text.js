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
    '  jskim spec build [<project>]',
    '  jskim spec collect [<project>]',
    '  jskim spec dev [<project>] [--host <host>] [--port <port>] [--open]',
    '  jskim spec version <subcommand>',
    '',
    'コマンド:',
    '  build          静的ファイルをビルドします。',
    '  watch          ファイルの変更を監視して再ビルドします。',
    '  serve          ビルド済みのファイルを配信します。',
    '  dev            ビルド・監視・サーバー・ライブリロードを起動します。',
    '  spec           画面設計書（optional companion）関連コマンドです。',
    '  spec version   Screen Spec のローカル版管理です。',
    '',
    'オプション:',
    '  --all           設定内の全projectを順にbuildします（buildのみ）。',
    '  --host <host>   serve / dev / spec dev の待受ホストを上書きします。',
    '  --port <port>   serve / dev / spec dev の待受ポートを上書きします。',
    '  --open          listen成功後にbrowserを1回開きます（dev / spec dev）。',
    '  -h, --help      ヘルプを表示します。',
    '  -v, --version   バージョンを表示します。',
    '',
    '補足:',
    '  projectを省略できるのは、設定内のprojectが1件だけの場合です。',
    '  spec collect / build / dev / version は @ywal123456/jskim-screen-spec（optional）が必要です。',
    '  版管理の詳細: jskim spec version --help',
    '  画面設計書の開発: jskim spec dev （collect + viewer build + /spec/ 自動更新）',
    '  手動手順: jskim spec collect → jskim spec build → jskim dev の /spec/',
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
    '  spec build [<project>]',
    '  spec collect [<project>]',
    '  spec dev [<project>]',
    '  spec version <subcommand>',
  ].join('\n');
}

module.exports = {
  getHelpText,
  getUnknownCommandText,
};
