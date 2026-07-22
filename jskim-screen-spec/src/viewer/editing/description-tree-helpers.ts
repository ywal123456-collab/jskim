import type {
  DescriptionTreeGetResponse,
  DescriptionTreeGroupRow,
  DescriptionTreeNodeRef,
  SelectedTreeNode,
} from './description-tree-types.js';

export function buildGroupMap(
  response: DescriptionTreeGetResponse | null,
): Map<string, DescriptionTreeGroupRow> {
  const map = new Map<string, DescriptionTreeGroupRow>();
  if (!response) {
    return map;
  }
  for (const raw of response.description.groups) {
    const groupId = typeof raw.groupId === 'string' ? raw.groupId : '';
    if (!groupId) {
      continue;
    }
    const children: DescriptionTreeNodeRef[] = [];
    if (Array.isArray(raw.children)) {
      for (const child of raw.children) {
        if (
          child &&
          typeof child === 'object' &&
          (child.type === 'group' || child.type === 'item') &&
          typeof child.id === 'string' &&
          child.id.length > 0
        ) {
          children.push({ type: child.type, id: child.id });
        }
      }
    }
    map.set(groupId, {
      groupId,
      name: typeof raw.name === 'string' ? raw.name : '',
      kind: typeof raw.kind === 'string' ? raw.kind : '',
      description: typeof raw.description === 'string' ? raw.description : undefined,
      children,
    });
  }
  return map;
}

export function createDefaultExpandedGroupIds(
  rootNodes: DescriptionTreeNodeRef[],
): Set<string> {
  const expanded = new Set<string>();
  for (const ref of rootNodes) {
    if (ref.type === 'group') {
      expanded.add(ref.id);
    }
  }
  return expanded;
}

export function pruneExpandedGroupIds(
  expanded: Set<string>,
  activeGroupIds: ReadonlySet<string>,
): Set<string> {
  const next = new Set<string>();
  for (const groupId of expanded) {
    if (activeGroupIds.has(groupId)) {
      next.add(groupId);
    }
  }
  return next;
}

/**
 * expanded 初期化済みかどうかで defaults 適用 / previous∩active を切り替える。
 * 空 Set を「未初期化」とみなさない。
 */
export function reconcileExpandedGroupIds(input: {
  activeGroupIds: ReadonlySet<string>;
  previousExpandedGroupIds: ReadonlySet<string>;
  defaultExpandedGroupIds: ReadonlySet<string>;
  initialized: boolean;
}): Set<string> {
  if (!input.initialized) {
    return pruneExpandedGroupIds(
      new Set(input.defaultExpandedGroupIds),
      input.activeGroupIds,
    );
  }
  return pruneExpandedGroupIds(
    new Set(input.previousExpandedGroupIds),
    input.activeGroupIds,
  );
}

/** @deprecated defaults を常に union するため same-screen reload には使わない */
export function mergeExpandedGroupIds(
  previous: Set<string>,
  defaults: Set<string>,
  activeGroupIds: ReadonlySet<string>,
): Set<string> {
  const merged = new Set<string>();
  for (const groupId of defaults) {
    if (activeGroupIds.has(groupId)) {
      merged.add(groupId);
    }
  }
  for (const groupId of previous) {
    if (activeGroupIds.has(groupId)) {
      merged.add(groupId);
    }
  }
  return merged;
}

export function isSelectedTreeNode(
  selected: SelectedTreeNode | null,
  ref: DescriptionTreeNodeRef,
): boolean {
  return selected?.type === ref.type && selected.id === ref.id;
}

/**
 * rootNodes から到達可能な active Group / Item ID を収集する。
 * groups[] / items 定義だけの orphan は含めない。
 */
export function collectActiveDescriptionTreeNodeIds(
  response: DescriptionTreeGetResponse,
): { groups: Set<string>; items: Set<string> } {
  const groupMap = buildGroupMap(response);
  const activeGroups = new Set<string>();
  const activeItems = new Set<string>();
  const visitedGroups = new Set<string>();
  const stack: DescriptionTreeNodeRef[] = [
    ...(response.description.rootNodes ?? []),
  ];

  while (stack.length > 0) {
    const ref = stack.pop()!;
    if (ref.type === 'item') {
      if (
        Object.prototype.hasOwnProperty.call(response.description.items, ref.id)
      ) {
        activeItems.add(ref.id);
      }
      continue;
    }
    if (visitedGroups.has(ref.id)) {
      continue;
    }
    visitedGroups.add(ref.id);
    const definition = groupMap.get(ref.id);
    if (!definition) {
      continue;
    }
    activeGroups.add(ref.id);
    for (const child of definition.children) {
      stack.push(child);
    }
  }

  return { groups: activeGroups, items: activeItems };
}

export function findActiveDescriptionGroup(
  response: DescriptionTreeGetResponse,
  groupId: string,
): DescriptionTreeGroupRow | null {
  const active = collectActiveDescriptionTreeNodeIds(response);
  if (!active.groups.has(groupId)) {
    return null;
  }
  return buildGroupMap(response).get(groupId) ?? null;
}

/** domain MAX_GROUP_DEPTH と同一（viewer は bundle 内定数を持つ）。 */
export const VIEWER_MAX_GROUP_DEPTH = 8;

