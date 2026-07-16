/**
 * snapshot HTML から data-jskim-spec-item の出現順 ID を抽出する。
 * 同一 ID が複数回あっても最初の出現のみ残す。
 */
export function extractItemIdsInDomOrder(html: string): string[] {
  const re = /data-jskim-spec-item="([^"]+)"/g;
  const ids: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export type StateForItemOrder = {
  id: string;
  viewer?: {
    visible?: boolean;
    order?: number;
  };
  html: string;
};

/**
 * viewer.visible な state を order 昇順で走査し、
 * 各 snapshot の DOM 出現順で item ID を first-seen 結合する。
 */
export function computeItemOrder(states: StateForItemOrder[]): string[] {
  const visible = states
    .filter((state) => state.viewer?.visible !== false)
    .slice()
    .sort((a, b) => (a.viewer?.order ?? 0) - (b.viewer?.order ?? 0));

  const order: string[] = [];
  const seen = new Set<string>();

  for (const state of visible) {
    for (const id of extractItemIdsInDomOrder(state.html)) {
      if (!seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
  }

  return order;
}

/**
 * 表示用の実効 itemOrder を計算する。
 *
 * - `itemOrder` が items と完全に一致する（bijection）場合はそのまま使う
 * - `itemOrder` が無い、または items と不一致（壊れた 1.1 / 1.0 互換）の場合は
 *   `collectedOrder`（DOM 出現順）で items に存在する ID を先に並べ、
 *   残りを `items` の key 順（挿入順）で末尾に補う
 */
export function computeEffectiveItemOrder(options: {
  items: Record<string, unknown>;
  itemOrder?: string[] | null;
  collectedOrder?: string[] | null;
}): string[] {
  const { items, itemOrder, collectedOrder } = options;
  const itemKeys = Object.keys(items);
  const itemKeySet = new Set(itemKeys);

  if (itemOrder && itemOrder.length > 0) {
    const orderSet = new Set(itemOrder);
    const isExactMatch =
      itemOrder.length === itemKeys.length &&
      itemKeys.every((id) => orderSet.has(id));
    if (isExactMatch) {
      return [...itemOrder];
    }

    // 壊れた itemOrder の repair: 有効な ID だけ残し、items の残りを補う
    const result: string[] = [];
    const seen = new Set<string>();
    for (const id of itemOrder) {
      if (itemKeySet.has(id) && !seen.has(id)) {
        result.push(id);
        seen.add(id);
      }
    }
    for (const id of itemKeys) {
      if (!seen.has(id)) {
        result.push(id);
        seen.add(id);
      }
    }
    return result;
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const id of collectedOrder || []) {
    if (itemKeySet.has(id) && !seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  for (const id of itemKeys) {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  return result;
}

/**
 * Collector merge 用: 人が並べた既存 itemOrder を維持しつつ、
 * 実装から新たに見つかった item ID を末尾（DOM 出現順）に追加する。
 * orphan（found に無い既存 ID）も削除せず順序を維持する。
 */
export function mergeItemOrder(options: {
  existingOrder?: string[] | null;
  existingItemIds: string[];
  foundItemIds: string[];
}): string[] {
  const { existingOrder, existingItemIds, foundItemIds } = options;
  const existingIdSet = new Set(existingItemIds);
  const base =
    existingOrder && existingOrder.length > 0 ? existingOrder : existingItemIds;

  const result: string[] = [];
  const seen = new Set<string>();
  for (const id of base) {
    if (existingIdSet.has(id) && !seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  for (const id of existingItemIds) {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  for (const id of foundItemIds) {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  return result;
}
