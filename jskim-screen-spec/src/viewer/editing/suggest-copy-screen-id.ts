/**
 * 画面複製時の screenId / 画面名 自動提案。
 */

import {
  MAX_NAME_LENGTH,
  MAX_SCREEN_ID_LENGTH,
  SCREEN_ID_RE,
} from './create-screen-validation';

function withSuffix(
  sourceId: string,
  suffix: string,
  maxLength: number,
): string {
  if (sourceId.length + suffix.length <= maxLength) {
    return `${sourceId}${suffix}`;
  }
  let baseLen = maxLength - suffix.length;
  if (baseLen < 1) {
    return `s${suffix.replace(/[^a-z0-9-]/g, '').slice(-Math.max(0, maxLength - 1))}`;
  }
  let base = sourceId.slice(0, baseLen);
  while (base.endsWith('-') && base.length > 0) {
    base = base.slice(0, -1);
  }
  if (!base) {
    base = 'screen';
    if (base.length + suffix.length > maxLength) {
      return 'screen-copy'.slice(0, maxLength);
    }
  }
  return `${base}${suffix}`;
}

/**
 * 衝突しない複製用 screenId を提案する。
 * 例: inquiry-input → inquiry-input-copy → inquiry-input-copy-2 …
 */
export function suggestCopyScreenId(
  sourceScreenId: string,
  existingScreenIds: string[],
): string {
  const taken = new Set(existingScreenIds);
  const source = sourceScreenId.trim();
  const first = withSuffix(source, '-copy', MAX_SCREEN_ID_LENGTH);
  if (SCREEN_ID_RE.test(first) && !taken.has(first)) {
    return first;
  }

  for (let n = 2; n < 10000; n += 1) {
    const candidate = withSuffix(source, `-copy-${n}`, MAX_SCREEN_ID_LENGTH);
    if (SCREEN_ID_RE.test(candidate) && !taken.has(candidate)) {
      return candidate;
    }
  }

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

/**
 * 複製用の画面名を提案する（例: 「商品登録 コピー」）。
 */
export function suggestCopyScreenName(sourceName: string): string {
  const base = sourceName.trim() || '画面';
  const suffix = ' コピー';
  if (base.length + suffix.length <= MAX_NAME_LENGTH) {
    return `${base}${suffix}`;
  }
  const cut = Math.max(1, MAX_NAME_LENGTH - suffix.length);
  return `${base.slice(0, cut)}${suffix}`;
}
