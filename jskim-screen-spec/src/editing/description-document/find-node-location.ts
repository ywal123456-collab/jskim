import { DescriptionDocumentError } from './errors.js';
import type { ItemGroup, NormalizedDescription, SpecNodeRef } from './types.js';
import { specNodeRefEquals } from './spec-node-ref.js';

export type NodeLocation = {
  node: SpecNodeRef;
  /** null は rootNodes を表す */
  parentGroupId: string | null;
  index: number;
};

function walkRefs(
  refs: SpecNodeRef[],
  parentGroupId: string | null,
  groupById: Map<string, ItemGroup>,
  target: SpecNodeRef,
  found: NodeLocation[],
): void {
  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index];
    if (specNodeRefEquals(ref, target)) {
      found.push({
        node: { type: ref.type, id: ref.id },
        parentGroupId,
        index,
      });
    }
    if (ref.type === 'group') {
      const group = groupById.get(ref.id);
      if (group) {
        walkRefs(group.children, ref.id, groupById, target, found);
      }
    }
  }
}

/**
 * tree 上の node 位置を決定的に返す。入力 normalized は変更しない。
 */
export function findNodeLocation(
  normalized: NormalizedDescription,
  target: SpecNodeRef,
): NodeLocation {
  const groupById = new Map(normalized.groups.map((group) => [group.groupId, group]));
  const found: NodeLocation[] = [];
  walkRefs(normalized.rootNodes, null, groupById, target, found);

  if (found.length === 0) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_NODE_NOT_FOUND',
      message: `tree 上に node が見つかりません: ${target.type}:${target.id}`,
    });
  }
  if (found.length > 1) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `node が tree 上に重複しています: ${target.type}:${target.id}`,
    });
  }
  return found[0];
}
