'use strict';

/**
 * inline `<script>` 内に埋め込む JSON リテラルを HTML tokenizer 安全に直列化する。
 * JSON.parse 後の値は JSON.stringify と同一である。
 *
 * @param {unknown} value
 * @returns {string}
 */
function serializeInlineScriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

module.exports = {
  serializeInlineScriptJson,
};
