import type { DescriptionSpec } from '../builder/load-screen-spec-project.js';

export type EditableDescriptionDocument = {
  schemaVersion: string;
  screen: {
    id: string;
    name: string;
    description: string;
  };
  items: Record<
    string,
    {
      name: string;
      type: string;
      description: string;
      note: string;
    }
  >;
};

export type DescriptionValidationError = {
  code: string;
  message: string;
};

const SCREEN_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Viewer 編集用 document を検証する。
 * 既存ファイルがある場合は item ID 集合の変更を拒否する。
 */
export function validateEditableDescriptionDocument(options: {
  screenId: string;
  document: unknown;
  existing: DescriptionSpec | null;
}): DescriptionValidationError | null {
  const { screenId, document, existing } = options;

  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'document は object である必要があります。',
    };
  }

  const doc = document as Record<string, unknown>;
  const allowedTop = new Set(['schemaVersion', 'screen', 'items', '$schema']);
  for (const key of Object.keys(doc)) {
    if (!allowedTop.has(key)) {
      return {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `許可されていないフィールドです: ${key}`,
      };
    }
  }

  if (doc.schemaVersion !== '1.0') {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'schemaVersion は "1.0" である必要があります。',
    };
  }

  if (!doc.screen || typeof doc.screen !== 'object' || Array.isArray(doc.screen)) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'screen は object である必要があります。',
    };
  }

  const screen = doc.screen as Record<string, unknown>;
  for (const key of Object.keys(screen)) {
    if (key !== 'id' && key !== 'name' && key !== 'description') {
      return {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `screen に許可されていないフィールドがあります: ${key}`,
      };
    }
  }

  if (typeof screen.id !== 'string' || screen.id !== screenId) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'screen.id が URL の画面 ID と一致しません。',
    };
  }

  if (!SCREEN_ID_RE.test(screenId)) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: '画面 ID の形式が不正です。',
    };
  }

  if (typeof screen.name !== 'string') {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'screen.name は文字列である必要があります。',
    };
  }

  if (typeof screen.description !== 'string') {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'screen.description は文字列である必要があります。',
    };
  }

  if (!doc.items || typeof doc.items !== 'object' || Array.isArray(doc.items)) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'items は object である必要があります。',
    };
  }

  const items = doc.items as Record<string, unknown>;
  const itemIds = Object.keys(items);
  const unique = new Set(itemIds);
  if (unique.size !== itemIds.length) {
    return {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'item ID が重複しています。',
    };
  }

  for (const itemId of itemIds) {
    if (!SCREEN_ID_RE.test(itemId)) {
      return {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `item ID の形式が不正です: ${itemId}`,
      };
    }
    const item = items[itemId];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `item「${itemId}」は object である必要があります。`,
      };
    }
    const row = item as Record<string, unknown>;
    for (const key of Object.keys(row)) {
      if (
        key !== 'name' &&
        key !== 'type' &&
        key !== 'description' &&
        key !== 'note'
      ) {
        return {
          code: 'SPEC_DESCRIPTION_INVALID',
          message: `item「${itemId}」に許可されていないフィールドがあります: ${key}`,
        };
      }
    }
    for (const field of ['name', 'type', 'description', 'note'] as const) {
      if (typeof row[field] !== 'string') {
        return {
          code: 'SPEC_DESCRIPTION_INVALID',
          message: `item「${itemId}」の ${field} は文字列である必要があります。`,
        };
      }
    }
  }

  if (existing) {
    const existingIds = Object.keys(existing.items || {}).sort();
    const nextIds = [...itemIds].sort();
    if (
      existingIds.length !== nextIds.length ||
      existingIds.some((id, i) => id !== nextIds[i])
    ) {
      return {
        code: 'SPEC_DESCRIPTION_INVALID',
        message:
          'item ID の追加・削除・変更はできません。既存の項目 ID を維持してください。',
      };
    }
  }

  return null;
}

export function toEditableDocument(
  description: DescriptionSpec,
  fallbackScreenId = '',
): EditableDescriptionDocument {
  const items: EditableDescriptionDocument['items'] = {};
  for (const [id, item] of Object.entries(description.items || {})) {
    items[id] = {
      name: item.name ?? '',
      type: item.type ?? '',
      description: item.description ?? '',
      note: item.note ?? '',
    };
  }
  const screen = description.screen || {
    id: fallbackScreenId,
    name: '',
    description: '',
  };
  return {
    schemaVersion: description.schemaVersion || '1.0',
    screen: {
      id: screen.id || fallbackScreenId,
      name: screen.name ?? '',
      description: screen.description ?? '',
    },
    items,
  };
}

export function createEmptyEditableDocument(
  screenId: string,
): EditableDescriptionDocument {
  return {
    schemaVersion: '1.0',
    screen: {
      id: screenId,
      name: '',
      description: '',
    },
    items: {},
  };
}
