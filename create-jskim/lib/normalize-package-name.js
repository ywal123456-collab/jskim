'use strict';

/**
 * ディレクトリ名から npm package name を正規化します。
 * @param {string} raw
 * @returns {string}
 */
function normalizePackageName(raw) {
  let name = String(raw == null ? '' : raw).trim().toLowerCase();
  name = name.replace(/[\s_]+/g, '-');
  name = name.replace(/[^a-z0-9.-]/g, '-');
  name = name.replace(/\.+/g, '.');
  name = name.replace(/-+/g, '-');
  name = name.replace(/^[-.]+|[-.]+$/g, '');

  if (!name) {
    throw new Error(
      '[create-jskim] パッケージ名を生成できません。\n' +
        `入力: ${String(raw)}\n` +
        '英数字を含むディレクトリ名を指定してください。'
    );
  }

  if (!/^[a-z0-9]/.test(name)) {
    throw new Error(
      '[create-jskim] パッケージ名が不正です。\n' +
        `生成結果: ${name}\n` +
        '英数字で始まる名前にしてください。'
    );
  }

  return name;
}

module.exports = {
  normalizePackageName,
};
