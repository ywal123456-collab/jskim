import { isValidItemId } from '../../util/screen-id.js';
import { cloneNormalizedDescription } from './clone-normalized.js';
import { DescriptionDocumentError } from './errors.js';
import { findNodeLocation } from './find-node-location.js';
import type { ItemDescriptionFields, NormalizedDescription } from './types.js';

const RESTORE_ITEM_KEYS = new Set(['itemId']);

export type RestoreItemInput = {
  itemId: string;
};

export type ApplyRestoreItemResult = {
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

function assertRestoreItemInput(input: RestoreItemInput): void {
  for (const key of Object.keys(input)) {
    if (!RESTORE_ITEM_KEYS.has(key)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `restoreItem に許可されていないフィールドがあります: ${key}`,
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

function itemRefExistsInTree(
  normalized: NormalizedDescription,
  itemId: string,
): boolean {
  try {
    findNodeLocation(normalized, { type: 'item', id: itemId });
    return true;
  } catch (err) {
    if (
      err instanceof DescriptionDocumentError &&
      err.code === 'SPEC_DESCRIPTION_NODE_NOT_FOUND'
    ) {
      return false;
    }
    throw err;
  }
}

/**
 * excludedItems の Item を active items + rootNodes tail へ復元する（新 object を返す）。
 */
export function applyRestoreItem(
  normalized: NormalizedDescription,
  input: RestoreItemInput,
): ApplyRestoreItemResult {
  assertRestoreItemInput(input);

  const excluded = normalized.excludedItems[input.itemId];
  if (!excluded) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_NODE_NOT_FOUND',
      message: `Item が見つかりません: ${input.itemId}`,
    });
  }

  const groupIds = new Set(normalized.groups.map((group) => group.groupId));
  if (groupIds.has(input.itemId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
      message: `itemId と groupId が衝突しています: ${input.itemId}`,
    });
  }

  if (normalized.items[input.itemId]) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
      message: `itemId が既に存在します: ${input.itemId}`,
    });
  }

  if (itemRefExistsInTree(normalized, input.itemId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
      message: `tree 上に Item ref が既に存在します: ${input.itemId}`,
    });
  }

  const next = cloneNormalizedDescription(normalized);
  const nextExcluded = { ...next.excludedItems };
  delete nextExcluded[input.itemId];
  next.excludedItems = nextExcluded;
  next.items = {
    ...next.items,
    [input.itemId]: cloneItemFields(excluded),
  };
  next.rootNodes.push({ type: 'item', id: input.itemId });
  next.sourceSchemaVersion = '1.3';
  return { status: 'updated', normalized: next };
}
