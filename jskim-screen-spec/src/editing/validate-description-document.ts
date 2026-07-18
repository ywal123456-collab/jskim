import type { DescriptionSpec } from '../builder/load-screen-spec-project.js';
import { computeEffectiveItemOrder } from '../builder/item-order.js';
import {
  SCREEN_ID_RE,
  MAX_SCREEN_ID_LENGTH,
  isValidScreenId,
  isReservedScreenId,
  isValidItemId,
} from '../util/screen-id.js';

export {
  SCREEN_ID_RE,
  MAX_SCREEN_ID_LENGTH,
  isValidScreenId,
  isReservedScreenId,
  isValidItemId,
};

export const MAX_NAME_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 10000;
export const MAX_ITEM_ORDER_LENGTH = 500;

export type EditableItemFields = {
  name: string;
  type: string;
  description: string;
  note: string;
};

export type EditableDescriptionDocument = {
  schemaVersion: string;
  screen: {
    id: string;
    name: string;
    description: string;
  };
  itemOrder: string[];
  items: Record<string, EditableItemFields>;
  /** 設計対象から除外した項目（キーが除外 ID 集合） */
  excludedItems: Record<string, EditableItemFields>;
};

export type DescriptionValidationError = {
  code: string;
  message: string;
};

function normalizeItemFields(item: {
  name?: string;
  type?: string;
  description?: string;
  note?: string;
}): EditableItemFields {
  return {
    name: item.name ?? '',
    type: item.type ?? '',
    description: item.description ?? '',
    note: item.note ?? '',
  };
}

function validateItemEntry(
  mapLabel: string,
  itemId: string,
  item: unknown,
): DescriptionValidationError | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `${mapLabel}「${itemId}」は object である必要があります。`,
    };
  }
  const row = item as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (
      key !== 'name' &&
      key !== 'type' &&
      key !== 'description' &&
      key !== 'note'
    ) {
      return {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `${mapLabel}「${itemId}」に許可されていないフィールドがあります: ${key}`,
      };
    }
  }
  for (const field of ['name', 'type', 'description', 'note'] as const) {
    if (typeof row[field] !== 'string') {
      return {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `${mapLabel}「${itemId}」の ${field} は文字列である必要があります。`,
      };
    }
  }
  return null;
}

function validateItemMap(
  mapLabel: string,
  mapValue: unknown,
): DescriptionValidationError | { ids: string[]; map: Record<string, unknown> } {
  if (!mapValue || typeof mapValue !== 'object' || Array.isArray(mapValue)) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `${mapLabel} は object である必要があります。`,
    };
  }
  const map = mapValue as Record<string, unknown>;
  const ids = Object.keys(map);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `${mapLabel} の item ID が重複しています。`,
    };
  }
  for (const itemId of ids) {
    if (!isValidItemId(itemId)) {
      return {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `${mapLabel} の item ID の形式が不正です: ${itemId}`,
      };
    }
    const entryError = validateItemEntry(mapLabel, itemId, map[itemId]);
    if (entryError) {
      return entryError;
    }
  }
  return { ids, map };
}

/**
 * Viewer 編集用 document を検証する（常に schemaVersion "1.2" として保存する）。
 *
 * collected 項目は `items` または `excludedItems` のどちらかに残す必要がある
 * （`currentCollectedItemIds ⊆ keys(items) ∪ keys(excludedItems)`）。
 * 新規の除外は現在 collected されている ID に限る。
 * 既存の除外 entry は復元してからでないと除去できない。
 * collected に無い manual-only 項目の削除と、新規 ID の追加は許可する。
 */
