import type { DescriptionSpec } from '../builder/load-screen-spec-project.js';
import { mergeItemOrder } from '../builder/item-order.js';

export type MergeDescriptionResult = {
  description: DescriptionSpec;
  addedItemIds: string[];
  orphanItemIds: string[];
  created: boolean;
};

/**
 * 収集した item ID を Description JSON へ merge する。
 * 既存テキストは保持し、orphan は削除しない。
 *
 * schemaVersion の扱い（lazy migration）:
 * - 新規作成時は 1.1（itemOrder は DOM 出現順）
 * - 既存が 1.1、または今回 item が追加された場合のみ 1.1 へ upgrade（itemOrder を人の並びを維持して再計算）
 * - 既存が 1.0 のままで内容変更が無い場合は 1.0 のまま維持する（不要な書き込みを避ける）
 */
export function mergeDescription(options: {
  existing: DescriptionSpec | null;
  screenId: string;
  foundItemIds: string[];
}): MergeDescriptionResult {
  const { existing, screenId, foundItemIds } = options;

  if (!existing) {
    const items: DescriptionSpec['items'] = {};
    for (const id of foundItemIds) {
      items[id] = {
        name: '',
        type: '',
        description: '',
        note: '',
      };
    }
    const itemOrder = mergeItemOrder({
      existingOrder: null,
      existingItemIds: [],
      foundItemIds,
    });
    return {
      description: {
        schemaVersion: '1.1',
        screen: {
          id: screenId,
          name: '',
          description: '',
        },
        itemOrder,
        items,
      },
      addedItemIds: [...foundItemIds],
      orphanItemIds: [],
      created: true,
    };
  }

  const items: DescriptionSpec['items'] = { ...existing.items };
  const existingIds = Object.keys(existing.items || {});
  const existingIdSet = new Set(existingIds);
  const foundSet = new Set(foundItemIds);
  const addedItemIds: string[] = [];
  const orphanItemIds: string[] = [];

  for (const id of foundItemIds) {
    if (!existingIdSet.has(id)) {
      items[id] = {
        name: '',
        type: '',
        description: '',
        note: '',
      };
      addedItemIds.push(id);
    }
  }

  for (const id of existingIds) {
    if (!foundSet.has(id)) {
      orphanItemIds.push(id);
    }
  }

  const needsV11Upgrade =
    existing.schemaVersion === '1.1' || addedItemIds.length > 0;

  const description: DescriptionSpec = {
    ...existing,
    schemaVersion: needsV11Upgrade ? '1.1' : existing.schemaVersion || '1.0',
    screen: {
      ...existing.screen,
      id: existing.screen?.id || screenId,
    },
    items,
  };

  if (needsV11Upgrade) {
    description.itemOrder = mergeItemOrder({
      existingOrder: existing.itemOrder,
      existingItemIds: existingIds,
      foundItemIds,
    });
  } else {
    delete description.itemOrder;
  }

  return {
    description,
    addedItemIds,
    orphanItemIds,
    created: false,
  };
}

/**
 * Description JSON を整形して書き込む文字列を返す。
 */
export function stringifyDescription(description: DescriptionSpec): string {
  return `${JSON.stringify(description, null, 2)}\n`;
}
