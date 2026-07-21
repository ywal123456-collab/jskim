import { cloneNormalizedDescription } from './clone-normalized.js';
import { DescriptionDocumentError } from './errors.js';
import { getChildListRef } from './tree-children.js';
import { specNodeRefEquals, specNodeRefKey } from './spec-node-ref.js';
import type { NormalizedDescription, SpecNodeRef } from './types.js';

const REORDER_CHILDREN_KEYS = new Set(['parentGroupId', 'orderedNodes']);

export type ReorderChildrenInput = {
  /** null は rootNodes */
  parentGroupId: string | null;
  orderedNodes: SpecNodeRef[];
};

export type ApplyReorderChildrenResult =
  | { status: 'updated'; normalized: NormalizedDescription }
  | { status: 'unchanged'; normalized: NormalizedDescription };

function assertReorderChildrenInput(input: ReorderChildrenInput): void {
  for (const key of Object.keys(input)) {
    if (!REORDER_CHILDREN_KEYS.has(key)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `reorderChildren に許可されていないフィールドがあります: ${key}`,
      });
    }
  }
  if (
    input.parentGroupId !== null &&
    (typeof input.parentGroupId !== 'string' || input.parentGroupId.length === 0)
  ) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'parentGroupId の形式が不正です。',
    });
  }
  if (!Array.isArray(input.orderedNodes)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'orderedNodes は配列である必要があります。',
    });
  }
  for (const ref of input.orderedNodes) {
    if (
      ref == null ||
      typeof ref !== 'object' ||
      (ref.type !== 'group' && ref.type !== 'item') ||
      typeof ref.id !== 'string' ||
      ref.id.length === 0
    ) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'orderedNodes の node 形式が不正です。',
      });
    }
  }
}

function assertExactPermutation(
  current: SpecNodeRef[],
  orderedNodes: SpecNodeRef[],
): void {
  if (current.length !== orderedNodes.length) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_REORDER_MISMATCH',
      message: 'orderedNodes の件数が現在の children と一致しません。',
    });
  }

  const currentKeys = current.map(specNodeRefKey);
  const orderedKeys = orderedNodes.map(specNodeRefKey);
  const currentSet = new Set(currentKeys);
  const orderedSet = new Set(orderedKeys);

  if (orderedSet.size !== orderedKeys.length) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_REORDER_MISMATCH',
      message: 'orderedNodes に重複 node があります。',
    });
  }

  if (currentSet.size !== currentKeys.length) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: '現在の children に重複 node があります。',
    });
  }

  for (const ordered of orderedNodes) {
    const sameId = current.find((ref) => ref.id === ordered.id);
    if (sameId && sameId.type !== ordered.type) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_REORDER_MISMATCH',
        message: `orderedNodes の type が一致しません: ${ordered.id}`,
      });
    }
  }

  for (const key of currentSet) {
    if (!orderedSet.has(key)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_REORDER_MISMATCH',
        message: 'orderedNodes に現在の child が含まれていません。',
      });
    }
  }

  for (let i = 0; i < orderedNodes.length; i += 1) {
    const ordered = orderedNodes[i];
    const actual = current.find((ref) => specNodeRefEquals(ref, ordered));
    if (!actual) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_REORDER_MISMATCH',
        message: 'orderedNodes に存在しない node が含まれています。',
      });
    }
    if (actual.type !== ordered.type) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_REORDER_MISMATCH',
        message: `orderedNodes の type が一致しません: ${ordered.id}`,
      });
    }
  }
}

function isSameOrder(current: SpecNodeRef[], orderedNodes: SpecNodeRef[]): boolean {
  if (current.length !== orderedNodes.length) {
    return false;
  }
  for (let i = 0; i < current.length; i += 1) {
    if (!specNodeRefEquals(current[i], orderedNodes[i])) {
      return false;
    }
  }
  return true;
}

/**
 * reorderChildren: 同一 parent の直系 children 順序を atomic に置換する。
 * parent 変更は行わない（moveNode を使う）。
 */
export function applyReorderChildren(
  normalized: NormalizedDescription,
  input: ReorderChildrenInput,
): ApplyReorderChildrenResult {
  assertReorderChildrenInput(input);

  const current = getChildListRef(normalized, input.parentGroupId);
  assertExactPermutation(current, input.orderedNodes);

  if (isSameOrder(current, input.orderedNodes)) {
    return { status: 'unchanged', normalized: cloneNormalizedDescription(normalized) };
  }

  const next = cloneNormalizedDescription(normalized);
  const target = getChildListRef(next, input.parentGroupId);
  target.splice(0, target.length, ...input.orderedNodes.map((ref) => ({
    type: ref.type,
    id: ref.id,
  })));

  next.sourceSchemaVersion = '1.3';
  return { status: 'updated', normalized: next };
}
