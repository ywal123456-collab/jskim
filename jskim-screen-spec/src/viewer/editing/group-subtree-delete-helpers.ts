/**
 * Group subtree 削除の active-tree capture / authoritative 分類。
 * Ungroup（昇格）とは別契約として対象消滅のみを検証する。
 */

import {
  buildGroupMap,
  collectActiveDescriptionTreeNodeIds,
  findActiveDescriptionGroup,
  findActiveGroupParentId,
} from './description-tree-helpers.js';
import type {
  DescriptionTreeGetResponse,
  DescriptionTreeNodeRef,
} from './description-tree-types.js';

export type SubtreeDeleteNodeRef = {
  type: 'group' | 'item';
  id: string;
};

export type GroupSubtreeDeleteCapture = {
  groupId: string;
  name: string;
  parentGroupId: string | null;
  parentName: string | null;
  targetIndex: number;
  previousSibling: SubtreeDeleteNodeRef | null;
  nextSibling: SubtreeDeleteNodeRef | null;
  /** 対象 Group 自身を含む */
  subtreeGroupIds: string[];
  subtreeItemIds: string[];
  descendantGroupCount: number;
  itemCount: number;
  containsCollectedItem: boolean;
};

export type GroupSubtreeDeleteClassification =
  | { kind: 'match-exact' }
  | { kind: 'revision-diverged' }
  | { kind: 'target-still-present' }
  | { kind: 'partial-delete' }
  | { kind: 'incomplete-response' };

function toNodeRef(ref: DescriptionTreeNodeRef): SubtreeDeleteNodeRef | null {
  if (
    (ref.type === 'group' || ref.type === 'item') &&
    typeof ref.id === 'string' &&
    ref.id.length > 0
  ) {
    return { type: ref.type, id: ref.id };
  }
  return null;
}

function getContainerChildren(
  response: DescriptionTreeGetResponse,
  parentGroupId: string | null,
): DescriptionTreeNodeRef[] | null {
  if (parentGroupId === null) {
    return response.description.rootNodes;
  }
  const parent = findActiveDescriptionGroup(response, parentGroupId);
  if (!parent) {
    return null;
  }
  return parent.children;
}

function collectSubtreeIds(
  response: DescriptionTreeGetResponse,
  groupId: string,
): { groupIds: string[]; itemIds: string[] } | null {
  const groupMap = buildGroupMap(response);
  if (!groupMap.has(groupId)) {
    return null;
  }
  const groupIds: string[] = [];
  const itemIds: string[] = [];

  function walk(id: string): void {
    groupIds.push(id);
    const group = groupMap.get(id);
    if (!group) {
      return;
    }
    for (const child of group.children) {
      if (child.type === 'item') {
        itemIds.push(child.id);
      } else if (child.type === 'group') {
        walk(child.id);
      }
    }
  }

  walk(groupId);
  return { groupIds, itemIds };
}

/**
 * active tree 上の Group subtree 削除用 context をキャプチャする。
 * 入力 response は変更しない。
 */
export function captureActiveGroupSubtree(
  response: DescriptionTreeGetResponse,
  groupId: string,
): GroupSubtreeDeleteCapture | null {
  const group = findActiveDescriptionGroup(response, groupId);
  if (!group) {
    return null;
  }
  const collected = collectSubtreeIds(response, groupId);
  if (!collected) {
    return null;
  }

  const parentGroupId = findActiveGroupParentId(response, groupId) ?? null;
  // findActiveGroupParentId は未到達時 undefined。capture 不能として扱う。
  if (
    parentGroupId === null &&
    !response.description.rootNodes.some(
      (ref) => ref.type === 'group' && ref.id === groupId,
    )
  ) {
    return null;
  }
  const siblings = getContainerChildren(response, parentGroupId);
  if (!siblings) {
    return null;
  }
  const targetIndex = siblings.findIndex(
    (ref) => ref.type === 'group' && ref.id === groupId,
  );
  if (targetIndex < 0) {
    return null;
  }

  const previousSibling =
    targetIndex > 0 ? toNodeRef(siblings[targetIndex - 1]!) : null;
  const nextSibling =
    targetIndex < siblings.length - 1
      ? toNodeRef(siblings[targetIndex + 1]!)
      : null;

  const collectedSet = new Set(response.collectedItemIds ?? []);
  const containsCollectedItem = collected.itemIds.some((id) =>
    collectedSet.has(id),
  );

  let parentName: string | null = null;
  if (parentGroupId != null) {
    const parent = findActiveDescriptionGroup(response, parentGroupId);
    parentName = parent?.name?.trim() || null;
  }

  return {
    groupId,
    name: group.name,
    parentGroupId,
    parentName,
    targetIndex,
    previousSibling,
    nextSibling,
    subtreeGroupIds: collected.groupIds,
    subtreeItemIds: collected.itemIds,
    descendantGroupCount: Math.max(0, collected.groupIds.length - 1),
    itemCount: collected.itemIds.length,
    containsCollectedItem,
  };
}

