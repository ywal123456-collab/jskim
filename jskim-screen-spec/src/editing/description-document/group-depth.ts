import type { ItemGroup, NormalizedDescription, SpecNodeRef } from './types.js';

/**
 * Group subtree の最大 relative depth（自身 = 1）を返す。
 */
export function computeGroupSubtreeMaxRelativeDepth(
  groupId: string,
  groups: ItemGroup[],
): number {
  const groupById = new Map(groups.map((group) => [group.groupId, group]));
  return walkSubtreeMaxDepth(groupId, groupById);
}

function walkSubtreeMaxDepth(
  groupId: string,
  groupById: Map<string, ItemGroup>,
): number {
  const group = groupById.get(groupId);
  if (!group) {
    return 1;
  }
  let maxChild = 0;
  for (const child of group.children) {
    if (child.type === 'group') {
      maxChild = Math.max(
        maxChild,
        walkSubtreeMaxDepth(child.id, groupById),
      );
    }
  }
  return 1 + maxChild;
}

/**
 * candidateGroupId が ancestorGroupId の subtree 内（自身含む）なら true。
 */
export function isGroupInSubtree(
  candidateGroupId: string,
  ancestorGroupId: string,
  groups: ItemGroup[],
): boolean {
  if (candidateGroupId === ancestorGroupId) {
    return true;
  }
  const groupById = new Map(groups.map((group) => [group.groupId, group]));
  const ancestor = groupById.get(ancestorGroupId);
  if (!ancestor) {
    return false;
  }
  return walkContainsGroup(candidateGroupId, ancestor.children, groupById);
}

function walkContainsGroup(
  candidateGroupId: string,
  refs: SpecNodeRef[],
  groupById: Map<string, ItemGroup>,
): boolean {
  for (const ref of refs) {
    if (ref.type !== 'group') {
      continue;
    }
    if (ref.id === candidateGroupId) {
      return true;
    }
    const group = groupById.get(ref.id);
    if (group && walkContainsGroup(candidateGroupId, group.children, groupById)) {
      return true;
    }
  }
  return false;
}

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
