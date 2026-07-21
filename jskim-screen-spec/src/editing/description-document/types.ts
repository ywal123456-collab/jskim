export const DESCRIPTION_SOURCE_SCHEMA_VERSIONS = [
  '1.0',
  '1.1',
  '1.2',
  '1.3',
] as const;

export type DescriptionSourceSchemaVersion =
  (typeof DESCRIPTION_SOURCE_SCHEMA_VERSIONS)[number];

export type SpecNodeRef = {
  type: 'group' | 'item';
  id: string;
};

export const ITEM_GROUP_KINDS = [
  'SECTION',
  'FIELDSET',
  'CARD',
  'REPEATABLE',
  'ACTIONS',
  'CONTENT',
  'CUSTOM',
] as const;

export type ItemGroupKind = (typeof ITEM_GROUP_KINDS)[number];

export type ItemDescriptionFields = {
  name: string;
  type: string;
  description: string;
  note: string;
};

export type ItemGroup = {
  groupId: string;
  name: string;
  description?: string;
  kind: ItemGroupKind;
  children: SpecNodeRef[];
};

/**
 * ディスク上の Description JSON を parse した直後の read-only 表現。
 * raw は mutation しない。
 */
export type ParsedDescriptionDocument = {
  sourceSchemaVersion: DescriptionSourceSchemaVersion;
  raw: Readonly<Record<string, unknown>>;
};

/**
 * runtime で使用する Item Group tree 表現（正規化済み）。
 * persisted source とは別オブジェクト。
 */
export type NormalizedDescription = {
  sourceSchemaVersion: DescriptionSourceSchemaVersion;
  screen: {
    id: string;
    name: string;
    description: string;
  };
  rootNodes: SpecNodeRef[];
  groups: ItemGroup[];
  items: Record<string, ItemDescriptionFields>;
  excludedItems: Record<string, ItemDescriptionFields>;
};

export type DescriptionDocumentValidationError = {
  code: string;
  message: string;
};
