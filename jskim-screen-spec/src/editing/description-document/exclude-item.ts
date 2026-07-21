import { isValidItemId } from '../../util/screen-id.js';
import { cloneNormalizedDescription } from './clone-normalized.js';
import { DescriptionDocumentError } from './errors.js';
import { findNodeLocation } from './find-node-location.js';
import { getChildListRef } from './tree-children.js';
import type { ItemDescriptionFields, NormalizedDescription } from './types.js';

const EXCLUDE_ITEM_KEYS = new Set(['itemId']);

export type ExcludeItemInput = {
  itemId: string;
};

export type ApplyExcludeItemResult = {
  status: 'updated';
  normalized: NormalizedDescription;
};

function cloneItemFields(item: ItemDescriptionFields): ItemDescriptionFields {
  return {
    name: item.name,
    type: item.type,
    description: item.description,
    note: item.note,
  };
}

function assertExcludeItemInput(input: ExcludeItemInput): void {
  for (const key of Object.keys(input)) {
    if (!EXCLUDE_ITEM_KEYS.has(key)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `excludeItem に許可されていないフィールドがあります: ${key}`,
      });
    }
  }
  if (!isValidItemId(input.itemId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `itemId の形式が不正です: ${input.itemId}`,
    });
  }
}

/**
 * collected active Item を tree から除去し excludedItems へ移動する（新 object を返す）。
 */
export function applyExcludeItem(
  normalized: NormalizedDescription,
  input: ExcludeItemInput,
  collectedItemIds: readonly string[],
): ApplyExcludeItemResult {
  assertExcludeItemInput(input);

  const groupIds = new Set(normalized.groups.map((group) => group.groupId));
  if (groupIds.has(input.itemId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_NODE_NOT_FOUND',
      message: `Item が見つかりません: ${input.itemId}`,
    });
  }

  const current = normalized.items[input.itemId];
  if (!current) {
    if (normalized.excludedItems[input.itemId]) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_NODE_NOT_FOUND',
        message: `Item が見つかりません: ${input.itemId}`,
      });
    }
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_NODE_NOT_FOUND',
      message: `Item が見つかりません: ${input.itemId}`,
    });
  }

  const collectedSet = new Set(collectedItemIds);
  if (!collectedSet.has(input.itemId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_MANUAL_ITEM_EXCLUDE_NOT_ALLOWED',
      message:
        '実装画面と連携していない項目は設計対象から除外できません。不要な場合は項目を削除してください。',
    });
  }

  const location = findNodeLocation(normalized, {
    type: 'item',
    id: input.itemId,
  });

  const next = cloneNormalizedDescription(normalized);
  const parentChildren = getChildListRef(next, location.parentGroupId);
  parentChildren.splice(location.index, 1);

  const nextItems = { ...next.items };
  delete nextItems[input.itemId];
  next.items = nextItems;
  next.excludedItems = {
    ...next.excludedItems,
    [input.itemId]: cloneItemFields(current),
  };
  next.sourceSchemaVersion = '1.3';
  return { status: 'updated', normalized: next };
}
