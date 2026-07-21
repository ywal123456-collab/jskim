import { isValidItemId, isValidScreenId } from '../../util/screen-id.js';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_ITEM_ORDER_LENGTH,
  MAX_NAME_LENGTH,
} from '../description-field-limits.js';
import { ITEM_GROUP_KINDS } from './types.js';
import type {
  DescriptionDocumentValidationError,
  ParsedDescriptionDocument,
} from './types.js';
import { createDescriptionDocumentError } from './errors.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const TOP_KEYS_V10 = new Set(['schemaVersion', 'screen', 'items', '$schema']);
const TOP_KEYS_V11 = new Set([
  'schemaVersion',
  'screen',
  'itemOrder',
  'items',
  '$schema',
]);
const TOP_KEYS_V12 = new Set([
  'schemaVersion',
  'screen',
  'itemOrder',
  'items',
  'excludedItems',
  '$schema',
]);
const TOP_KEYS_V13 = new Set([
  'schemaVersion',
  'screen',
  'rootNodes',
  'groups',
  'items',
  'excludedItems',
  '$schema',
]);

const SCREEN_KEYS = new Set(['id', 'name', 'description']);
const ITEM_KEYS = new Set(['name', 'type', 'description', 'note']);
const GROUP_KEYS = new Set(['groupId', 'name', 'description', 'kind', 'children']);
const NODE_REF_KEYS = new Set(['type', 'id']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertNoForbiddenKeys(
  keys: string[],
  label: string,
): DescriptionDocumentValidationError | null {
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_INVALID',
        `${label} に禁止されたキーが含まれています。`,
      );
    }
  }
  return null;
}

function validateItemEntry(
  mapLabel: string,
  itemId: string,
  item: unknown,
): DescriptionDocumentValidationError | null {
  if (!isPlainObject(item)) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `${mapLabel}「${itemId}」は object である必要があります。`,
    );
  }
  const forbidden = assertNoForbiddenKeys(Object.keys(item), `${mapLabel}「${itemId}」`);
  if (forbidden) {
    return forbidden;
  }
  for (const key of Object.keys(item)) {
    if (!ITEM_KEYS.has(key)) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_INVALID',
        `${mapLabel}「${itemId}」に許可されていないフィールドがあります: ${key}`,
      );
    }
  }
  for (const field of ['name', 'type', 'description', 'note'] as const) {
    if (typeof item[field] !== 'string') {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_INVALID',
        `${mapLabel}「${itemId}」の ${field} は文字列である必要があります。`,
      );
    }
  }
  return null;
}

function validateItemMap(
  mapLabel: string,
  mapValue: unknown,
): DescriptionDocumentValidationError | { ids: string[] } {
  if (!isPlainObject(mapValue)) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `${mapLabel} は object である必要があります。`,
    );
  }
  const forbidden = assertNoForbiddenKeys(Object.keys(mapValue), mapLabel);
  if (forbidden) {
    return forbidden;
  }
  const ids = Object.keys(mapValue);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `${mapLabel} の item ID が重複しています。`,
    );
  }
  for (const itemId of ids) {
    if (!isValidItemId(itemId)) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_INVALID',
        `${mapLabel} の item ID の形式が不正です: ${itemId}`,
      );
    }
    const entryError = validateItemEntry(mapLabel, itemId, mapValue[itemId]);
    if (entryError) {
      return entryError;
    }
  }
  return { ids };
}

function validateScreen(
  screenValue: unknown,
): DescriptionDocumentValidationError | { screen: Record<string, unknown> } {
  if (!isPlainObject(screenValue)) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      'screen は object である必要があります。',
    );
  }
  const forbidden = assertNoForbiddenKeys(Object.keys(screenValue), 'screen');
  if (forbidden) {
    return forbidden;
  }
  for (const key of Object.keys(screenValue)) {
    if (!SCREEN_KEYS.has(key)) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_INVALID',
        `screen に許可されていないフィールドがあります: ${key}`,
      );
    }
  }
  if (typeof screenValue.id !== 'string' || !isValidScreenId(screenValue.id)) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      'screen.id の形式が不正です。',
    );
  }
  if (typeof screenValue.name !== 'string') {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      'screen.name は文字列である必要があります。',
    );
  }
  if (screenValue.name.length > MAX_NAME_LENGTH) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `screen.name は${MAX_NAME_LENGTH}文字以内である必要があります。`,
    );
  }
  if (typeof screenValue.description !== 'string') {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      'screen.description は文字列である必要があります。',
    );
  }
  if (screenValue.description.length > MAX_DESCRIPTION_LENGTH) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `screen.description は${MAX_DESCRIPTION_LENGTH}文字以内である必要があります。`,
    );
  }
  return { screen: screenValue };
}

