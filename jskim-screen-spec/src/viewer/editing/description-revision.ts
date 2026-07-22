/**
 * Description Tree / mutation API の revision 形式。
 * producer: computeContentRevision（Node crypto SHA-256 hex, 小文字）
 * canonical: sha256: + 64 lowercase hex（前後空白・追加文字なし）
 */

const DESCRIPTION_REVISION_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function isValidDescriptionRevision(
  value: unknown,
): value is string {
  return typeof value === 'string' && DESCRIPTION_REVISION_PATTERN.test(value);
}

export function parseDescriptionRevision(value: unknown): string | null {
  return isValidDescriptionRevision(value) ? value : null;
}
