import type { ItemGroup, NormalizedDescription, SpecNodeRef } from './types.js';

/**
 * tree 上の Group の深さ（root 直下 = 1）を返す。到達不能なら null。
 */
export function computeGroupDepthInTree(
  groupId: string,
  rootNodes: SpecNodeRef[],
  groups: ItemGroup[],
): number | null {
  const groupById = new Map(groups.map((group) => [group.groupId, group]));

  function walkRefs(refs: SpecNodeRef[], depth: number): number | null {
    for (const ref of refs) {
      if (ref.type !== 'group') {
        continue;
      }
      if (ref.id === groupId) {
        return depth;
      }
      const group = groupById.get(ref.id);
      if (group) {
        const found = walkRefs(group.children, depth + 1);
        if (found != null) {
          return found;
        }
      }
    }
    return null;
  }

  return walkRefs(rootNodes, 1);
}