function validateItemOrder(
  itemOrderValue: unknown,
  itemIds: Set<string>,
): DescriptionDocumentValidationError | null {
  if (!Array.isArray(itemOrderValue)) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      'itemOrder は配列である必要があります。',
    );
  }
  if (itemOrderValue.length > MAX_ITEM_ORDER_LENGTH) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `itemOrder は${MAX_ITEM_ORDER_LENGTH}件以内である必要があります。`,
    );
  }
  const order: string[] = [];
  for (const entry of itemOrderValue) {
    if (typeof entry !== 'string' || !isValidItemId(entry)) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_INVALID',
        'itemOrder に不正な item ID が含まれています。',
      );
    }
    order.push(entry);
  }
  const orderSet = new Set(order);
  if (orderSet.size !== order.length) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      'itemOrder に重複する item ID が含まれています。',
    );
  }
  if (orderSet.size !== itemIds.size || [...itemIds].some((id) => !orderSet.has(id))) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      'itemOrder は items のキー集合と完全に一致する必要があります。',
    );
  }
  return null;
}

function validateSpecNodeRef(
  ref: unknown,
  label: string,
): DescriptionDocumentValidationError | null {
  if (!isPlainObject(ref)) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `${label} の node 参照は object である必要があります。`,
    );
  }
  const forbidden = assertNoForbiddenKeys(Object.keys(ref), label);
  if (forbidden) {
    return forbidden;
  }
  for (const key of Object.keys(ref)) {
    if (!NODE_REF_KEYS.has(key)) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_INVALID',
        `${label} の node 参照に許可されていないフィールドがあります: ${key}`,
      );
    }
  }
  if (ref.type !== 'group' && ref.type !== 'item') {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `${label} の node 参照 type が不正です。`,
    );
  }
  if (typeof ref.id !== 'string' || !isValidItemId(ref.id)) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `${label} の node 参照 id が不正です。`,
    );
  }
  return null;
}

function validateGroupEntry(
  group: unknown,
  index: number,
): DescriptionDocumentValidationError | null {
  const label = `groups[${index}]`;
  if (!isPlainObject(group)) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `${label} は object である必要があります。`,
    );
  }
  const forbidden = assertNoForbiddenKeys(Object.keys(group), label);
  if (forbidden) {
    return forbidden;
  }
  for (const key of Object.keys(group)) {
    if (!GROUP_KEYS.has(key)) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_INVALID',
        `${label} に許可されていないフィールドがあります: ${key}`,
      );
    }
  }
  if (typeof group.groupId !== 'string' || !isValidItemId(group.groupId)) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `${label} の groupId が不正です。`,
    );
  }
  if (typeof group.name !== 'string') {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `${label} の name は文字列である必要があります。`,
    );
  }
  if (group.name.length > MAX_NAME_LENGTH) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `${label} の name は${MAX_NAME_LENGTH}文字以内である必要があります。`,
    );
  }
  if (group.description !== undefined) {
    if (typeof group.description !== 'string') {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_INVALID',
        `${label} の description は文字列である必要があります。`,
      );
    }
    if (group.description.length > MAX_DESCRIPTION_LENGTH) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_INVALID',
        `${label} の description は${MAX_DESCRIPTION_LENGTH}文字以内である必要があります。`,
      );
    }
  }
  if (typeof group.kind !== 'string' || !ITEM_GROUP_KINDS.includes(group.kind as never)) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `${label} の kind が不正です: ${String(group.kind)}`,
    );
  }
  if (!Array.isArray(group.children)) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `${label} の children は配列である必要があります。`,
    );
  }
  if (group.children.length > MAX_ITEM_ORDER_LENGTH) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `${label} の children は${MAX_ITEM_ORDER_LENGTH}件以内である必要があります。`,
    );
  }
  for (let i = 0; i < group.children.length; i += 1) {
    const childError = validateSpecNodeRef(
      group.children[i],
      `${label}.children[${i}]`,
    );
    if (childError) {
      return childError;
    }
  }
  return null;
}

function validateRootNodes(rootNodesValue: unknown): DescriptionDocumentValidationError | null {
  if (!Array.isArray(rootNodesValue)) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      'rootNodes は配列である必要があります。',
    );
  }
  if (rootNodesValue.length > MAX_ITEM_ORDER_LENGTH) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `rootNodes は${MAX_ITEM_ORDER_LENGTH}件以内である必要があります。`,
    );
  }
  for (let i = 0; i < rootNodesValue.length; i += 1) {
    const refError = validateSpecNodeRef(rootNodesValue[i], `rootNodes[${i}]`);
    if (refError) {
      return refError;
    }
  }
  return null;
}

