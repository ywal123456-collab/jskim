import { isValidItemId } from '../../util/screen-id.js';
import { cloneNormalizedDescription } from './clone-normalized.js';
import { DescriptionDocumentError } from './errors.js';
import { findNodeLocation } from './find-node-location.js';
import { getChildListRef } from './tree-children.js';
import type { NormalizedDescription } from './types.js';

const DELETE_ITEM_KEYS = new Set(['itemId']);

export type DeleteItemInput = {
  itemId: string;
};

export type ApplyDeleteItemResult = {
  status: 'updated';
  normalized: NormalizedDescription;
};

function assertDeleteItemInput(input: DeleteItemInput): void {
  for (const key of Object.keys(input)) {
    if (!DELETE_ITEM_KEYS.has(key)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `deleteItem に許可されていないフィールドがあります: ${key}`,
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
 * manual-only active Item の定義と tree ref を同時に削除する（新 object を返す）。
 */
export function applyDeleteItem(
  normalized: NormalizedDescription,
  input: DeleteItemInput,
  collectedItemIds: readonly string[],
): ApplyDeleteItemResult {
  assertDeleteItemInput(input);

  const groupIds = new Set(normalized.groups.map((group) => group.groupId));
  if (groupIds.has(input.itemId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_NODE_NOT_FOUND',
      message: `Item が見つかりません: ${input.itemId}`,
    });
  }

  if (!normalized.items[input.itemId]) {
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
  if (collectedSet.has(input.itemId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_COLLECTED_ITEM_DELETE_NOT_ALLOWED',
      message:
        '実装画面と連携された項目は削除できません。設計対象に残すか、設計対象から除外してください。最新の画面設計書を再読み込みしてください。',
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
  next.sourceSchemaVersion = '1.3';
  return { status: 'updated', normalized: next };
}