export function matchesGroupSubtreeDeleteCapture(
  response: DescriptionTreeGetResponse,
  capture: GroupSubtreeDeleteCapture,
): boolean {
  const current = captureActiveGroupSubtree(response, capture.groupId);
  if (!current) {
    return false;
  }
  return (
    current.parentGroupId === capture.parentGroupId &&
    current.targetIndex === capture.targetIndex &&
    current.previousSibling?.type === capture.previousSibling?.type &&
    current.previousSibling?.id === capture.previousSibling?.id &&
    current.nextSibling?.type === capture.nextSibling?.type &&
    current.nextSibling?.id === capture.nextSibling?.id &&
    current.subtreeGroupIds.length === capture.subtreeGroupIds.length &&
    current.subtreeGroupIds.every((id, i) => id === capture.subtreeGroupIds[i]) &&
    current.subtreeItemIds.length === capture.subtreeItemIds.length &&
    current.subtreeItemIds.every((id, i) => id === capture.subtreeItemIds[i])
  );
}

export function isNodeInGroupSubtreeCapture(
  node: { type: 'group' | 'item'; id: string },
  capture: GroupSubtreeDeleteCapture,
): boolean {
  if (node.type === 'group') {
    return capture.subtreeGroupIds.includes(node.id);
  }
  return capture.subtreeItemIds.includes(node.id);
}

/**
 * authoritative GET 結果を capture と照合する。
 */
export function classifyGroupSubtreeDeletion(
  response: DescriptionTreeGetResponse,
  capture: GroupSubtreeDeleteCapture,
  options: {
    mutationRevision: string | null;
    captureRevision?: string | null;
  },
): GroupSubtreeDeleteClassification {
  const description = response.description;
  if (
    !description ||
    !Array.isArray(description.rootNodes) ||
    !Array.isArray(description.groups) ||
    typeof description.items !== 'object' ||
    description.items == null ||
    typeof response.revision !== 'string' ||
    response.revision.length === 0
  ) {
    return { kind: 'incomplete-response' };
  }

  const active = collectActiveDescriptionTreeNodeIds(response);
  const remainingGroups = capture.subtreeGroupIds.filter((id) =>
    active.groups.has(id),
  );
  const remainingItems = capture.subtreeItemIds.filter((id) =>
    active.items.has(id),
  );
  const fullyGone =
    remainingGroups.length === 0 && remainingItems.length === 0;
  const fullyPresent =
    remainingGroups.length === capture.subtreeGroupIds.length &&
    remainingItems.length === capture.subtreeItemIds.length;
  const targetPresent = active.groups.has(capture.groupId);

  if (
    options.mutationRevision != null &&
    response.revision === options.mutationRevision &&
    fullyGone
  ) {
    return { kind: 'match-exact' };
  }

  if (!fullyGone && !fullyPresent) {
    return { kind: 'partial-delete' };
  }

  if (targetPresent || !fullyGone) {
    if (
      options.captureRevision != null &&
      response.revision === options.captureRevision
    ) {
      return { kind: 'target-still-present' };
    }
    if (
      options.mutationRevision != null &&
      response.revision !== options.mutationRevision
    ) {
      return { kind: 'revision-diverged' };
    }
    if (
      options.captureRevision != null &&
      response.revision !== options.captureRevision
    ) {
      return { kind: 'revision-diverged' };
    }
    return { kind: 'target-still-present' };
  }

  // fullyGone だが mutationRevision 一致なし → 曖昧
  if (
    options.mutationRevision != null &&
    response.revision !== options.mutationRevision
  ) {
    return { kind: 'revision-diverged' };
  }

  return { kind: 'revision-diverged' };
}
