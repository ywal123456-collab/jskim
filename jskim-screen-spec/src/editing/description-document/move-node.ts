import { cloneNormalizedDescription } from './clone-normalized.js';
import { findNodeLocation } from './find-node-location.js';
import {
  computeGroupDepthInTree,
  computeGroupSubtreeMaxRelativeDepth,
  isGroupInSubtree,
} from './group-depth.js';
import { DescriptionDocumentError } from './errors.js';
import { getChildListRef } from './tree-children.js';
import type { NormalizedDescription, SpecNodeRef } from './types.js';
import { MAX_GROUP_DEPTH } from './validate-description-tree-semantics.js';

const MOVE_NODE_KEYS = new Set(['node', 'destinationParentGroupId', 'insertIndex']);

export type MoveNodeInput = {
  node: SpecNodeRef;
  /** null は rootNodes */
  destinationParentGroupId: string | null;
  insertIndex?: number;
};

export type ApplyMoveNodeResult =
  | { status: 'updated'; normalized: NormalizedDescription }
  | { status: 'unchanged'; normalized: NormalizedDescription };

function assertMoveNodeInput(input: MoveNodeInput): void {
  for (const key of Object.keys(input)) {
    if (!MOVE_NODE_KEYS.has(key)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `moveNode に許可されていないフィールドがあります: ${key}`,
      });
    }
  }
  if (
    input.node == null ||
    typeof input.node !== 'object' ||
    (input.node.type !== 'group' && input.node.type !== 'item') ||
    typeof input.node.id !== 'string' ||
    input.node.id.length === 0
  ) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'node の形式が不正です。',
    });
  }
  if (
    input.destinationParentGroupId !== null &&
    (typeof input.destinationParentGroupId !== 'string' ||
      input.destinationParentGroupId.length === 0)
  ) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'destinationParentGroupId の形式が不正です。',
    });
  }
  if (input.insertIndex !== undefined) {
    if (
      typeof input.insertIndex !== 'number' ||
      !Number.isInteger(input.insertIndex) ||
      input.insertIndex < 0
    ) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_GROUP_INSERT_INDEX_INVALID',
        message: 'insertIndex の値が不正です。',
      });
    }
  }
}

function resolveInsertIndex(
  insertIndex: number | undefined,
  lengthAfterRemove: number,
): number {
  if (insertIndex === undefined) {
    return lengthAfterRemove;
  }
  if (insertIndex > lengthAfterRemove) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_GROUP_INSERT_INDEX_INVALID',
      message: 'insertIndex の値が不正です。',
    });
  }
  return insertIndex;
}

function assertDestinationParentExists(
  normalized: NormalizedDescription,
  destinationParentGroupId: string | null,
): void {
  if (destinationParentGroupId === null) {
    return;
  }
  const exists = normalized.groups.some(
    (group) => group.groupId === destinationParentGroupId,
  );
  if (!exists) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
      message: `移動先 Group が見つかりません: ${destinationParentGroupId}`,
    });
  }
  const depth = computeGroupDepthInTree(
    destinationParentGroupId,
    normalized.rootNodes,
    normalized.groups,
  );
  if (depth == null) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
      message: `移動先 Group が tree 上に存在しません: ${destinationParentGroupId}`,
    });
  }
}

function assertGroupMoveDepth(
  normalized: NormalizedDescription,
  movedGroupId: string,
  destinationParentGroupId: string | null,
): void {
  const destinationParentDepth =
    destinationParentGroupId === null
      ? 0
      : computeGroupDepthInTree(
          destinationParentGroupId,
          normalized.rootNodes,
          normalized.groups,
        ) ?? 0;
  const subtreeDepth = computeGroupSubtreeMaxRelativeDepth(
    movedGroupId,
    normalized.groups,
  );
  if (destinationParentDepth + subtreeDepth > MAX_GROUP_DEPTH) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_GROUP_DEPTH_EXCEEDED',
      message: `Group の深さが上限（${MAX_GROUP_DEPTH}）を超えています: ${movedGroupId}`,
    });
  }
}

function assertGroupMoveCycle(
  normalized: NormalizedDescription,
  movedGroupId: string,
  destinationParentGroupId: string | null,
): void {
  if (destinationParentGroupId === null) {
    return;
  }
  if (
    movedGroupId === destinationParentGroupId ||
    isGroupInSubtree(destinationParentGroupId, movedGroupId, normalized.groups)
  ) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_GROUP_CYCLE',
      message: `Group を自身または子孫 Group の下へ移動できません: ${movedGroupId}`,
    });
  }
}

function destinationLengthAfterRemove(
  normalized: NormalizedDescription,
  source: ReturnType<typeof findNodeLocation>,
  destinationParentGroupId: string | null,
): number {
  const destList = getChildListRef(normalized, destinationParentGroupId);
  if (source.parentGroupId === destinationParentGroupId) {
    return destList.length - 1;
  }
  return destList.length;
}

/**
 * moveNode: 1 つの node の parent または tree 内位置を変更する。
 * reorderChildren とは別 operation（中間状態を露出しない）。
 */
export function applyMoveNode(
  normalized: NormalizedDescription,
  input: MoveNodeInput,
): ApplyMoveNodeResult {
  assertMoveNodeInput(input);

  const source = findNodeLocation(normalized, input.node);
  assertDestinationParentExists(normalized, input.destinationParentGroupId);

  if (input.node.type === 'group') {
    assertGroupMoveCycle(
      normalized,
      input.node.id,
      input.destinationParentGroupId,
    );
    assertGroupMoveDepth(
      normalized,
      input.node.id,
      input.destinationParentGroupId,
    );
  }

  const lengthAfterRemove = destinationLengthAfterRemove(
    normalized,
    source,
    input.destinationParentGroupId,
  );
  const finalIndex = resolveInsertIndex(input.insertIndex, lengthAfterRemove);

  const sameParent =
    source.parentGroupId === input.destinationParentGroupId ||
    (source.parentGroupId === null && input.destinationParentGroupId === null);
  if (sameParent && finalIndex === source.index) {
    return { status: 'unchanged', normalized: cloneNormalizedDescription(normalized) };
  }

  const next = cloneNormalizedDescription(normalized);
  const movingRef = { type: source.node.type, id: source.node.id } as SpecNodeRef;

  const sourceList = getChildListRef(next, source.parentGroupId);
  sourceList.splice(source.index, 1);

  const destList = getChildListRef(next, input.destinationParentGroupId);
  destList.splice(finalIndex, 0, movingRef);

  next.sourceSchemaVersion = '1.3';
  return { status: 'updated', normalized: next };
}
