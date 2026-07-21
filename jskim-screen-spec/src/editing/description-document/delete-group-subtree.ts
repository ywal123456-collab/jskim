import { isValidItemId } from '../../util/screen-id.js';
import { collectGroupSubtree } from './collect-group-subtree.js';
import { cloneNormalizedDescription } from './clone-normalized.js';
import { findNodeLocation } from './find-node-location.js';
import { DescriptionDocumentError } from './errors.js';
import { getChildListRef } from './tree-children.js';
import type { NormalizedDescription } from './types.js';

const DELETE_GROUP_SUBTREE_KEYS = new Set(['groupId']);

export type DeleteGroupSubtreeInput = {
  groupId: string;
};

export type ApplyDeleteGroupSubtreeResult = {
  status: 'updated';
  normalized: NormalizedDescription;
};

function assertDeleteGroupSubtreeInput(input: DeleteGroupSubtreeInput): void {
  for (const key of Object.keys(input)) {
    if (!DELETE_GROUP_SUBTREE_KEYS.has(key)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `deleteGroupSubtree に許可されていないフィールドがあります: ${key}`,
      });
    }
  }
  if (!isValidItemId(input.groupId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `groupId の形式が不正です: ${input.groupId}`,
    });
  }
}

/**
 * Group subtree を削除する（manual-only Item 定義も items から除去）。
 * collected Item が subtree に 1 つでも含まれる場合は operation 全体を拒否する。
 */
export function applyDeleteGroupSubtree(
  normalized: NormalizedDescription,
  input: DeleteGroupSubtreeInput,
  collectedItemIds: readonly string[],
): ApplyDeleteGroupSubtreeResult {
  assertDeleteGroupSubtreeInput(input);

  const subtree = collectGroupSubtree(normalized, input.groupId);
  const collectedSet = new Set(collectedItemIds);
  for (const itemId of subtree.itemIds) {
    if (collectedSet.has(itemId)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_GROUP_SUBTREE_CONTAINS_COLLECTED_ITEM',
        message: `subtree に collected Item が含まれるため削除できません: ${itemId}`,
      });
    }
  }

  const location = findNodeLocation(normalized, {
    type: 'group',
    id: input.groupId,
  });

  const next = cloneNormalizedDescription(normalized);
  const parentChildren = getChildListRef(next, location.parentGroupId);
  parentChildren.splice(location.index, 1);

  const removeGroupIds = new Set(subtree.groupIds);
  next.groups = next.groups.filter((entry) => !removeGroupIds.has(entry.groupId));

  const removeItemIds = new Set(subtree.itemIds);
  for (const itemId of removeItemIds) {
    delete next.items[itemId];
  }

  next.sourceSchemaVersion = '1.3';
  return { status: 'updated', normalized: next };
}
