import { isValidItemId } from '../../util/screen-id.js';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
} from '../description-field-limits.js';
import { cloneNormalizedDescription } from './clone-normalized.js';
import { DescriptionDocumentError } from './errors.js';
import type { ItemDescriptionFields, NormalizedDescription } from './types.js';

const UPDATE_ITEM_KEYS = new Set(['itemId', 'name', 'type', 'description', 'note']);

export type UpdateItemInput = {
  itemId: string;
  name?: string;
  type?: string;
  description?: string;
  note?: string;
};

function assertUpdateItemInput(input: UpdateItemInput): void {
  for (const key of Object.keys(input)) {
    if (!UPDATE_ITEM_KEYS.has(key)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `updateItem に許可されていないフィールドがあります: ${key}`,
      });
    }
  }
  if (!isValidItemId(input.itemId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `itemId の形式が不正です: ${input.itemId}`,
    });
  }
  if (
    input.name === undefined &&
    input.type === undefined &&
    input.description === undefined &&
    input.note === undefined
  ) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'updateItem には name / type / description / note のいずれかが必要です。',
    });
  }
  for (const field of ['name', 'type', 'description', 'note'] as const) {
    const value = input[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'string') {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `${field} は文字列である必要があります。`,
      });
    }
    if (field === 'name' || field === 'type') {
      if (value.length > MAX_NAME_LENGTH) {
        throw new DescriptionDocumentError({
          code: 'SPEC_DESCRIPTION_INVALID',
          message: `${field} は${MAX_NAME_LENGTH}文字以内である必要があります。`,
        });
      }
    } else if (value.length > MAX_DESCRIPTION_LENGTH) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `${field} は${MAX_DESCRIPTION_LENGTH}文字以内である必要があります。`,
      });
    }
  }
}

export type ApplyUpdateItemResult =
  | { status: 'updated'; normalized: NormalizedDescription }
  | { status: 'unchanged'; normalized: NormalizedDescription };

/**
 * active Item の metadata のみ更新する（tree 位置は不変）。
 */
export function applyUpdateItem(
  normalized: NormalizedDescription,
  input: UpdateItemInput,
): ApplyUpdateItemResult {
  assertUpdateItemInput(input);

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

  const nextItem: ItemDescriptionFields = {
    name: input.name !== undefined ? input.name : current.name,
    type: input.type !== undefined ? input.type : current.type,
    description:
      input.description !== undefined ? input.description : current.description,
    note: input.note !== undefined ? input.note : current.note,
  };

  if (
    nextItem.name === current.name &&
    nextItem.type === current.type &&
    nextItem.description === current.description &&
    nextItem.note === current.note
  ) {
    return { status: 'unchanged', normalized };
  }

  const next = cloneNormalizedDescription(normalized);
  next.items = {
    ...next.items,
    [input.itemId]: nextItem,
  };
  next.sourceSchemaVersion = '1.3';
  return { status: 'updated', normalized: next };
}
