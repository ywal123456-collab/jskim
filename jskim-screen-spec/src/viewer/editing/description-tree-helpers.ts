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
  groupMap: Map<string, DescriptionTreeGroupRow>,
): Set<string> {
  const next = new Set<string>();
  for (const groupId of expanded) {
    if (groupMap.has(groupId)) {
      next.add(groupId);
    }
  }
  return next;
}

export function mergeExpandedGroupIds(
  previous: Set<string>,
  defaults: Set<string>,
  groupMap: Map<string, DescriptionTreeGroupRow>,
): Set<string> {
  const merged = new Set<string>(defaults);
  for (const groupId of previous) {
    if (groupMap.has(groupId)) {
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

export function nodeExistsInTree(
  response: DescriptionTreeGetResponse,
  node: SelectedTreeNode,
): boolean {
  const groupMap = buildGroupMap(response);
  if (node.type === 'group') {
    return groupMap.has(node.id);
  }
  return Object.prototype.hasOwnProperty.call(response.description.items, node.id);
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
