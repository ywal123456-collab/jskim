/**
 * Item/Group 共通の tree move/reorder 計画と authoritative 分類。
 */

import {
  collectActiveGroupAncestorChain,
  findActiveDescriptionGroup,
  findActiveGroupParentId,
} from './description-tree-helpers.js';
import type {
  DescriptionTreeGetResponse,
  DescriptionTreeNodeRef,
} from './description-tree-types.js';

export type TreeNodeRef = {
  type: 'group' | 'item';
  id: string;
};

export type NodeSiblingContext = {
  node: TreeNodeRef;
  sourceParentGroupId: string | null;
  sourceIndex: number;
  sourceOrderedNodes: TreeNodeRef[];
};

export type NodeMoveCommandKind =
  | 'reorder-up'
  | 'reorder-down'
  | 'indent'
  | 'outdent';

export type ReorderMovePlan = {
  kind: 'reorder-up' | 'reorder-down';
  node: TreeNodeRef;
  sourceParentGroupId: string | null;
  sourceIndex: number;
  sourceOrderedNodes: TreeNodeRef[];
  destinationOrderedNodes: TreeNodeRef[];
};

export type IndentMovePlan = {
  kind: 'indent';
  node: TreeNodeRef;
  sourceParentGroupId: string | null;
  sourceIndex: number;
  sourceOrderedNodes: TreeNodeRef[];
  destinationParentGroupId: string;
  expandGroupIds: string[];
};

export type OutdentMovePlan = {
  kind: 'outdent';
  node: TreeNodeRef;
  sourceParentGroupId: string;
  sourceIndex: number;
  sourceOrderedNodes: TreeNodeRef[];
  destinationParentGroupId: string | null;
  destinationIndex: number;
};

export type NodeMovePlan = ReorderMovePlan | IndentMovePlan | OutdentMovePlan;

export type NodeMoveCapture = {
  node: TreeNodeRef;
  commandKind: NodeMoveCommandKind;
  captureRevision: string;
  sourceParentGroupId: string | null;
  sourceIndex: number;
  sourceOrderedNodes: TreeNodeRef[];
  expectedContainerOrderedNodes: TreeNodeRef[];
  destinationParentGroupId: string | null;
  destinationIndex: number | null;
  expandGroupIds?: string[];
};

export type NodeMoveClassification =
  | { kind: 'match-exact' }
  | { kind: 'definitely-not-committed' }
  | { kind: 'revision-diverged' }
  | { kind: 'node-missing' }
  | { kind: 'duplicate-placement' }
  | { kind: 'unexpected-position' }
  | { kind: 'order-mismatch' }
  | { kind: 'incomplete-response' };

function toTreeNodeRef(ref: DescriptionTreeNodeRef): TreeNodeRef | null {
  if (
    (ref.type === 'group' || ref.type === 'item') &&
    typeof ref.id === 'string' &&
    ref.id.length > 0
  ) {
    return { type: ref.type, id: ref.id };
  }
  return null;
}

function refsEqual(a: TreeNodeRef, b: TreeNodeRef): boolean {
  return a.type === b.type && a.id === b.id;
}

