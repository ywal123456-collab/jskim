import { DESCRIPTION_SCHEMA_V1_3_URI } from '../../util/description-schema-uri.js';
import type {
  ItemDescriptionFields,
  ItemGroup,
  NormalizedDescription,
  SpecNodeRef,
} from './types.js';
import { sortDescriptionItemMapKeys } from './sort-item-map-keys.js';

function formatSpecNodeRef(ref: SpecNodeRef): Record<string, string> {
  return { type: ref.type, id: ref.id };
}

function formatItemFields(item: ItemDescriptionFields): Record<string, string> {
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
  };
  if (group.description !== undefined) {
    row.description = group.description;
  }
  row.kind = group.kind;
  row.children = group.children.map(formatSpecNodeRef);
  return row;
}

function formatItemMap(
  map: Record<string, ItemDescriptionFields>,
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const key of sortDescriptionItemMapKeys(map)) {
    result[key] = formatItemFields(map[key]);
  }
  return result;
}

/**
 * normalized v1.3 tree を canonical JSON bytes（末尾 LF）へ変換する。
 * 入力 normalized object は変更しない。
 */
export function formatDescriptionDocumentV13(
  normalized: NormalizedDescription,
): string {
  const sortedGroups = [...normalized.groups]
    .sort((a, b) => a.groupId.localeCompare(b.groupId, 'en'))
    .map(formatItemGroup);

  const document = {
    $schema: DESCRIPTION_SCHEMA_V1_3_URI,
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

  return `${JSON.stringify(document, null, 2)}\n`;
}
