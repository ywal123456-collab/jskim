import { DescriptionDocumentError } from './errors.js';
import type { NormalizedDescription } from './types.js';

export type GroupSubtreeCollection = {
  /** depth-first pre-order（対象 Group 自身を含む） */
  groupIds: string[];
  /** depth-first pre-order（tree 上の active Item） */
  itemIds: string[];
};

function walkGroupSubtree(
  normalized: NormalizedDescription,
  groupId: string,
  groupIds: string[],
  itemIds: string[],
): void {
  groupIds.push(groupId);
  const group = normalized.groups.find((entry) => entry.groupId === groupId);
  if (!group) {
    return;
  }
  for (const child of group.children) {
    if (child.type === 'item') {
      itemIds.push(child.id);
    } else {
      walkGroupSubtree(normalized, child.id, groupIds, itemIds);
    }
  }
}

/**
 * Group subtree を depth-first pre-order で収集する。入力 normalized は変更しない。
 */
export function collectGroupSubtree(
  normalized: NormalizedDescription,
  groupId: string,
): GroupSubtreeCollection {
  const group = normalized.groups.find((entry) => entry.groupId === groupId);
  if (!group) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
      message: `Group が見つかりません: ${groupId}`,
    });
  }
  const groupIds: string[] = [];
  const itemIds: string[] = [];
  walkGroupSubtree(normalized, groupId, groupIds, itemIds);
  return { groupIds, itemIds };
}