function validateGroupsArray(
  groupsValue: unknown,
): DescriptionDocumentValidationError | null {
  if (!Array.isArray(groupsValue)) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      'groups は配列である必要があります。',
    );
  }
  if (groupsValue.length > MAX_ITEM_ORDER_LENGTH) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      `groups は${MAX_ITEM_ORDER_LENGTH}件以内である必要があります。`,
    );
  }
  const seenGroupIds = new Set<string>();
  for (let i = 0; i < groupsValue.length; i += 1) {
    const groupError = validateGroupEntry(groupsValue[i], i);
    if (groupError) {
      return groupError;
    }
    const group = groupsValue[i] as Record<string, unknown>;
    const groupId = group.groupId as string;
    if (seenGroupIds.has(groupId)) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_GROUP_ID_DUPLICATE',
        `groupId が重複しています: ${groupId}`,
      );
    }
    seenGroupIds.add(groupId);
  }
  return null;
}

function validateTopLevelKeys(
  raw: Record<string, unknown>,
  allowed: Set<string>,
): DescriptionDocumentValidationError | null {
  const forbidden = assertNoForbiddenKeys(Object.keys(raw), 'Description JSON');
  if (forbidden) {
    return forbidden;
  }
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_INVALID',
        `許可されていないフィールドです: ${key}`,
      );
    }
  }
  return null;
}

function validateActiveExcludedDisjoint(
  itemIds: string[],
  excludedIds: string[],
): DescriptionDocumentValidationError | null {
  const excludedSet = new Set(excludedIds);
  for (const id of itemIds) {
    if (excludedSet.has(id)) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_INVALID',
        `items と excludedItems に同じ item ID があります: ${id}`,
      );
    }
  }
  return null;
}

function validateIdNamespace(
  groupIds: string[],
  itemIds: string[],
  excludedIds: string[],
): DescriptionDocumentValidationError | null {
  const itemSet = new Set(itemIds);
  const excludedSet = new Set(excludedIds);
  for (const groupId of groupIds) {
    if (itemSet.has(groupId)) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
        `groupId と itemId が衝突しています: ${groupId}`,
      );
    }
    if (excludedSet.has(groupId)) {
      return createDescriptionDocumentError(
        'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
        `groupId と excluded itemId が衝突しています: ${groupId}`,
      );
    }
  }
  return null;
}

/**
 * JSON Schema 相当の構造検証（tree semantic は別途）。
 * 決定的な順序で最初のエラーのみ返す。
 */
export function validateDescriptionStructure(
  parsed: ParsedDescriptionDocument,
): DescriptionDocumentValidationError | null {
  const { raw, sourceSchemaVersion } = parsed;

  if (!isPlainObject(raw)) {
    return createDescriptionDocumentError(
      'SPEC_DESCRIPTION_INVALID',
      'Description JSON のルートは object である必要があります。',
    );
  }

  let allowedTop: Set<string>;
  if (sourceSchemaVersion === '1.0') {
    allowedTop = TOP_KEYS_V10;
  } else if (sourceSchemaVersion === '1.1') {
    allowedTop = TOP_KEYS_V11;
  } else if (sourceSchemaVersion === '1.2') {
    allowedTop = TOP_KEYS_V12;
  } else {
    allowedTop = TOP_KEYS_V13;
  }

  const topError = validateTopLevelKeys(raw, allowedTop);
  if (topError) {
    return topError;
  }

  const screenResult = validateScreen(raw.screen);
  if ('code' in screenResult) {
    return screenResult;
  }

  const itemsResult = validateItemMap('items', raw.items);
  if ('code' in itemsResult) {
    return itemsResult;
  }
  const itemIds = itemsResult.ids;

  if (sourceSchemaVersion === '1.1' || sourceSchemaVersion === '1.2') {
    const itemOrderError = validateItemOrder(raw.itemOrder, new Set(itemIds));
    if (itemOrderError) {
      return itemOrderError;
    }
  }

  let excludedIds: string[] = [];
  if (sourceSchemaVersion === '1.2' || sourceSchemaVersion === '1.3') {
    const excludedResult = validateItemMap('excludedItems', raw.excludedItems);
    if ('code' in excludedResult) {
      return excludedResult;
    }
    excludedIds = excludedResult.ids;
    const disjointError = validateActiveExcludedDisjoint(itemIds, excludedIds);
    if (disjointError) {
      return disjointError;
    }
  }

  if (sourceSchemaVersion === '1.3') {
    const rootError = validateRootNodes(raw.rootNodes);
    if (rootError) {
      return rootError;
    }
    const groupsError = validateGroupsArray(raw.groups);
    if (groupsError) {
      return groupsError;
    }
    const groupIds = Array.isArray(raw.groups)
      ? (raw.groups as Array<{ groupId?: string }>)
          .map((group) => group.groupId)
          .filter((id): id is string => typeof id === 'string')
      : [];
    const namespaceError = validateIdNamespace(groupIds, itemIds, excludedIds);
    if (namespaceError) {
      return namespaceError;
    }
  }

  return null;
}
