import { DescriptionDocumentError } from './errors.js';
import type { NormalizedDescription, SpecNodeRef } from './types.js';

/**
 * parentGroupId=null のとき rootNodes、それ以外は Group.children を返す（参照）。
 */
export function getChildListRef(
  normalized: NormalizedDescription,
  parentGroupId: string | null,
): SpecNodeRef[] {
  if (parentGroupId === null) {
    return normalized.rootNodes;
  }
  const group = normalized.groups.find((entry) => entry.groupId === parentGroupId);
  if (!group) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
      message: `Group が見つかりません: ${parentGroupId}`,
    });
  }
  return group.children;
}
