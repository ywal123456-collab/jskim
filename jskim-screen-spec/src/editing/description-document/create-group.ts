import { isValidItemId } from '../../util/screen-id.js';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
} from '../description-field-limits.js';
import { cloneNormalizedDescription } from './clone-normalized.js';
import { computeGroupDepthInTree } from './group-depth.js';
import { DescriptionDocumentError } from './errors.js';
import { ITEM_GROUP_KINDS, type ItemGroupKind, type NormalizedDescription } from './types.js';
import { MAX_GROUP_DEPTH } from './validate-description-tree-semantics.js';

const CREATE_GROUP_KEYS = new Set([
  'groupId',
  'name',
  'description',
  'kind',
  'parentGroupId',
  'insertIndex',
]);

export type CreateGroupInput = {
  groupId: string;
  name: string;
  description?: string | null;
  kind: ItemGroupKind;
  parentGroupId?: string;
  insertIndex?: number;
};

function assertCreateGroupInput(input: CreateGroupInput): void {
  for (const key of Object.keys(input)) {
    if (!CREATE_GROUP_KEYS.has(key)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `createGroup に許可されていないフィールドがあります: ${key}`,
      });
    }
  }
  if (!isValidItemId(input.groupId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `groupId の形式が不正です: ${input.groupId}`,
    });
  }
  if (typeof input.name !== 'string') {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'name は文字列である必要があります。',
    });
  }
  if (input.name.length > MAX_NAME_LENGTH) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `name は${MAX_NAME_LENGTH}文字以内である必要があります。`,
    });
  }
  if (input.description != null) {
    if (typeof input.description !== 'string') {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'description は文字列または null である必要があります。',
      });
    }
    if (input.description.length > MAX_DESCRIPTION_LENGTH) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `description は${MAX_DESCRIPTION_LENGTH}文字以内である必要があります。`,
      });
    }
  }
  if (!ITEM_GROUP_KINDS.includes(input.kind)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `kind が不正です: ${String(input.kind)}`,
    });
  }
  if (input.parentGroupId !== undefined) {
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
        code: 'SPEC_DESCRIPTION_GROUP_INSERT_INDEX_INVALID',
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
      code: 'SPEC_DESCRIPTION_GROUP_INSERT_INDEX_INVALID',
      message: 'insertIndex の値が不正です。',
    });
  }
  return insertIndex;
}

/**
 * normalized tree に空 Group を追加する（新 object を返す）。
 */
export function applyCreateGroup(
  normalized: NormalizedDescription,
  input: CreateGroupInput,
): NormalizedDescription {
  assertCreateGroupInput(input);

  const itemIds = new Set(Object.keys(normalized.items));
  const excludedIds = new Set(Object.keys(normalized.excludedItems));
  const groupIds = new Set(normalized.groups.map((group) => group.groupId));

  if (groupIds.has(input.groupId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_GROUP_ALREADY_EXISTS',
      message: `groupId が既に存在します: ${input.groupId}`,
    });
  }
  if (itemIds.has(input.groupId) || excludedIds.has(input.groupId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
      message: `groupId と itemId が衝突しています: ${input.groupId}`,
    });
  }

  let parentDepth = 0;
  if (input.parentGroupId !== undefined) {
    if (!groupIds.has(input.parentGroupId)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_GROUP_PARENT_NOT_FOUND',
        message: `親 Group が見つかりません: ${input.parentGroupId}`,
      });
    }
    const depth = computeGroupDepthInTree(
      input.parentGroupId,
      normalized.rootNodes,
      normalized.groups,
    );
    if (depth == null) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_GROUP_PARENT_NOT_FOUND',
        message: `親 Group が tree 上に存在しません: ${input.parentGroupId}`,
      });
    }
    parentDepth = depth;
  }

  const newGroupDepth = input.parentGroupId === undefined ? 1 : parentDepth + 1;
  if (newGroupDepth > MAX_GROUP_DEPTH) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_GROUP_DEPTH_EXCEEDED',
      message: `Group の深さが上限（${MAX_GROUP_DEPTH}）を超えています: ${input.groupId}`,
    });
  }

  const next = cloneNormalizedDescription(normalized);
  const newGroup = {
    groupId: input.groupId,
    name: input.name,
    kind: input.kind,
    children: [] as NormalizedDescription['groups'][number]['children'],
  } as NormalizedDescription['groups'][number];
  if (
    input.description != null &&
    input.description !== '' &&
    input.description !== undefined
  ) {
    newGroup.description = input.description;
  }
  next.groups.push(newGroup);

  const ref = { type: 'group' as const, id: input.groupId };
  if (input.parentGroupId === undefined) {
    const index = resolveInsertIndex(input.insertIndex, next.rootNodes.length);
    next.rootNodes.splice(index, 0, ref);
  } else {
    const parent = next.groups.find(
      (group) => group.groupId === input.parentGroupId,
    );
    if (!parent) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_GROUP_PARENT_NOT_FOUND',
        message: `親 Group が見つかりません: ${input.parentGroupId}`,
      });
    }
    const index = resolveInsertIndex(input.insertIndex, parent.children.length);
    parent.children.splice(index, 0, ref);
  }

  next.sourceSchemaVersion = '1.3';
  return next;
}