export function validateEditableDescriptionDocument(options: {
  screenId: string;
  document: unknown;
  existing: DescriptionSpec | null;
  /** 現在の collected item ID（snapshot から再読込した最新集合） */
  requiredItemIds?: string[] | null;
}): DescriptionValidationError | null {
  const { screenId, document, existing, requiredItemIds } = options;

  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'document は object である必要があります。',
    };
  }

  const doc = document as Record<string, unknown>;
  const allowedTop = new Set([
    'schemaVersion',
    'screen',
    'itemOrder',
    'items',
    'excludedItems',
    '$schema',
  ]);
  for (const key of Object.keys(doc)) {
    if (!allowedTop.has(key)) {
      return {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `許可されていないフィールドです: ${key}`,
      };
    }
  }

  if (doc.schemaVersion !== '1.2') {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'schemaVersion は "1.2" である必要があります。',
    };
  }

  if (!doc.screen || typeof doc.screen !== 'object' || Array.isArray(doc.screen)) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'screen は object である必要があります。',
    };
  }

  const screen = doc.screen as Record<string, unknown>;
  for (const key of Object.keys(screen)) {
    if (key !== 'id' && key !== 'name' && key !== 'description') {
      return {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `screen に許可されていないフィールドがあります: ${key}`,
      };
    }
  }

  if (typeof screen.id !== 'string' || screen.id !== screenId) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'screen.id が URL の画面 ID と一致しません。',
    };
  }

  if (!isValidScreenId(screenId)) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: '画面 ID の形式が不正です。',
    };
  }

  if (typeof screen.name !== 'string') {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'screen.name は文字列である必要があります。',
    };
  }

  if (screen.name.length > MAX_NAME_LENGTH) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `screen.name は${MAX_NAME_LENGTH}文字以内である必要があります。`,
    };
  }

  if (typeof screen.description !== 'string') {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'screen.description は文字列である必要があります。',
    };
  }

  if (screen.description.length > MAX_DESCRIPTION_LENGTH) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `screen.description は${MAX_DESCRIPTION_LENGTH}文字以内である必要があります。`,
    };
  }

  const itemsResult = validateItemMap('items', doc.items);
  if ('code' in itemsResult) {
    return itemsResult;
  }
  const { ids: itemIds } = itemsResult;
  const uniqueItemIds = new Set(itemIds);

  const excludedResult = validateItemMap('excludedItems', doc.excludedItems);
  if ('code' in excludedResult) {
    return excludedResult;
  }
  const { ids: excludedIds } = excludedResult;
  const uniqueExcludedIds = new Set(excludedIds);

  for (const id of itemIds) {
    if (uniqueExcludedIds.has(id)) {
      return {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `items と excludedItems に同じ item ID があります: ${id}`,
      };
    }
  }

  if (!Array.isArray(doc.itemOrder)) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'itemOrder は配列である必要があります。',
    };
  }

  const itemOrder = doc.itemOrder as unknown[];
  if (itemOrder.length > MAX_ITEM_ORDER_LENGTH) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `itemOrder は${MAX_ITEM_ORDER_LENGTH}件以内である必要があります。`,
    };
  }

  for (const entry of itemOrder) {
    if (typeof entry !== 'string' || !isValidItemId(entry)) {
      return {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'itemOrder に不正な item ID が含まれています。',
      };
    }
  }

  const itemOrderStrings = itemOrder as string[];
  const itemOrderSet = new Set(itemOrderStrings);
  if (itemOrderSet.size !== itemOrderStrings.length) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'itemOrder に重複する item ID が含まれています。',
    };
  }

  if (
    itemOrderSet.size !== uniqueItemIds.size ||
    itemIds.some((id) => !itemOrderSet.has(id))
  ) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'itemOrder は items のキー集合と完全に一致する必要があります。',
    };
  }

  const representedIds = new Set([...uniqueItemIds, ...uniqueExcludedIds]);
  const oldExcludedIds = new Set(
    Object.keys(existing?.excludedItems || {}),
  );

  // 除外 entry の直接削除を先に判定（collected 欠落と同時でも専用 code を返す）
  for (const id of oldExcludedIds) {
    if (!representedIds.has(id)) {
      return {
        code: 'SPEC_DESCRIPTION_EXCLUDED_ITEM_REMOVE_NOT_ALLOWED',
        message:
          '除外した項目を直接削除できません。設計対象に戻してから削除してください。',
      };
    }
  }

  if (requiredItemIds != null) {
    const missingCollected = requiredItemIds.some(
      (id) => !representedIds.has(id),
    );
    if (missingCollected) {
      return {
        code: 'SPEC_DESCRIPTION_COLLECTED_ITEM_DELETE_NOT_ALLOWED',
        message:
          '実装画面と連携された項目は削除できません。設計対象に残すか、設計対象から除外してください。最新の画面設計書を再読み込みしてください。',
      };
    }

    const currentCollectedSet = new Set(requiredItemIds);
    for (const id of uniqueExcludedIds) {
      if (!oldExcludedIds.has(id) && !currentCollectedSet.has(id)) {
        return {
          code: 'SPEC_DESCRIPTION_MANUAL_ITEM_EXCLUDE_NOT_ALLOWED',
          message:
            '実装画面と連携していない項目は設計対象から除外できません。不要な場合は項目を削除してください。',
        };
      }
    }
  }

  return null;
}

export function toEditableDocument(
  description: DescriptionSpec,
  fallbackScreenId = '',
  collectedOrder?: string[] | null,
): EditableDescriptionDocument {
  const items: EditableDescriptionDocument['items'] = {};
  for (const [id, item] of Object.entries(description.items || {})) {
    items[id] = normalizeItemFields(item);
  }
  const excludedItems: EditableDescriptionDocument['excludedItems'] = {};
  for (const [id, item] of Object.entries(description.excludedItems || {})) {
    excludedItems[id] = normalizeItemFields(item);
  }
  const screen = description.screen || {
    id: fallbackScreenId,
    name: '',
    description: '',
  };
  const itemOrder = computeEffectiveItemOrder({
    items,
    itemOrder: description.itemOrder,
    collectedOrder,
  });
  return {
    schemaVersion: '1.2',
    screen: {
      id: screen.id || fallbackScreenId,
      name: screen.name ?? '',
      description: screen.description ?? '',
    },
    itemOrder,
    items,
    excludedItems,
  };
}

export function createEmptyEditableDocument(
  screenId: string,
): EditableDescriptionDocument {
  return {
    schemaVersion: '1.2',
    screen: {
      id: screenId,
      name: '',
      description: '',
    },
    itemOrder: [],
    items: {},
    excludedItems: {},
  };
}

/**
 * IMPLEMENTATION_ONLY の初回 GET/PUT 用ドラフト document。
 * snapshot から集めた item ID を空欄 placeholder として seed する
 * （itemOrder は DOM 出現順のまま維持する）。
 */
export function buildImplementationDraftDocument(
  screenId: string,
  itemIds: string[],
): EditableDescriptionDocument {
  const items: EditableDescriptionDocument['items'] = {};
  for (const id of itemIds) {
    items[id] = { name: '', type: '', description: '', note: '' };
  }
  return {
    schemaVersion: '1.2',
    screen: {
      id: screenId,
      name: '',
      description: '',
    },
    itemOrder: [...itemIds],
    items,
    excludedItems: {},
  };
}
