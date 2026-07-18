/**
 * DESIGN_ONLY 画面削除後の route fallback 計算。
 * manifest.screens の並び（screenId localeCompare 'en'）と同じ順序を前提にする。
 */

export type DeleteScreenFallback =
  | { kind: 'screen'; screenId: string }
  | { kind: 'empty' };

/**
 * 削除前の画面 ID 一覧と削除対象から fallback を決める。
 *
 * 1. 次の画面
 * 2. 無ければ前の画面
 * 3. 残り 0 件なら empty
 */
export function resolveDeleteScreenFallback(
  orderedScreenIds: string[],
  deletedScreenId: string,
): DeleteScreenFallback {
  const ids = [...orderedScreenIds];
  const index = ids.indexOf(deletedScreenId);
  const remaining = ids.filter((id) => id !== deletedScreenId);

  if (remaining.length === 0) {
    return { kind: 'empty' };
  }

  if (index < 0) {
    return { kind: 'screen', screenId: remaining[0]! };
  }

  if (index + 1 < ids.length) {
    const next = ids[index + 1]!;
    if (next !== deletedScreenId) {
      return { kind: 'screen', screenId: next };
    }
  }

  if (index > 0) {
    const prev = ids[index - 1]!;
    if (prev !== deletedScreenId) {
      return { kind: 'screen', screenId: prev };
    }
  }

  return { kind: 'screen', screenId: remaining[0]! };
}

/**
 * watcher rebuild 後の最新一覧に合わせて fallback を再解決する。
 * 当初の候補が消えていれば先頭画面、0 件なら empty。
 */
export function resolveFallbackAgainstCurrentScreens(
  remainingScreenIds: string[],
  preferred: DeleteScreenFallback,
): DeleteScreenFallback {
  if (remainingScreenIds.length === 0) {
    return { kind: 'empty' };
  }
  if (
    preferred.kind === 'screen' &&
    remainingScreenIds.includes(preferred.screenId)
  ) {
    return preferred;
  }
  return { kind: 'screen', screenId: remainingScreenIds[0]! };
}
