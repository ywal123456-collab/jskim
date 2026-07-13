'use strict';

/**
 * Screen Spec v1 の production 向け attribute 除去。
 * data-jskim-spec-screen / item / action のみを start tag から取り除く。
 * HTML 全体の再シリアライズは行わない。
 */

const SPEC_ATTR_NAMES = new Set([
  'data-jskim-spec-screen',
  'data-jskim-spec-item',
  'data-jskim-spec-action',
]);

/**
 * @param {string} html
 * @returns {string}
 */
function stripScreenSpecAttributes(html) {
  if (typeof html !== 'string') {
    throw new TypeError(
      '[JSKim] stripScreenSpecAttributes: html は文字列である必要があります。'
    );
  }

  let out = '';
  let i = 0;
  const n = html.length;

  while (i < n) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      if (end === -1) {
        out += html.slice(i);
        break;
      }
      out += html.slice(i, end + 3);
      i = end + 3;
      continue;
    }

    if (html[i] === '<') {
      const rawBlock = tryCopyRawTextElement(html, i);
      if (rawBlock) {
        out += rawBlock.text;
        i = rawBlock.nextIndex;
        continue;
      }

      if (isStartTagOpen(html, i)) {
        const parsed = parseStartTag(html, i);
        out += stripAttrsFromStartTag(parsed.tagText);
        i = parsed.nextIndex;
        continue;
      }
    }

    out += html[i];
    i += 1;
  }

  return out;
}

/**
 * @param {string} html
 * @param {object} [options]
 * @param {boolean} [options.preserve]
 * @returns {string}
 */
function transformScreenSpecAttributes(html, options = {}) {
  if (options.preserve === true) {
    if (typeof html !== 'string') {
      throw new TypeError(
        '[JSKim] transformScreenSpecAttributes: html は文字列である必要があります。'
      );
    }
    return html;
  }
  return stripScreenSpecAttributes(html);
}

/**
 * @param {string} html
 * @param {number} start
 * @returns {{ text: string, nextIndex: number } | null}
 */
function tryCopyRawTextElement(html, start) {
  const match = html.slice(start).match(/^<(script|style|textarea|title)\b/i);
  if (!match) {
    return null;
  }
  const tagName = match[1];
  const openEnd = findTagClose(html, start);
  if (openEnd === -1) {
    return null;
  }

  // self-closing ならそのまま
  const openTag = html.slice(start, openEnd + 1);
  if (/\/\s*>$/.test(openTag)) {
    return { text: openTag, nextIndex: openEnd + 1 };
  }

  const closeRe = new RegExp(`</${tagName}\\s*>`, 'i');
  const rest = html.slice(openEnd + 1);
  const closeMatch = rest.match(closeRe);
  if (!closeMatch || closeMatch.index == null) {
    return { text: html.slice(start), nextIndex: html.length };
  }
  const nextIndex = openEnd + 1 + closeMatch.index + closeMatch[0].length;
  return { text: html.slice(start, nextIndex), nextIndex };
}

/**
 * @param {string} html
 * @param {number} i
 * @returns {boolean}
 */
function isStartTagOpen(html, i) {
  if (html[i] !== '<') {
    return false;
  }
  const next = html[i + 1];
  if (!next) {
    return false;
  }
  // 終了タグ・コメント・DOCTYPE / 処理命令は除外
  if (next === '/' || next === '!' || next === '?') {
    return false;
  }
  return /[A-Za-z]/.test(next);
}

/**
 * @param {string} html
 * @param {number} start
 * @returns {{ tagText: string, nextIndex: number }}
 */
function parseStartTag(html, start) {
  const end = findTagClose(html, start);
  if (end === -1) {
    return { tagText: html.slice(start), nextIndex: html.length };
  }
  return { tagText: html.slice(start, end + 1), nextIndex: end + 1 };
}

/**
 * start tag の閉じ `>` を探す（引用符内の `>` は無視）。
 * @param {string} html
 * @param {number} start `<` の位置
 * @returns {number}
 */
function findTagClose(html, start) {
  let i = start + 1;
  let quote = null;
  while (i < html.length) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '>') {
      return i;
    }
    i += 1;
  }
  return -1;
}

/**
 * @param {string} tagText
 * @returns {string}
 */
function stripAttrsFromStartTag(tagText) {
  if (tagText.length < 3 || tagText[0] !== '<') {
    return tagText;
  }

  // `<tag` の後から属性を走査
  let i = 1;
  while (i < tagText.length && /[A-Za-z0-9:-]/.test(tagText[i])) {
    i += 1;
  }

  let result = tagText.slice(0, i);

  while (i < tagText.length) {
    const ch = tagText[i];

    // 終端
    if (ch === '>') {
      result += '>';
      break;
    }
    if (ch === '/' && tagText[i + 1] === '>') {
      result += '/>';
      break;
    }

    // 空白はいったん保留し、削除する attribute の直前空白ごと落とす
    if (/\s/.test(ch)) {
      let wsStart = i;
      while (i < tagText.length && /\s/.test(tagText[i])) {
        i += 1;
      }
      if (i >= tagText.length) {
        result += tagText.slice(wsStart);
        break;
      }

      // `/` または `>` なら空白を残す
      if (tagText[i] === '>' || (tagText[i] === '/' && tagText[i + 1] === '>')) {
        result += tagText.slice(wsStart, i);
        continue;
      }

      const attr = readAttribute(tagText, i);
      if (!attr) {
        result += tagText.slice(wsStart);
        break;
      }

      if (SPEC_ATTR_NAMES.has(attr.name.toLowerCase())) {
        i = attr.nextIndex;
        continue;
      }

      result += tagText.slice(wsStart, attr.nextIndex);
      i = attr.nextIndex;
      continue;
    }

    // 空白なしで属性が続くケース（稀）
    const attr = readAttribute(tagText, i);
    if (!attr) {
      result += tagText.slice(i);
      break;
    }
    if (SPEC_ATTR_NAMES.has(attr.name.toLowerCase())) {
      i = attr.nextIndex;
      continue;
    }
    result += tagText.slice(i, attr.nextIndex);
    i = attr.nextIndex;
  }

  return result;
}

/**
 * @param {string} tagText
 * @param {number} start
 * @returns {{ name: string, nextIndex: number } | null}
 */
function readAttribute(tagText, start) {
  let i = start;
  if (i >= tagText.length || !/[A-Za-z_:]/.test(tagText[i])) {
    return null;
  }

  const nameStart = i;
  i += 1;
  while (i < tagText.length && /[A-Za-z0-9_.:-]/.test(tagText[i])) {
    i += 1;
  }
  const name = tagText.slice(nameStart, i);

  while (i < tagText.length && /\s/.test(tagText[i])) {
    i += 1;
  }

  if (tagText[i] !== '=') {
    return { name, nextIndex: i };
  }

  i += 1;
  while (i < tagText.length && /\s/.test(tagText[i])) {
    i += 1;
  }

  if (tagText[i] === '"' || tagText[i] === "'") {
    const quote = tagText[i];
    i += 1;
    while (i < tagText.length && tagText[i] !== quote) {
      i += 1;
    }
    if (i < tagText.length) {
      i += 1;
    }
    return { name, nextIndex: i };
  }

  // unquoted value
  while (
    i < tagText.length &&
    !/\s/.test(tagText[i]) &&
    tagText[i] !== '>' &&
    !(tagText[i] === '/' && tagText[i + 1] === '>')
  ) {
    i += 1;
  }
  return { name, nextIndex: i };
}

module.exports = {
  stripScreenSpecAttributes,
  transformScreenSpecAttributes,
  SPEC_ATTR_NAMES,
};
