import { isValidItemId } from '../../util/screen-id.js';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
} from '../description-field-limits.js';
import { cloneNormalizedDescription } from './clone-normalized.js';
import { DescriptionDocumentError } from './errors.js';
import type { ItemDescriptionFields, NormalizedDescription } from './types.js';

const CREATE_ITEM_KEYS = new Set([
  'itemId',
  'name',
  'type',
  'description',
  'note',
  'parentGroupId',
  'insertIndex',
]);

export type CreateItemInput = {
  itemId: string;
  name: string;
  type: string;
  description: string;
  note: string;
  parentGroupId?: string | null;
  insertIndex?: number;
};

function assertCreateItemInput(input: CreateItemInput): void {
  for (const key of Object.keys(input)) {
    if (!CREATE_ITEM_KEYS.has(key)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `createItem に許可されていないフィールドがあります: ${key}`,
      });
    }
  }
  if (!isValidItemId(input.itemId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `itemId の形式が不正です: ${input.itemId}`,
    });
  }
  for (const field of ['name', 'type'] as const) {
    if (typeof input[field] !== 'string') {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `${field} は文字列である必要があります。`,
      });
    }
    if (input[field].length > MAX_NAME_LENGTH) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `${field} は${MAX_NAME_LENGTH}文字以内である必要があります。`,
      });
    }
  }
  for (const field of ['description', 'note'] as const) {
    if (typeof input[field] !== 'string') {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `${field} は文字列である必要があります。`,
      });
    }
    if (input[field].length > MAX_DESCRIPTION_LENGTH) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `${field} は${MAX_DESCRIPTION_LENGTH}文字以内である必要があります。`,
      });
    }
  }
  if (input.parentGroupId != null) {
    if (typeof input.parentGroupId !== 'string' || !isValidItemId(input.parentGroupId)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'parentGroupId の形式が不正です。',
      });
    }
  }
  if (input.insertIndex !== undefined) {
    if (
      typeof input.insertIndex !== 'number' ||
      !Number.isInteger(input.insertIndex) ||
      input.insertIndex < 0
    ) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_ITEM_INSERT_INDEX_INVALID',
        message: 'insertIndex の値が不正です。',
      });
    }
  }
}

function resolveInsertIndex(
  insertIndex: number | undefined,
  length: number,
): number {
  if (insertIndex === undefined) {
    return length;
  }
  if (insertIndex > length) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_ITEM_INSERT_INDEX_INVALID',
      message: 'insertIndex の値が不正です。',
    });
  }
  return insertIndex;
}

/**
 * manual Item 定義と tree ref を同時に追加する（新 object を返す）。
 */
export function applyCreateItem(
  normalized: NormalizedDescription,
  input: CreateItemInput,
): NormalizedDescription {
  assertCreateItemInput(input);

  const itemIds = new Set(Object.keys(normalized.items));
  const excludedIds = new Set(Object.keys(normalized.excludedItems));
  const groupIds = new Set(normalized.groups.map((group) => group.groupId));

  if (itemIds.has(input.itemId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
      message: `itemId が既に存在します: ${input.itemId}`,
    });
  }
  if (excludedIds.has(input.itemId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
      message: `itemId が excludedItems と衝突しています: ${input.itemId}`,
    });
  }
  if (groupIds.has(input.itemId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
      message: `itemId と groupId が衝突しています: ${input.itemId}`,
    });
  }

  const parentGroupId =
    input.parentGroupId === null || input.parentGroupId === undefined
      ? undefined
      : input.parentGroupId;

  if (parentGroupId !== undefined) {
    if (!groupIds.has(parentGroupId)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_GROUP_PARENT_NOT_FOUND',
        message: `親 Group が見つかりません: ${parentGroupId}`,
      });
    }
    if (itemIds.has(parentGroupId)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_GROUP_PARENT_NOT_FOUND',
        message: `親 Group が見つかりません: ${parentGroupId}`,
      });
    }
  }

  const next = cloneNormalizedDescription(normalized);
  const fields: ItemDescriptionFields = {
    name: input.name,
    type: input.type,
    description: input.description,
    note: input.note,
  };
  next.items = {
    ...next.items,
    [input.itemId]: fields,
  };

  const ref = { type: 'item' as const, id: input.itemId };
  if (parentGroupId === undefined) {
    const index = resolveInsertIndex(input.insertIndex, next.rootNodes.length);
    next.rootNodes.splice(index, 0, ref);
  } else {
    const parent = next.groups.find((group) => group.groupId === parentGroupId);
    if (!parent) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_GROUP_PARENT_NOT_FOUND',
        message: `親 Group が見つかりません: ${parentGroupId}`,
      });
    }
    const index = resolveInsertIndex(input.insertIndex, parent.children.length);
    parent.children.splice(index, 0, ref);
  }

  next.sourceSchemaVersion = '1.3';
  return next;
}
