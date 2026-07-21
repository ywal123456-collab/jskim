import type { DescriptionSpec } from '../builder/load-screen-spec-project.js';
import { mergeItemOrder } from '../builder/item-order.js';
import { assertDescriptionMutationSupported } from '../editing/description-document/index.js';

export type MergeDescriptionResult = {
  description: DescriptionSpec;
  addedItemIds: string[];
  orphanItemIds: string[];
  created: boolean;
};

function emptyItem(): DescriptionSpec['items'][string] {
  return {
    name: '',
    type: '',
    description: '',
    note: '',
  };
}

/**
 * 収集した item ID を Description JSON へ merge する。
 * 既存テキストは保持し、orphan は削除しない。
 * keys(excludedItems) にある ID は items / itemOrder へ再追加しない。
 *
 * schemaVersion の扱い（lazy migration）:
 * - 新規作成時は 1.2（itemOrder は DOM 出現順、excludedItems: {}）
 * - 既存が 1.2 の場合は常に 1.2 と excludedItems を維持
 * - 既存が 1.0/1.1 で今回 item が追加された場合のみ 1.2 へ upgrade
 * - 既存が 1.0 のままで内容変更が無い場合は 1.0 のまま維持する
 * - 既存が 1.1 で追加が無い場合は 1.1 のまま維持する
 */
export function mergeDescription(options: {
  existing: DescriptionSpec | null;
  screenId: string;
  foundItemIds: string[];
}): MergeDescriptionResult {
  const { existing, screenId, foundItemIds } = options;

  if (existing) {
    assertDescriptionMutationSupported(existing.schemaVersion);
  }

  if (!existing) {
    const items: DescriptionSpec['items'] = {};
    for (const id of foundItemIds) {
      items[id] = emptyItem();
    }
    const itemOrder = mergeItemOrder({
      existingOrder: null,
      existingItemIds: [],
      foundItemIds,
    });
    return {
      description: {
        schemaVersion: '1.2',
        screen: {
          id: screenId,
          name: '',
          description: '',
        },
        itemOrder,
        items,
        excludedItems: {},
      },
      addedItemIds: [...foundItemIds],
      orphanItemIds: [],
      created: true,
    };
  }

  const excludedItems: NonNullable<DescriptionSpec['excludedItems']> = {
    ...(existing.excludedItems || {}),
  };
  const excludedIdSet = new Set(Object.keys(excludedItems));
  const items: DescriptionSpec['items'] = { ...existing.items };
  const existingIds = Object.keys(existing.items || {});
  const existingIdSet = new Set(existingIds);
  const foundSet = new Set(foundItemIds);
  const addedItemIds: string[] = [];
  const orphanItemIds: string[] = [];

  for (const id of foundItemIds) {
    if (excludedIdSet.has(id)) {
      continue;
    }
    if (!existingIdSet.has(id)) {
      items[id] = emptyItem();
      addedItemIds.push(id);
    }
  }

  for (const id of existingIds) {
    if (!foundSet.has(id)) {
      orphanItemIds.push(id);
    }
  }

  const activeFoundItemIds = foundItemIds.filter((id) => !excludedIdSet.has(id));
  const isV12 = existing.schemaVersion === '1.2';
  const needsUpgrade =
    isV12 || addedItemIds.length > 0 || existing.schemaVersion === '1.1';

  let schemaVersion: string;
  if (isV12 || addedItemIds.length > 0) {
    schemaVersion = '1.2';
  } else if (existing.schemaVersion === '1.1') {
    schemaVersion = '1.1';
  } else {
    schemaVersion = existing.schemaVersion || '1.0';
  }

  const description: DescriptionSpec = {
    ...existing,
    schemaVersion,
    screen: {
      ...existing.screen,
      id: existing.screen?.id || screenId,
    },
    items,
  };

  if (schemaVersion === '1.2') {
    description.itemOrder = mergeItemOrder({
      existingOrder: existing.itemOrder,
      existingItemIds: Object.keys(items),
      foundItemIds: activeFoundItemIds,
    });
    description.excludedItems = excludedItems;
  } else if (needsUpgrade) {
    // 1.1 維持（追加なし）
    description.itemOrder = mergeItemOrder({
      existingOrder: existing.itemOrder,
      existingItemIds: existingIds,
      foundItemIds: activeFoundItemIds,
    });
    delete description.excludedItems;
  } else {
    delete description.itemOrder;
    delete description.excludedItems;
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
