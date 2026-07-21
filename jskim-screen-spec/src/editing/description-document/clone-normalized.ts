import type {
  ItemDescriptionFields,
  ItemGroup,
  NormalizedDescription,
  SpecNodeRef,
} from './types.js';

function cloneSpecNodeRef(ref: SpecNodeRef): SpecNodeRef {
  return { type: ref.type, id: ref.id };
}

function cloneItemFields(item: ItemDescriptionFields): ItemDescriptionFields {
  return {
    name: item.name,
    type: item.type,
    description: item.description,
    note: item.note,
  };
}

function cloneItemMap(
  map: Record<string, ItemDescriptionFields>,
): Record<string, ItemDescriptionFields> {
  const result: Record<string, ItemDescriptionFields> = {};
  for (const [id, item] of Object.entries(map)) {
    result[id] = cloneItemFields(item);
  }
  return result;
}

function cloneGroup(group: ItemGroup): ItemGroup {
  const next: ItemGroup = {
    groupId: group.groupId,
    name: group.name,
    kind: group.kind,
    children: group.children.map(cloneSpecNodeRef),
  };
  if (group.description !== undefined) {
    next.description = group.description;
  }
  return next;
}

/** normalized tree の deep copy（mutation 前に使用） */
export function cloneNormalizedDescription(
  normalized: NormalizedDescription,
): NormalizedDescription {
  return {
    sourceSchemaVersion: normalized.sourceSchemaVersion,
    screen: { ...normalized.screen },
    rootNodes: normalized.rootNodes.map(cloneSpecNodeRef),
    groups: normalized.groups.map(cloneGroup),
    items: cloneItemMap(normalized.items),
    excludedItems: cloneItemMap(normalized.excludedItems),
  };
}
