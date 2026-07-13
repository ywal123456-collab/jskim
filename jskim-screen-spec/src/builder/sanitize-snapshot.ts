/**
 * snapshot HTML から script 要素と on* イベント属性を除去する。
 */
export function sanitizeSnapshot(html: string): string {
  let result = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  result = result.replace(/<script\b[^>]*\/>/gi, '');
  result = result.replace(
    /\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g,
    '',
  );
  return result;
}
