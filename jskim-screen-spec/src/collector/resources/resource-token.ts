export const RESOURCE_TOKEN_SCHEME = 'jskim-spec-resource://';

export function toResourceToken(resourceId: string): string {
  return `${RESOURCE_TOKEN_SCHEME}${resourceId}`;
}

export function parseResourceToken(value: string): string | null {
  if (!value.startsWith(RESOURCE_TOKEN_SCHEME)) {
    return null;
  }
  const id = value.slice(RESOURCE_TOKEN_SCHEME.length);
  return id || null;
}

/**
 * 正規化した base（末尾 `/` 付き）を返す。
 */
export function normalizeViewerBase(base: string): string {
  if (!base) {
    return '/';
  }
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * token → viewer 上のファイル URL。
 * 例: base=/spec/ → /spec/data/resources/files/{id}
 */
export function resourceTokenToViewerUrl(
  resourceId: string,
  base: string,
): string {
  return `${normalizeViewerBase(base)}data/resources/files/${resourceId}`;
}

const TOKEN_PATTERN = 'jskim-spec-resource://([A-Za-z0-9._-]+)';

export class SpecResourceTokenError extends Error {
  code = 'SPEC_RESOURCE_TOKEN_UNKNOWN' as const;
  constructor(resourceId: string) {
    super(
      `未知の resource token です: jskim-spec-resource://${resourceId}`,
    );
    this.name = 'SpecResourceTokenError';
  }
}

/**
 * 文字列中の resource token を viewer URL に置換する。
 * knownIds が与えられた場合、未知 ID はエラー。
 * 置換後に token が残っていればエラー。
 */
export function rewriteResourceTokens(
  content: string,
  base: string,
  knownIds?: Set<string>,
): string {
  const tokenRe = new RegExp(TOKEN_PATTERN, 'g');
  const rewritten = content.replace(tokenRe, (_match, id: string) => {
    if (knownIds && !knownIds.has(id)) {
      throw new SpecResourceTokenError(id);
    }
    return resourceTokenToViewerUrl(id, base);
  });

  if (rewritten.includes(RESOURCE_TOKEN_SCHEME)) {
    const leftover = findResourceTokens(rewritten);
    const id = leftover[0] || 'unknown';
    throw new SpecResourceTokenError(id);
  }

  return rewritten;
}

/**
 * 内容に残っている token を列挙する。
 */
export function findResourceTokens(content: string): string[] {
  const tokenRe = new RegExp(TOKEN_PATTERN, 'g');
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(content)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}