/**
 * active tree 上の Group depth（root 直下 = 1）。到達不能なら null。
 * groups definition だけを見ず rootNodes から走査する。
 */
export function computeActiveGroupDepth(
  response: DescriptionTreeGetResponse,
  groupId: string,
): number | null {
  const groupMap = buildGroupMap(response);

  function walkRefs(
    refs: DescriptionTreeNodeRef[],
    depth: number,
  ): number | null {
    for (const ref of refs) {
      if (ref.type !== 'group') {
        continue;
      }
      if (ref.id === groupId) {
        return depth;
      }
      const group = groupMap.get(ref.id);
      if (group) {
        const found = walkRefs(group.children, depth + 1);
        if (found != null) {
          return found;
        }
      }
    }
    return null;
  }

  return walkRefs(response.description.rootNodes, 1);
}

/**
 * active tree 上の親 Group ID。
 * - null: rootNodes の直接 child
 * - string: 親 Group
 * - undefined: active tree に存在しない
 */
export function findActiveGroupParentId(
  response: DescriptionTreeGetResponse,
  groupId: string,
): string | null | undefined {
  const groupMap = buildGroupMap(response);

  for (const ref of response.description.rootNodes) {
    if (ref.type === 'group' && ref.id === groupId) {
      return null;
    }
  }

  function walk(
    refs: DescriptionTreeNodeRef[],
    parentId: string,
  ): string | null | undefined {
    for (const ref of refs) {
      if (ref.type !== 'group') {
        continue;
      }
      if (ref.id === groupId) {
        return parentId;
      }
      const group = groupMap.get(ref.id);
      if (group) {
        const found = walk(group.children, ref.id);
        if (found !== undefined) {
          return found;
        }
      }
    }
    return undefined;
  }

  for (const ref of response.description.rootNodes) {
    if (ref.type !== 'group') {
      continue;
    }
    const group = groupMap.get(ref.id);
    if (!group) {
      continue;
    }
    const found = walk(group.children, ref.id);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** root から groupId までの ancestor chain（groupId 自身を含む）。未到達なら []。 */
export function collectActiveGroupAncestorChain(
  response: DescriptionTreeGetResponse,
  groupId: string,
): string[] {
  const groupMap = buildGroupMap(response);

  function walk(
    refs: DescriptionTreeNodeRef[],
    chain: string[],
  ): string[] | null {
    for (const ref of refs) {
      if (ref.type !== 'group') {
        continue;
      }
      const nextChain = [...chain, ref.id];
      if (ref.id === groupId) {
        return nextChain;
      }
      const group = groupMap.get(ref.id);
      if (group) {
        const found = walk(group.children, nextChain);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  return walk(response.description.rootNodes, []) ?? [];
}

/**
 * groups / items / excludedItems の ID 集合（orphan definition 含む）。
 * Group create の client 側重複検査用。
 */
export function collectTakenDescriptionNodeIds(
  response: DescriptionTreeGetResponse,
): string[] {
  const ids = new Set<string>();
  for (const raw of response.description.groups) {
    if (typeof raw.groupId === 'string' && raw.groupId) {
      ids.add(raw.groupId);
    }
  }
  for (const itemId of Object.keys(response.description.items)) {
    ids.add(itemId);
  }
  const excluded = response.description.excludedItems;
  if (excluded && typeof excluded === 'object') {
    for (const itemId of Object.keys(excluded)) {
      ids.add(itemId);
    }
  }
  return [...ids];
}

/** active tree 上に node が存在するか（definition だけの orphan は false）。 */
export function nodeExistsInTree(
  response: DescriptionTreeGetResponse,
  node: SelectedTreeNode,
): boolean {
  const active = collectActiveDescriptionTreeNodeIds(response);
  if (node.type === 'group') {
    return active.groups.has(node.id);
  }
  return active.items.has(node.id);
}

export function countDirectChildren(group: DescriptionTreeGroupRow): number {
  return group.children.length;
}

export function countDescendantItems(
  groupId: string,
  groupMap: Map<string, DescriptionTreeGroupRow>,
): number {
  const group = groupMap.get(groupId);
  if (!group) {
    return 0;
  }
  let total = 0;
  const stack = [...group.children];
  while (stack.length > 0) {
    const ref = stack.pop()!;
    if (ref.type === 'item') {
      total += 1;
      continue;
    }
    const nested = groupMap.get(ref.id);
    if (nested) {
      stack.push(...nested.children);
    }
  }
  return total;
}

export function countDescendantGroups(
  groupId: string,
  groupMap: Map<string, DescriptionTreeGroupRow>,
): number {
  const group = groupMap.get(groupId);
  if (!group) {
    return 0;
  }
  let total = 0;
  const stack = [...group.children];
  while (stack.length > 0) {
    const ref = stack.pop()!;
    if (ref.type !== 'group') {
      continue;
    }
    total += 1;
    const nested = groupMap.get(ref.id);
    if (nested) {
      stack.push(...nested.children);
    }
  }
  return total;
}

export function itemDisplayName(
  response: DescriptionTreeGetResponse,
  itemId: string,
): string {
  const item = response.description.items[itemId];
  if (item?.name?.trim()) {
    return item.name.trim();
  }
  if (item?.type?.trim()) {
    return item.type.trim();
  }
  return itemId;
}
