/**
 * 項目複製時の itemId 自動提案。
 * viewer bundle 内に閉じるため create-item-validation と同じ規則を使う。
 */

import { ITEM_ID_RE, MAX_ITEM_ID_LENGTH } from './create-item-validation';

/**
 * sourceId に suffix を付けた候補を最大長以内に収める。
 * 末尾がハイフンにならないよう切り詰める。
 */
function withSuffix(sourceId: string, suffix: string, maxLength: number): string {
  if (sourceId.length + suffix.length <= maxLength) {
    return `${sourceId}${suffix}`;
  }
  let baseLen = maxLength - suffix.length;
  if (baseLen < 1) {
    // suffix 自体が長すぎる場合は数字付き短い ID にフォールバック
    return `c${suffix.replace(/[^a-z0-9-]/g, '').slice(-Math.max(0, maxLength - 1))}`;
  }
  let base = sourceId.slice(0, baseLen);
  while (base.endsWith('-') && base.length > 0) {
    base = base.slice(0, -1);
  }
  if (!base) {
    base = 'item';
    if (base.length + suffix.length > maxLength) {
      return `item-copy`.slice(0, maxLength);
    }
  }
  return `${base}${suffix}`;
}

/**
 * 衝突しない複製用 itemId を提案する。
 * 例: inquiry-content → inquiry-content-copy → inquiry-content-copy-2 …
 */
export function suggestCopyItemId(
  sourceItemId: string,
  existingItemIds: string[],
): string {
  const taken = new Set(existingItemIds);
  const source = sourceItemId.trim();
  const first = withSuffix(source, '-copy', MAX_ITEM_ID_LENGTH);
  if (ITEM_ID_RE.test(first) && !taken.has(first)) {
    return first;
  }

  for (let n = 2; n < 10000; n += 1) {
    const candidate = withSuffix(source, `-copy-${n}`, MAX_ITEM_ID_LENGTH);
    if (ITEM_ID_RE.test(candidate) && !taken.has(candidate)) {
      return candidate;
    }
  }

  // 到達しない想定。最終手段。
  let i = 1;
  while (i < 100000) {
    const fallback = `copy-${i}`;
    if (!taken.has(fallback)) {
      return fallback;
    }
    i += 1;
  }
  return 'copy';
}
