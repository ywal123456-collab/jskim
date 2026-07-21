import { computeEffectiveItemOrder } from '../../builder/item-order.js';
import type { DescriptionSpec } from '../../builder/load-screen-spec-project.js';
import {
  type ItemDescriptionFields,
  type ItemGroup,
  type ItemGroupKind,
  type NormalizedDescription,
  type ParsedDescriptionDocument,
  type SpecNodeRef,
} from './types.js';

function cloneItemFields(value: unknown): ItemDescriptionFields {
  const row = (value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}) as Record<string, unknown>;
  return {
    name: typeof row.name === 'string' ? row.name : '',
    type: typeof row.type === 'string' ? row.type : '',
    description: typeof row.description === 'string' ? row.description : '',
    note: typeof row.note === 'string' ? row.note : '',
  };
}

function cloneItemMap(value: unknown): Record<string, ItemDescriptionFields> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, ItemDescriptionFields> = {};
  for (const [id, item] of Object.entries(value as Record<string, unknown>)) {
    result[id] = cloneItemFields(item);
  }
  return result;
}

function cloneSpecNodeRef(value: unknown): SpecNodeRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (row.type === 'group' && typeof row.id === 'string') {
    return { type: 'group', id: row.id };
  }
  if (row.type === 'item' && typeof row.id === 'string') {
    return { type: 'item', id: row.id };
  }
  return null;
}

function cloneGroups(value: unknown): ItemGroup[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const groups: ItemGroup[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.groupId !== 'string' || typeof row.name !== 'string') {
      continue;
    }
    if (typeof row.kind !== 'string') {
      continue;
    }
    const children: SpecNodeRef[] = [];
    if (Array.isArray(row.children)) {
      for (const child of row.children) {
        const ref = cloneSpecNodeRef(child);
        if (ref) {
          children.push(ref);
        }
      }
    }
    const group: ItemGroup = {
      groupId: row.groupId,
      name: row.name,
      kind: row.kind as ItemGroupKind,
      children,
    };
    if (typeof row.description === 'string') {
      group.description = row.description;
    }
    groups.push(group);
  }
  return groups;
}

function readScreen(raw: Record<string, unknown>): NormalizedDescription['screen'] {
  const screen = (raw.screen && typeof raw.screen === 'object' && !Array.isArray(raw.screen)
    ? raw.screen
    : {}) as Record<string, unknown>;
  return {
    id: typeof screen.id === 'string' ? screen.id : '',
    name: typeof screen.name === 'string' ? screen.name : '',
    description:
      typeof screen.description === 'string' ? screen.description : '',
  };
}

export type NormalizeDescriptionDocumentOptions = {
  collectedOrder?: string[] | null;
};

/**
 * ParsedDescriptionDocument から runtime tree を合成する（新オブジェクトを返す）。
 */
export function normalizeDescriptionDocument(
  parsed: ParsedDescriptionDocument,
  options: NormalizeDescriptionDocumentOptions = {},
): NormalizedDescription {
  const { raw, sourceSchemaVersion } = parsed;
  const screen = readScreen(raw);
  const items = cloneItemMap(raw.items);
  const excludedItems =
    sourceSchemaVersion === '1.2' || sourceSchemaVersion === '1.3'
      ? cloneItemMap(raw.excludedItems)
      : {};

  if (sourceSchemaVersion === '1.3') {
    const rootNodes: SpecNodeRef[] = [];
    if (Array.isArray(raw.rootNodes)) {
      for (const entry of raw.rootNodes) {
        const ref = cloneSpecNodeRef(entry);
        if (ref) {
          rootNodes.push(ref);
        }
      }
    }
    return {
      sourceSchemaVersion,
      screen,
      rootNodes,
      groups: cloneGroups(raw.groups),
      items,
      excludedItems,
    };
  }

  const itemOrder = computeEffectiveItemOrder({
    items,
    itemOrder: Array.isArray(raw.itemOrder)
      ? (raw.itemOrder as string[])
      : null,
    collectedOrder: options.collectedOrder ?? null,
  });

  return {
    sourceSchemaVersion,
    screen,
    rootNodes: itemOrder.map((id) => ({ type: 'item' as const, id })),
    groups: [],
    items,
    excludedItems,
  };
}

/**
 * loadScreenSpecProject の DescriptionSpec から normalize する（read-only helper）。
 */
export function normalizeDescriptionSpec(
  description: DescriptionSpec,
  options: NormalizeDescriptionDocumentOptions = {},
): NormalizedDescription {
  const version = description.schemaVersion;
  if (
    version !== '1.0' &&
    version !== '1.1' &&
    version !== '1.2' &&
    version !== '1.3'
  ) {
    return normalizeDescriptionDocument(
      {
        sourceSchemaVersion: '1.0',
        raw: description as unknown as Record<string, unknown>,
      },
      options,
    );
  }

  return normalizeDescriptionDocument(
    {
      sourceSchemaVersion: version,
      raw: description as unknown as Record<string, unknown>,
    },
    options,
  );
}