function refListsEqual(a: TreeNodeRef[], b: TreeNodeRef[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((entry, index) => refsEqual(entry, b[index]!));
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

function containerToRefs(container: DescriptionTreeNodeRef[]): TreeNodeRef[] {
  const refs: TreeNodeRef[] = [];
  for (const ref of container) {
    const node = toTreeNodeRef(ref);
    if (node) {
      refs.push(node);
    }
  }
  return refs;
}

function swapAtIndex(
  nodes: TreeNodeRef[],
  index: number,
  direction: -1 | 1,
): TreeNodeRef[] | null {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= nodes.length) {
    return null;
  }
  const next = nodes.map((entry) => ({ ...entry }));
  [next[index], next[targetIndex]] = [next[targetIndex]!, next[index]!];
  return next;
}

function isGroupInSubtree(
  response: DescriptionTreeGetResponse,
  ancestorGroupId: string,
  candidateGroupId: string,
): boolean {
  const group = findActiveDescriptionGroup(response, ancestorGroupId);
  if (!group) {
    return false;
  }
  const stack = [...group.children];
  while (stack.length > 0) {
    const ref = stack.pop()!;
    if (ref.type === 'group') {
      if (ref.id === candidateGroupId) {
        return true;
      }
      const nested = findActiveDescriptionGroup(response, ref.id);
      if (nested) {
        stack.push(...nested.children);
      }
    }
  }
  return false;
}

function countNodeOccurrences(
  response: DescriptionTreeGetResponse,
  node: TreeNodeRef,
): number {
  let count = 0;
  function walk(refs: DescriptionTreeNodeRef[]): void {
    for (const ref of refs) {
      if (ref.type === node.type && ref.id === node.id) {
        count += 1;
      }
      if (ref.type === 'group') {
        const group = findActiveDescriptionGroup(response, ref.id);
        if (group) {
          walk(group.children);
        }
      }
    }
  }
  walk(response.description.rootNodes);
  return count;
}

function findNodeIndexInContainer(
  container: DescriptionTreeNodeRef[],
  node: TreeNodeRef,
): number {
  return container.findIndex(
    (ref) => ref.type === node.type && ref.id === node.id,
  );
}

/** Item/Group 共通 sibling context。active tree 上に無い node は null。 */
export function findNodeSiblingContext(
  response: DescriptionTreeGetResponse,
  node: TreeNodeRef,
): NodeSiblingContext | null {
  function walk(
    refs: DescriptionTreeNodeRef[],
    parentGroupId: string | null,
  ): NodeSiblingContext | null {
    for (let index = 0; index < refs.length; index += 1) {
      const ref = refs[index]!;
      if (ref.type === node.type && ref.id === node.id) {
        return {
          node: { type: node.type, id: node.id },
          sourceParentGroupId: parentGroupId,
          sourceIndex: index,
          sourceOrderedNodes: containerToRefs(refs),
        };
      }
      if (ref.type === 'group') {
        const group = findActiveDescriptionGroup(response, ref.id);
        if (group) {
          const nested = walk(group.children, ref.id);
          if (nested) {
            return nested;
          }
        }
      }
    }
    return null;
  }
  return walk(response.description.rootNodes, null);
}

export function planMoveNodeUp(
  response: DescriptionTreeGetResponse,
  node: TreeNodeRef,
): ReorderMovePlan | null {
  const ctx = findNodeSiblingContext(response, node);
  if (!ctx || ctx.sourceIndex === 0) {
    return null;
  }
  const destinationOrderedNodes = swapAtIndex(
    ctx.sourceOrderedNodes,
    ctx.sourceIndex,
    -1,
  );
  if (!destinationOrderedNodes) {
    return null;
  }
  return {
    kind: 'reorder-up',
    node: ctx.node,
    sourceParentGroupId: ctx.sourceParentGroupId,
    sourceIndex: ctx.sourceIndex,
    sourceOrderedNodes: ctx.sourceOrderedNodes,
    destinationOrderedNodes,
  };
}

export function planMoveNodeDown(
  response: DescriptionTreeGetResponse,
  node: TreeNodeRef,
): ReorderMovePlan | null {
  const ctx = findNodeSiblingContext(response, node);
  if (!ctx || ctx.sourceIndex >= ctx.sourceOrderedNodes.length - 1) {
    return null;
  }
  const destinationOrderedNodes = swapAtIndex(
    ctx.sourceOrderedNodes,
    ctx.sourceIndex,
    1,
  );
  if (!destinationOrderedNodes) {
    return null;
  }
  return {
    kind: 'reorder-down',
    node: ctx.node,
    sourceParentGroupId: ctx.sourceParentGroupId,
    sourceIndex: ctx.sourceIndex,
    sourceOrderedNodes: ctx.sourceOrderedNodes,
    destinationOrderedNodes,
  };
}

export function planIndentNode(
  response: DescriptionTreeGetResponse,
  node: TreeNodeRef,
): IndentMovePlan | null {
  const ctx = findNodeSiblingContext(response, node);
  if (!ctx || ctx.sourceIndex === 0) {
    return null;
  }
  const previous = ctx.sourceOrderedNodes[ctx.sourceIndex - 1]!;
  if (previous.type !== 'group') {
    return null;
  }
  if (
    node.type === 'group' &&
    (previous.id === node.id ||
      isGroupInSubtree(response, node.id, previous.id))
  ) {
    return null;
  }
  const destination = findActiveDescriptionGroup(response, previous.id);
  if (!destination) {
    return null;
  }
  return {
    kind: 'indent',
    node: ctx.node,
    sourceParentGroupId: ctx.sourceParentGroupId,
    sourceIndex: ctx.sourceIndex,
    sourceOrderedNodes: ctx.sourceOrderedNodes,
    destinationParentGroupId: previous.id,
    expandGroupIds: collectActiveGroupAncestorChain(response, previous.id),
  };
}

export function planOutdentNode(
  response: DescriptionTreeGetResponse,
  node: TreeNodeRef,
): OutdentMovePlan | null {
  const ctx = findNodeSiblingContext(response, node);
  if (!ctx || ctx.sourceParentGroupId === null) {
    return null;
  }
  const parentCtx = findNodeSiblingContext(response, {
    type: 'group',
    id: ctx.sourceParentGroupId,
  });
  if (!parentCtx) {
    return null;
  }
  return {
    kind: 'outdent',
    node: ctx.node,
    sourceParentGroupId: ctx.sourceParentGroupId,
    sourceIndex: ctx.sourceIndex,
    sourceOrderedNodes: ctx.sourceOrderedNodes,
    destinationParentGroupId: parentCtx.sourceParentGroupId,
    destinationIndex: parentCtx.sourceIndex + 1,
  };
}

export function buildNodeMoveCapture(
  response: DescriptionTreeGetResponse,
  plan: NodeMovePlan,
  captureRevision: string,
): NodeMoveCapture | null {
  if (plan.kind === 'reorder-up' || plan.kind === 'reorder-down') {
    return {
      node: plan.node,
      commandKind: plan.kind,
      captureRevision,
      sourceParentGroupId: plan.sourceParentGroupId,
      sourceIndex: plan.sourceIndex,
      sourceOrderedNodes: plan.sourceOrderedNodes,
      expectedContainerOrderedNodes: plan.destinationOrderedNodes,
      destinationParentGroupId: plan.sourceParentGroupId,
      destinationIndex: null,
    };
  }
  if (plan.kind === 'indent') {
    const destination = findActiveDescriptionGroup(
      response,
      plan.destinationParentGroupId,
    );
    if (!destination) {
      return null;
    }
    const expectedContainer = [
      ...containerToRefs(destination.children),
      plan.node,
    ];
    return {
      node: plan.node,
      commandKind: plan.kind,
      captureRevision,
      sourceParentGroupId: plan.sourceParentGroupId,
      sourceIndex: plan.sourceIndex,
      sourceOrderedNodes: plan.sourceOrderedNodes,
      expectedContainerOrderedNodes: expectedContainer,
      destinationParentGroupId: plan.destinationParentGroupId,
      destinationIndex: expectedContainer.length - 1,
      expandGroupIds: plan.expandGroupIds,
    };
  }
  if (plan.kind !== 'outdent') {
    return null;
  }
  const parentCtx = findNodeSiblingContext(response, {
    type: 'group',
    id: plan.sourceParentGroupId,
  });
  if (!parentCtx) {
    return null;
  }
  const destinationBefore = [...parentCtx.sourceOrderedNodes];
  destinationBefore.splice(plan.destinationIndex, 0, plan.node);
  return {
    node: plan.node,
    commandKind: plan.kind,
    captureRevision,
    sourceParentGroupId: plan.sourceParentGroupId,
    sourceIndex: plan.sourceIndex,
    sourceOrderedNodes: plan.sourceOrderedNodes,
    expectedContainerOrderedNodes: destinationBefore,
    destinationParentGroupId: plan.destinationParentGroupId,
    destinationIndex: plan.destinationIndex,
  };
}

function sourceUnchanged(
  response: DescriptionTreeGetResponse,
  capture: NodeMoveCapture,
): boolean {
  const container = getContainerChildren(response, capture.sourceParentGroupId);
  if (!container) {
    return false;
  }
  return refListsEqual(containerToRefs(container), capture.sourceOrderedNodes);
}

function verifyReorderExact(
  response: DescriptionTreeGetResponse,
  capture: NodeMoveCapture,
): NodeMoveClassification | null {
  const container = getContainerChildren(response, capture.sourceParentGroupId);
  if (!container) {
    return { kind: 'incomplete-response' };
  }
  if (!refListsEqual(containerToRefs(container), capture.expectedContainerOrderedNodes)) {
    if (sourceUnchanged(response, capture)) {
      return { kind: 'definitely-not-committed' };
    }
    return { kind: 'order-mismatch' };
  }
  const occurrences = countNodeOccurrences(response, capture.node);
  if (occurrences === 0) {
    return { kind: 'node-missing' };
  }
  if (occurrences > 1) {
    return { kind: 'duplicate-placement' };
  }
  return null;
}

function verifyMoveExact(
  response: DescriptionTreeGetResponse,
  capture: NodeMoveCapture,
): NodeMoveClassification | null {
  const occurrences = countNodeOccurrences(response, capture.node);
  if (occurrences === 0) {
    return { kind: 'node-missing' };
  }
  if (occurrences > 1) {
    return { kind: 'duplicate-placement' };
  }

  const destination = getContainerChildren(
    response,
    capture.destinationParentGroupId,
  );
  if (!destination) {
    return { kind: 'incomplete-response' };
  }
  const actualDestination = containerToRefs(destination);
  if (
    !refListsEqual(actualDestination, capture.expectedContainerOrderedNodes)
  ) {
    if (sourceUnchanged(response, capture)) {
      return { kind: 'definitely-not-committed' };
    }
    return { kind: 'unexpected-position' };
  }

  const sourceContainer = getContainerChildren(
    response,
    capture.sourceParentGroupId,
  );
  if (!sourceContainer) {
    return { kind: 'incomplete-response' };
  }
  const sourceAfter = containerToRefs(sourceContainer);
  const expectedSourceAfter = capture.sourceOrderedNodes.filter(
    (entry) => !refsEqual(entry, capture.node),
  );
  if (
    capture.sourceParentGroupId !== capture.destinationParentGroupId &&
    !refListsEqual(sourceAfter, expectedSourceAfter)
  ) {
    return { kind: 'unexpected-position' };
  }

  const index = findNodeIndexInContainer(destination, capture.node);
  if (
    capture.destinationIndex != null &&
    index !== capture.destinationIndex
  ) {
    return { kind: 'unexpected-position' };
  }

  return null;
}

/**
 * move/reorder 後の authoritative Tree を分類する。
 * match-exact のみ commit 成功。commit-unknown では mutationRevision null + exact placement も成功。
 */
export function classifyNodeMoveAuthoritative(
  response: DescriptionTreeGetResponse,
  capture: NodeMoveCapture,
  options: {
    mutationRevision: string | null;
    captureRevision: string;
  },
): NodeMoveClassification {
  const { mutationRevision, captureRevision } = options;

  if (mutationRevision && response.revision !== mutationRevision) {
    if (response.revision === captureRevision && sourceUnchanged(response, capture)) {
      return { kind: 'definitely-not-committed' };
    }
    return { kind: 'revision-diverged' };
  }

  if (!mutationRevision && response.revision !== captureRevision) {
    const mismatch =
      capture.commandKind === 'reorder-up' ||
      capture.commandKind === 'reorder-down'
        ? verifyReorderExact(response, capture)
        : verifyMoveExact(response, capture);
    if (!mismatch) {
      return { kind: 'match-exact' };
    }
    if (mismatch.kind === 'definitely-not-committed') {
      return mismatch;
    }
    return { kind: 'revision-diverged' };
  }

  if (!mutationRevision && response.revision === captureRevision) {
    if (sourceUnchanged(response, capture)) {
      return { kind: 'definitely-not-committed' };
    }
    return { kind: 'revision-diverged' };
  }

  const mismatch =
    capture.commandKind === 'reorder-up' ||
    capture.commandKind === 'reorder-down'
      ? verifyReorderExact(response, capture)
      : verifyMoveExact(response, capture);
  if (mismatch) {
    return mismatch;
  }
  return { kind: 'match-exact' };
}

export function planForDirection(
  response: DescriptionTreeGetResponse,
  node: TreeNodeRef,
  direction: 'up' | 'down' | 'indent' | 'outdent',
): NodeMovePlan | null {
  if (direction === 'up') {
    return planMoveNodeUp(response, node);
  }
  if (direction === 'down') {
    return planMoveNodeDown(response, node);
  }
  if (direction === 'indent') {
    return planIndentNode(response, node);
  }
  return planOutdentNode(response, node);
}
