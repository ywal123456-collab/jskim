import type {
  DescriptionDocumentValidationError,
  NormalizedDescription,
  SpecNodeRef,
} from './types.js';
import { createDescriptionDocumentError } from './errors.js';

const MAX_GROUP_DEPTH = 8;

type VisitContext = {
  groupById: Map<string, NormalizedDescription['groups'][number]>;
  itemIds: Set<string>;
  excludedIds: Set<string>;
  placedGroups: Map<string, number>;
  placedItems: Map<string, number>;
  reachableGroups: Set<string>;
  reachableItems: Set<string>;
};

function resolveRefTarget(
  ref: SpecNodeRef,
  ctx: VisitContext,
): 'group' | 'item' | 'excluded' | 'missing' {
  if (ref.type === 'group') {
    if (ctx.groupById.has(ref.id)) {
      return 'group';
    }
    return 'missing';
  }
  if (ctx.excludedIds.has(ref.id)) {
    return 'excluded';
  }
  if (ctx.itemIds.has(ref.id)) {
    return 'item';
  }
  return 'missing';
}

function recordPlacement(
  kind: 'group' | 'item',
  id: string,
  ctx: VisitContext,
): DescriptionDocumentValidationError | null {
  const map = kind === 'group' ? ctx.placedGroups : ctx.placedItems;
  const count = (map.get(id) ?? 0) + 1;
  map.set(id, count);
  if (count > 1) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_NODE_DUPLICATE',
      `${kind === 'group' ? 'Group' : 'Item'}「${id}」が tree 上で重複配置されています。`,
    );
  }
  return null;
}

function walkNodes(
  refs: SpecNodeRef[],
  ctx: VisitContext,
  ancestorGroups: string[],
  depthFromRoot: number,
): DescriptionDocumentValidationError | null {
  for (const ref of refs) {
    const target = resolveRefTarget(ref, ctx);
    if (target === 'missing') {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_NODE_REFERENCE_NOT_FOUND',
        `存在しない node を参照しています: ${ref.type}「${ref.id}」`,
      );
    }
    if (target === 'excluded') {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_EXCLUDED_ITEM_IN_TREE',
        `除外 Item「${ref.id}」を tree に配置できません。`,
      );
    }
    if (ref.type === 'item') {
      const dup = recordPlacement('item', ref.id, ctx);
      if (dup) {
        return dup;
      }
      ctx.reachableItems.add(ref.id);
      continue;
    }

    if (ancestorGroups.includes(ref.id)) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_GROUP_CYCLE',
        `Group 循環参照が検出されました: ${ref.id}`,
      );
    }

    const dup = recordPlacement('group', ref.id, ctx);
    if (dup) {
      return dup;
    }
    const nextDepth = depthFromRoot + 1;
    if (nextDepth > MAX_GROUP_DEPTH) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_GROUP_DEPTH_EXCEEDED',
        `Group の深さが上限（${MAX_GROUP_DEPTH}）を超えています: ${ref.id}`,
      );
    }
    ctx.reachableGroups.add(ref.id);
    const group = ctx.groupById.get(ref.id)!;
    const childError = walkNodes(
      group.children,
      ctx,
      [...ancestorGroups, ref.id],
      nextDepth,
    );
    if (childError) {
      return childError;
    }
  }
  return null;
}

/**
 * v1.3 normalized tree の semantic validation。
 */
export function validateDescriptionTreeSemantics(
  normalized: NormalizedDescription,
): DescriptionDocumentValidationError | null {
  if (normalized.sourceSchemaVersion !== '1.3') {
    return null;
  }

  const ctx: VisitContext = {
    groupById: new Map(normalized.groups.map((group) => [group.groupId, group])),
    itemIds: new Set(Object.keys(normalized.items)),
    excludedIds: new Set(Object.keys(normalized.excludedItems)),
    placedGroups: new Map(),
    placedItems: new Map(),
    reachableGroups: new Set(),
    reachableItems: new Set(),
  };

  const walkError = walkNodes(normalized.rootNodes, ctx, [], 0);
  if (walkError) {
    return walkError;
  }

  for (const groupId of ctx.groupById.keys()) {
    if (!ctx.reachableGroups.has(groupId)) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_GROUP_ORPHAN',
        `rootNodes から到達できない Group 定義があります: ${groupId}`,
      );
    }
  }

  for (const itemId of ctx.itemIds) {
    if (!ctx.reachableItems.has(itemId)) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_ITEM_ORPHAN',
        `rootNodes から到達できない Item 定義があります: ${itemId}`,
      );
    }
  }

  return null;
}

export { MAX_GROUP_DEPTH };
