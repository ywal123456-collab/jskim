/**
 * Group ungroup（deleteGroup）の active-tree capture / authoritative 分類。
 * domain applyDeleteGroup の昇格契約を Viewer 側で厳密検証する。
 */

import {
  cloneItemFields,
  itemFieldsEqual,
  type ItemFields,
} from './description-editor-helpers.js';
import {
  buildGroupMap,
  collectActiveDescriptionTreeNodeIds,
  computeActiveGroupDepth,
  findActiveDescriptionGroup,
  findActiveGroupParentId,
} from './description-tree-helpers.js';
import type {
  DescriptionTreeGetResponse,
  DescriptionTreeNodeRef,
} from './description-tree-types.js';

export type UngroupChildRef = {
  type: 'group' | 'item';
  id: string;
};

/** Item definition schema 全体（UI-only / revision は含めない） */
export type UngroupItemFieldSnapshot = ItemFields;

export type UngroupGroupSubtreeSnapshot = {
  groupId: string;
  name: string;
  kind: string;
  description: string | null;
  children: UngroupChildRef[];
};

export type UngroupCaptureSnapshot = {
  groupId: string;
  name: string;
  kind: string;
  description: string | null;
  parentGroupId: string | null;
  parentName: string | null;
  depth: number;
  targetIndex: number;
  directChildren: UngroupChildRef[];
  siblingOrder: UngroupChildRef[];
  /** promoted subtree の Item definition 全体 */
  itemSnapshots: Record<string, UngroupItemFieldSnapshot>;
  /** promoted subtree の Group metadata + children 順序 */
  groupSnapshots: Record<string, UngroupGroupSubtreeSnapshot>;
};

export type UngroupClassification =
  | { kind: 'match-exact' }
  | { kind: 'revision-diverged' }
  | { kind: 'target-still-present' }
  | { kind: 'definition-only' }
  | { kind: 'active-only' }
  | { kind: 'former-parent-missing' }
  | { kind: 'exact-placement-mismatch' }
  | { kind: 'former-sibling-mismatch' }
  | { kind: 'child-missing'; childId: string }
  | { kind: 'child-excluded'; childId: string }
  | { kind: 'child-wrong-parent'; childId: string }
  | { kind: 'child-order-mismatch' }
  | { kind: 'item-metadata-mismatch'; childId: string }
  | { kind: 'group-metadata-mismatch'; childId: string }
  | { kind: 'group-descendant-mismatch'; childId: string };

function toChildRef(ref: DescriptionTreeNodeRef): UngroupChildRef | null {
  if (
    (ref.type === 'group' || ref.type === 'item') &&
    typeof ref.id === 'string' &&
    ref.id.length > 0
  ) {
    return { type: ref.type, id: ref.id };
  }
  return null;
}

function refsEqual(a: UngroupChildRef, b: UngroupChildRef): boolean {
  return a.type === b.type && a.id === b.id;
}

