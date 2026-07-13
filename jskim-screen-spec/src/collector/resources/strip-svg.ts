/**
 * 収集した SVG から script / on* を最小限除去する。
 */
export function stripSvgScripts(bytes: Buffer): Buffer {
  let text = bytes.toString('utf8');
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<script\b[^>]*\/>/gi, '');
  text = text.replace(
    /\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g,
    '',
  );
  return Buffer.from(text, 'utf8');
}
