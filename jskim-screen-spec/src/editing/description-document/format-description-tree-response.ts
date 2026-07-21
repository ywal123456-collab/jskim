import type {
  ItemDescriptionFields,
  ItemGroup,
  NormalizedDescription,
  SpecNodeRef,
} from './types.js';
import { sortDescriptionItemMapKeys } from './sort-item-map-keys.js';

function formatSpecNodeRef(ref: SpecNodeRef): { type: SpecNodeRef['type']; id: string } {
  return { type: ref.type, id: ref.id };
}

function formatItemFields(item: ItemDescriptionFields): ItemDescriptionFields {
  return {
    name: item.name,
    type: item.type,
    description: item.description,
    note: item.note,
  };
}

function formatItemGroup(group: ItemGroup): Record<string, unknown> {
  const row: Record<string, unknown> = {
    groupId: group.groupId,
    name: group.name,
    kind: group.kind,
    children: group.children.map(formatSpecNodeRef),
  };
  if (group.description !== undefined) {
    row.description = group.description;
  }
  return row;
}

function formatItemMap(
  map: Record<string, ItemDescriptionFields>,
): Record<string, ItemDescriptionFields> {
  const result: Record<string, ItemDescriptionFields> = {};
  for (const key of sortDescriptionItemMapKeys(map)) {
    result[key] = formatItemFields(map[key]);
  }
  return result;
}

export type DescriptionTreeApiDocument = {
  schemaVersion: '1.3';
  screen: {
    id: string;
    name: string;
    description: string;
  };
  rootNodes: Array<{ type: SpecNodeRef['type']; id: string }>;
  groups: Array<Record<string, unknown>>;
  items: Record<string, ItemDescriptionFields>;
  excludedItems: Record<string, ItemDescriptionFields>;
};

/**
 * normalized Item Tree を HTTP 応答 DTO へ変換する（read-only）。
 * canonical writer と同じ groups/items 並び順を使う。
 */
export function formatDescriptionTreeForApi(
  normalized: NormalizedDescription,
): DescriptionTreeApiDocument {
  const sortedGroups = [...normalized.groups]
    .sort((a, b) => a.groupId.localeCompare(b.groupId, 'en'))
    .map(formatItemGroup);

  return {
    schemaVersion: '1.3',
    screen: {
      id: normalized.screen.id,
      name: normalized.screen.name,
      description: normalized.screen.description,
    },
    rootNodes: normalized.rootNodes.map(formatSpecNodeRef),
    groups: sortedGroups,
    items: formatItemMap(normalized.items),
    excludedItems: formatItemMap(normalized.excludedItems),
  };
}