function refListsEqual(a: UngroupChildRef[], b: UngroupChildRef[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((entry, index) => refsEqual(entry, b[index]!));
}

function normalizeGroupDescription(
  value: string | undefined | null,
): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function groupSnapshotsEqual(
  a: UngroupGroupSubtreeSnapshot,
  b: UngroupGroupSubtreeSnapshot,
): boolean {
  return (
    a.groupId === b.groupId &&
    a.name === b.name &&
    a.kind === b.kind &&
    a.description === b.description &&
    refListsEqual(a.children, b.children)
  );
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

function collectPromotedSubtreeSnapshots(
  response: DescriptionTreeGetResponse,
  directChildren: UngroupChildRef[],
): {
  itemSnapshots: Record<string, UngroupItemFieldSnapshot>;
  groupSnapshots: Record<string, UngroupGroupSubtreeSnapshot>;
} {
  const groupMap = buildGroupMap(response);
  const itemSnapshots: Record<string, UngroupItemFieldSnapshot> = {};
  const groupSnapshots: Record<string, UngroupGroupSubtreeSnapshot> = {};

  function walkGroup(groupId: string): void {
    if (groupSnapshots[groupId]) {
      return;
    }
    const group = groupMap.get(groupId);
    if (!group) {
      return;
    }
    const children: UngroupChildRef[] = [];
    for (const ref of group.children) {
      const child = toChildRef(ref);
      if (child) {
        children.push(child);
      }
    }
    groupSnapshots[groupId] = {
      groupId: group.groupId,
      name: group.name,
      kind: group.kind,
      description: normalizeGroupDescription(group.description),
      children,
    };
    for (const child of children) {
      if (child.type === 'group') {
        walkGroup(child.id);
      } else {
        const item = response.description.items[child.id];
        if (item && !itemSnapshots[child.id]) {
          itemSnapshots[child.id] = cloneItemFields(item);
        }
      }
    }
  }

  for (const child of directChildren) {
    if (child.type === 'group') {
      walkGroup(child.id);
    } else {
      const item = response.description.items[child.id];
      if (item) {
        itemSnapshots[child.id] = cloneItemFields(item);
      }
    }
  }

  return { itemSnapshots, groupSnapshots };
}

/**
 * siblingOrder の target を directChildren で置換した expected container。
 */
export function buildExpectedContainerAfterUngroup(
  siblingOrder: UngroupChildRef[],
  targetGroupId: string,
  directChildren: UngroupChildRef[],
): UngroupChildRef[] | null {
  const index = siblingOrder.findIndex(
    (ref) => ref.type === 'group' && ref.id === targetGroupId,
  );
  if (index < 0) {
    return null;
  }
  return [
    ...siblingOrder.slice(0, index),
    ...directChildren,
    ...siblingOrder.slice(index + 1),
  ];
}

/**
 * active tree 上の Group 解除用 context をキャプチャする。
 */
export function captureActiveGroupUngroupContext(
  response: DescriptionTreeGetResponse,
  groupId: string,
): UngroupCaptureSnapshot | null {
  const group = findActiveDescriptionGroup(response, groupId);
  if (!group) {
    return null;
  }
  const parentGroupId = findActiveGroupParentId(response, groupId);
  if (parentGroupId === undefined) {
    return null;
  }
  const depth = computeActiveGroupDepth(response, groupId);
  if (depth == null) {
    return null;
  }
  const container = getContainerChildren(response, parentGroupId);
  if (!container) {
    return null;
  }
  const targetIndex = container.findIndex(
    (ref) => ref.type === 'group' && ref.id === groupId,
  );
  if (targetIndex < 0) {
    return null;
  }

  const siblingOrder: UngroupChildRef[] = [];
  for (const ref of container) {
    const child = toChildRef(ref);
    if (child) {
      siblingOrder.push(child);
    }
  }

  const directChildren: UngroupChildRef[] = [];
  for (const ref of group.children) {
    const child = toChildRef(ref);
    if (child) {
      directChildren.push(child);
    }
  }

  let parentName: string | null = null;
  if (parentGroupId != null) {
    const parent = buildGroupMap(response).get(parentGroupId);
    parentName = parent?.name ?? null;
  }

  const { itemSnapshots, groupSnapshots } = collectPromotedSubtreeSnapshots(
    response,
    directChildren,
  );

  return {
    groupId,
    name: group.name,
    kind: group.kind,
    description: normalizeGroupDescription(group.description),
    parentGroupId,
    parentName,
    depth,
    targetIndex,
    directChildren,
    siblingOrder,
    itemSnapshots,
    groupSnapshots,
  };
}

/**
 * submit 直前: capture と live tree の parent/sibling/children/metadata が一致するか。
 */
export function matchesUngroupCapture(
  response: DescriptionTreeGetResponse,
  capture: UngroupCaptureSnapshot,
): boolean {
  const live = captureActiveGroupUngroupContext(response, capture.groupId);
  if (!live) {
    return false;
  }
  if (live.parentGroupId !== capture.parentGroupId) {
    return false;
  }
  if (live.targetIndex !== capture.targetIndex) {
    return false;
  }
  if (live.name !== capture.name || live.kind !== capture.kind) {
    return false;
  }
  if (live.description !== capture.description) {
    return false;
  }
  if (!refListsEqual(live.siblingOrder, capture.siblingOrder)) {
    return false;
  }
  if (!refListsEqual(live.directChildren, capture.directChildren)) {
    return false;
  }

  const captureItemIds = Object.keys(capture.itemSnapshots).sort();
  const liveItemIds = Object.keys(live.itemSnapshots).sort();
  if (captureItemIds.length !== liveItemIds.length) {
    return false;
  }
  for (let i = 0; i < captureItemIds.length; i += 1) {
    if (captureItemIds[i] !== liveItemIds[i]) {
      return false;
    }
    const id = captureItemIds[i]!;
    if (
      !itemFieldsEqual(capture.itemSnapshots[id]!, live.itemSnapshots[id]!)
    ) {
      return false;
    }
  }

  const captureGroupIds = Object.keys(capture.groupSnapshots).sort();
  const liveGroupIds = Object.keys(live.groupSnapshots).sort();
  if (captureGroupIds.length !== liveGroupIds.length) {
    return false;
  }
  for (let i = 0; i < captureGroupIds.length; i += 1) {
    if (captureGroupIds[i] !== liveGroupIds[i]) {
      return false;
    }
    const id = captureGroupIds[i]!;
    if (
      !groupSnapshotsEqual(
        capture.groupSnapshots[id]!,
        live.groupSnapshots[id]!,
      )
    ) {
      return false;
    }
  }

  return true;
}

function findDirectParentOfNode(
  response: DescriptionTreeGetResponse,
  node: UngroupChildRef,
): string | null | undefined {
  const groupMap = buildGroupMap(response);

  function walk(
    refs: DescriptionTreeNodeRef[],
    parentId: string | null,
  ): string | null | undefined {
    for (const ref of refs) {
      if (ref.type === node.type && ref.id === node.id) {
        return parentId;
      }
      if (ref.type === 'group') {
        const group = groupMap.get(ref.id);
        if (group) {
          const found = walk(group.children, ref.id);
          if (found !== undefined) {
            return found;
          }
        }
      }
    }
    return undefined;
  }

  return walk(response.description.rootNodes, null);
}

function containerToRefs(
  container: DescriptionTreeNodeRef[],
): UngroupChildRef[] {
  const refs: UngroupChildRef[] = [];
  for (const ref of container) {
    const child = toChildRef(ref);
    if (child) {
      refs.push(child);
    }
  }
  return refs;
}

function comparePromotedSemantics(
  response: DescriptionTreeGetResponse,
  capture: UngroupCaptureSnapshot,
): UngroupClassification | null {
  const live = collectPromotedSubtreeSnapshots(
    response,
    capture.directChildren,
  );

  for (const child of capture.directChildren) {
    if (child.type === 'item') {
      if (response.description.excludedItems?.[child.id]) {
        return { kind: 'child-excluded', childId: child.id };
      }
      if (!response.description.items[child.id]) {
        return { kind: 'child-missing', childId: child.id };
      }
      const expected = capture.itemSnapshots[child.id];
      const actual = live.itemSnapshots[child.id];
      if (!expected || !actual || !itemFieldsEqual(expected, actual)) {
        return { kind: 'item-metadata-mismatch', childId: child.id };
      }
    } else {
      const expected = capture.groupSnapshots[child.id];
      const actual = live.groupSnapshots[child.id];
      if (!expected || !actual) {
        return { kind: 'group-metadata-mismatch', childId: child.id };
      }
      if (
        expected.name !== actual.name ||
        expected.kind !== actual.kind ||
        expected.description !== actual.description
      ) {
        return { kind: 'group-metadata-mismatch', childId: child.id };
      }
      if (!refListsEqual(expected.children, actual.children)) {
        return { kind: 'group-descendant-mismatch', childId: child.id };
      }
    }
  }

  for (const groupId of Object.keys(capture.groupSnapshots)) {
    const expected = capture.groupSnapshots[groupId]!;
    const actual = live.groupSnapshots[groupId];
    if (!actual) {
      return { kind: 'group-descendant-mismatch', childId: groupId };
    }
    if (!groupSnapshotsEqual(expected, actual)) {
      if (
        expected.name !== actual.name ||
        expected.kind !== actual.kind ||
        expected.description !== actual.description
      ) {
        return { kind: 'group-metadata-mismatch', childId: groupId };
      }
      return { kind: 'group-descendant-mismatch', childId: groupId };
    }
  }

  for (const itemId of Object.keys(capture.itemSnapshots)) {
    if (response.description.excludedItems?.[itemId]) {
      return { kind: 'child-excluded', childId: itemId };
    }
    const expected = capture.itemSnapshots[itemId]!;
    const actual = live.itemSnapshots[itemId];
    if (!actual || !itemFieldsEqual(expected, actual)) {
      return { kind: 'item-metadata-mismatch', childId: itemId };
    }
  }

  return null;
}

/**
 * ungroup 後の authoritative Tree を分類する。
 * 成功は mutationRevision === GET revision かつ exact container + semantic 保全のみ。
 */
export function classifyGroupUngroupAuthoritative(
  response: DescriptionTreeGetResponse,
  capture: UngroupCaptureSnapshot,
  options: { mutationRevision: string | null },
): UngroupClassification {
  if (
    !options.mutationRevision ||
    response.revision !== options.mutationRevision
  ) {
    return { kind: 'revision-diverged' };
  }

  const groupMap = buildGroupMap(response);
  const active = collectActiveDescriptionTreeNodeIds(response);
  const definitionExists = groupMap.has(capture.groupId);
  const isActive = active.groups.has(capture.groupId);

  if (isActive && definitionExists) {
    return { kind: 'target-still-present' };
  }
  if (isActive && !definitionExists) {
    return { kind: 'active-only' };
  }
  if (!isActive && definitionExists) {
    return { kind: 'definition-only' };
  }

  const container = getContainerChildren(response, capture.parentGroupId);
  if (!container) {
    return { kind: 'former-parent-missing' };
  }

  for (const child of capture.directChildren) {
    if (child.type === 'item') {
      if (response.description.excludedItems?.[child.id]) {
        return { kind: 'child-excluded', childId: child.id };
      }
      if (!response.description.items[child.id] || !active.items.has(child.id)) {
        return { kind: 'child-missing', childId: child.id };
      }
    } else if (!active.groups.has(child.id)) {
      return { kind: 'child-missing', childId: child.id };
    }

    const actualParent = findDirectParentOfNode(response, child);
    if (actualParent === undefined) {
      return { kind: 'child-missing', childId: child.id };
    }
    if (actualParent !== capture.parentGroupId) {
      return { kind: 'child-wrong-parent', childId: child.id };
    }
  }

  const expected = buildExpectedContainerAfterUngroup(
    capture.siblingOrder,
    capture.groupId,
    capture.directChildren,
  );
  if (!expected) {
    return { kind: 'exact-placement-mismatch' };
  }

  const actualRefs = containerToRefs(container);
  if (!refListsEqual(actualRefs, expected)) {
    // children 相対順は正しいが sibling が違う場合を区別
    const promotedIds = new Set(
      capture.directChildren.map((child) => `${child.type}:${child.id}`),
    );
    const actualPromoted = actualRefs.filter((ref) =>
      promotedIds.has(`${ref.type}:${ref.id}`),
    );
    if (!refListsEqual(actualPromoted, capture.directChildren)) {
      return { kind: 'child-order-mismatch' };
    }
    return { kind: 'former-sibling-mismatch' };
  }

  const semanticMismatch = comparePromotedSemantics(response, capture);
  if (semanticMismatch) {
    return semanticMismatch;
  }

  return { kind: 'match-exact' };
}

export function countDirectChildGroups(children: UngroupChildRef[]): number {
  return children.filter((child) => child.type === 'group').length;
}

export function countDirectChildItems(children: UngroupChildRef[]): number {
  return children.filter((child) => child.type === 'item').length;
}
