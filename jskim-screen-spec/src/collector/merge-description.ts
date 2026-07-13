import type { DescriptionSpec } from '../builder/load-screen-spec-project.js';

export type MergeDescriptionResult = {
  description: DescriptionSpec;
  addedItemIds: string[];
  orphanItemIds: string[];
  created: boolean;
};

/**
 * 収集した item ID を Description JSON へ merge する。
 * 既存テキストは保持し、orphan は削除しない。
 */
export function mergeDescription(options: {
  existing: DescriptionSpec | null;
  screenId: string;
  foundItemIds: string[];
}): MergeDescriptionResult {
  const { existing, screenId, foundItemIds } = options;

  if (!existing) {
    const items: DescriptionSpec['items'] = {};
    for (const id of foundItemIds) {
      items[id] = {
        name: '',
        type: '',
        description: '',
        note: '',
      };
    }
    return {
      description: {
        schemaVersion: '1.0',
        screen: {
          id: screenId,
          name: '',
          description: '',
        },
        items,
      },
      addedItemIds: [...foundItemIds],
      orphanItemIds: [],
      created: true,
    };
  }

  const items: DescriptionSpec['items'] = { ...existing.items };
  const existingIds = new Set(Object.keys(existing.items));
  const foundSet = new Set(foundItemIds);
  const addedItemIds: string[] = [];
  const orphanItemIds: string[] = [];

  for (const id of foundItemIds) {
    if (!existingIds.has(id)) {
      items[id] = {
        name: '',
        type: '',
        description: '',
        note: '',
      };
      addedItemIds.push(id);
    }
  }

  for (const id of existingIds) {
    if (!foundSet.has(id)) {
      orphanItemIds.push(id);
    }
  }

  return {
    description: {
      ...existing,
      schemaVersion: existing.schemaVersion || '1.0',
      screen: {
        ...existing.screen,
        id: existing.screen?.id || screenId,
      },
      items,
    },
    addedItemIds,
    orphanItemIds,
    created: false,
  };
}

/**
 * Description JSON を整形して書き込む文字列を返す。
 */
export function stringifyDescription(description: DescriptionSpec): string {
  return `${JSON.stringify(description, null, 2)}\n`;
}
