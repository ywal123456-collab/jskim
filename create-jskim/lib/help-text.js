'use strict';

/**
 * create-jskim のヘルプ文言を返します。
 * @returns {string}
 */
function getHelpText() {
  return [
    'create-jskim - JSKimプロジェクトを作成します。',
    '',
    '使用方法:',
    '  create-jskim [project-directory]',
    '',
    '引数:',
    '  project-directory  作成するプロジェクトのディレクトリです。',
    '',
    'オプション:',
    '  -h, --help         ヘルプを表示します。',
    '  -v, --version      バージョンを表示します。',
  ].join('\n');
}

module.exports = {
  getHelpText,
};
