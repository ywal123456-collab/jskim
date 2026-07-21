import type { NormalizedDescription, SpecNodeRef } from './types.js';

/**
 * normalized tree を depth-first pre-order で flatten し active itemId[] を返す。
 * Group は含めず、excluded Item も含めない。入力は変更しない。
 */
export function flattenItemTree(normalized: NormalizedDescription): string[] {
  const result: string[] = [];
  const groupById = new Map(
    normalized.groups.map((group) => [group.groupId, group]),
  );

  function visitNode(ref: SpecNodeRef): void {
    if (ref.type === 'item') {
      result.push(ref.id);
      return;
    }
    const group = groupById.get(ref.id);
    if (!group) {
      return;
    }
    for (const child of group.children) {
      visitNode(child);
    }
  }

  for (const ref of normalized.rootNodes) {
    visitNode(ref);
  }

  return result;
}
