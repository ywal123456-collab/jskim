import type {
  DescriptionTreeGetResponse,
  DescriptionTreeNodeRef,
} from './description-tree-types.js';
import type { EditableDocument } from './types.js';

export type ItemFields = {
  name: string;
  type: string;
  description: string;
  note: string;
};

export type ItemSiblingContext = {
  parentGroupId: string | null;
  siblings: DescriptionTreeNodeRef[];
  index: number;
};

function walkItemIds(
  refs: DescriptionTreeNodeRef[],
  response: DescriptionTreeGetResponse,
  result: string[],
): void {
  for (const ref of refs) {
    if (ref.type === 'item') {
      if (response.description.items[ref.id]) {
        result.push(ref.id);
      }
      continue;
    }
    const group = response.description.groups.find(
      (entry) => entry.groupId === ref.id,
    );
    if (group && Array.isArray(group.children)) {
      walkItemIds(group.children as DescriptionTreeNodeRef[], response, result);
    }
  }
}

/** active Item ID を tree 走査順（表示用）で返す。 */
export function flattenActiveItemIds(
  response: DescriptionTreeGetResponse,
): string[] {
  const ids: string[] = [];
  walkItemIds(response.description.rootNodes, response, ids);
  return ids;
}

/** Tree GET 応答から editor 互換 flat document を合成する。 */
export function snapshotToEditableDocument(
  response: DescriptionTreeGetResponse,
): EditableDocument {
  const doc = response.description;
  return {
    schemaVersion: doc.schemaVersion,
    screen: { ...doc.screen },
    itemOrder: flattenActiveItemIds(response),
    items: { ...doc.items },
    excludedItems: { ...doc.excludedItems },
  };
}

function resolveChildrenList(
  response: DescriptionTreeGetResponse,
  parentGroupId: string | null,
): DescriptionTreeNodeRef[] | null {
  if (parentGroupId === null) {
    return response.description.rootNodes;
  }
  const group = response.description.groups.find(
    (entry) => entry.groupId === parentGroupId,
  );
  if (!group || !Array.isArray(group.children)) {
    return null;
  }
  return group.children as DescriptionTreeNodeRef[];
}

function findInRefs(
  refs: DescriptionTreeNodeRef[],
  response: DescriptionTreeGetResponse,
  itemId: string,
  parentGroupId: string | null,
): ItemSiblingContext | null {
  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index];
    if (ref.type === 'item' && ref.id === itemId) {
      return { parentGroupId, siblings: refs, index };
    }
    if (ref.type === 'group') {
      const group = response.description.groups.find(
        (entry) => entry.groupId === ref.id,
      );
      if (group && Array.isArray(group.children)) {
        const nested = findInRefs(
          group.children as DescriptionTreeNodeRef[],
          response,
          itemId,
          ref.id,
        );
        if (nested) {
          return nested;
        }
      }
    }
  }
  return null;
}

/** Item の parent と siblings 内 index を返す。tree 上に無い Item は null。 */
export function findItemSiblingContext(
  response: DescriptionTreeGetResponse,
  itemId: string,
): ItemSiblingContext | null {
  return findInRefs(response.description.rootNodes, response, itemId, null);
}

export function swapSiblingOrder(
  siblings: DescriptionTreeNodeRef[],
  index: number,
  direction: -1 | 1,
): DescriptionTreeNodeRef[] | null {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= siblings.length) {
    return null;
  }
  const next = siblings.map((ref) => ({ ...ref }));
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

export function cloneItemFields(fields: ItemFields): ItemFields {
  return {
    name: fields.name,
    type: fields.type,
    description: fields.description,
    note: fields.note,
  };
}

export function itemFieldsEqual(a: ItemFields, b: ItemFields): boolean {
  return (
    a.name === b.name &&
    a.type === b.type &&
    a.description === b.description &&
    a.note === b.note
  );
}

export function resolveDuplicatePlacement(
  response: DescriptionTreeGetResponse,
  sourceItemId: string,
): { parentGroupId: string | null; insertIndex: number } | null {
  const ctx = findItemSiblingContext(response, sourceItemId);
  if (!ctx) {
    return null;
  }
  return {
    parentGroupId: ctx.parentGroupId,
    insertIndex: ctx.index + 1,
  };
}

export function nodeExistsInActiveTree(
  response: DescriptionTreeGetResponse,
  itemId: string,
): boolean {
  return findItemSiblingContext(response, itemId) !== null;
}

export function resolveChildrenListForParent(
  response: DescriptionTreeGetResponse,
  parentGroupId: string | null,
): DescriptionTreeNodeRef[] | null {
  return resolveChildrenList(response, parentGroupId);
}
