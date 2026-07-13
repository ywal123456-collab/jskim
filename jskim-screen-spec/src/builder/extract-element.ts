/**
 * HTML 文字列から指定 attribute を持つ要素の outerHTML を抽出する。
 * ネストした同名タグは depth カウントで対応する。
 */
export function extractElementOuterHtml(
  html: string,
  attrName: string,
  attrValue: string,
): string | null {
  const needle = `${attrName}="${attrValue}"`;
  const attrIndex = html.indexOf(needle);
  if (attrIndex === -1) {
    return null;
  }

  const openStart = html.lastIndexOf('<', attrIndex);
  if (openStart === -1) {
    return null;
  }

  const openEnd = html.indexOf('>', attrIndex);
  if (openEnd === -1) {
    return null;
  }

  const tagMatch = /^([a-zA-Z][\w-]*)/.exec(html.slice(openStart + 1));
  if (!tagMatch) {
    return null;
  }

  const tagName = tagMatch[1];
  if (html[openEnd - 1] === '/') {
    return html.slice(openStart, openEnd + 1);
  }

  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');
  let depth = 1;
  let pos = openEnd + 1;

  while (pos < html.length && depth > 0) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);

    if (!nextClose) {
      return null;
    }

    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      pos = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      pos = nextClose.index + nextClose[0].length;
      if (depth === 0) {
        return html.slice(openStart, pos);
      }
    }
  }

  return null;
}
