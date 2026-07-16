'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * テキスト比較用に改行を LF へ正規化する。
 * sample mirror など「内容の一致」契約で使う。
 * バイナリの byte-for-byte 比較には使わない。
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeNewlines(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * 改行差を無視したテキスト内容の一致を検証する。
 *
 * @param {string} actual
 * @param {string} expected
 * @param {string} [message]
 */
function assertTextEqual(actual, expected, message) {
  assert.equal(
    normalizeNewlines(actual),
    normalizeNewlines(expected),
    message
  );
}

/**
 * 2 ディレクトリの相対パス集合とテキスト内容が一致することを検証する。
 * （改行コードの差は無視する）
 *
 * @param {string} aRoot
 * @param {string} bRoot
 * @param {(dir: string) => string[]} listRelativeFiles
 */
async function assertDirectoryTextMirror(aRoot, bRoot, listRelativeFiles) {
  const aFiles = listRelativeFiles(aRoot);
  const bFiles = listRelativeFiles(bRoot);
  assert.deepEqual(bFiles, aFiles);
  for (const rel of aFiles) {
    const a = await fsp.readFile(path.join(aRoot, rel), 'utf8');
    const b = await fsp.readFile(path.join(bRoot, rel), 'utf8');
    assertTextEqual(a, b, `内容が一致すべき: ${rel}`);
  }
}

/**
 * 同期版（create-jskim など同期 list と組み合わせる場合）。
 *
 * @param {string} aRoot
 * @param {string} bRoot
 * @param {(dir: string) => string[]} listRelativeFiles
 */
function assertDirectoryTextMirrorSync(aRoot, bRoot, listRelativeFiles) {
  const aFiles = listRelativeFiles(aRoot);
  const bFiles = listRelativeFiles(bRoot);
  assert.deepEqual(bFiles, aFiles);
  for (const rel of aFiles) {
    const a = fs.readFileSync(path.join(aRoot, rel), 'utf8');
    const b = fs.readFileSync(path.join(bRoot, rel), 'utf8');
    assertTextEqual(a, b, `内容が一致すべき: ${rel}`);
  }
}

module.exports = {
  normalizeNewlines,
  assertTextEqual,
  assertDirectoryTextMirror,
  assertDirectoryTextMirrorSync,
};
