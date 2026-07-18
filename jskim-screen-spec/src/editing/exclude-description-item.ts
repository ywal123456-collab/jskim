import type { EditableDescriptionDocument } from './validate-description-document.js';

function cloneItem(item: {
  name: string;
  type: string;
  description: string;
  note: string;
}): { name: string; type: string; description: string; note: string } {
  return {
    name: item.name,
    type: item.type,
    description: item.description,
    note: item.note,
  };
}

/**
 * 設計対象（items）の項目を除外一覧（excludedItems）へ移す。
 * itemOrder からも除去する。元 document は変更しない。
 */
export function excludeDescriptionItem(
  doc: EditableDescriptionDocument,
  itemId: string,
): EditableDescriptionDocument {
  if (doc.excludedItems[itemId]) {
    throw new Error(`項目「${itemId}」は既に除外されています。`);
  }
  const item = doc.items[itemId];
  if (!item) {
    throw new Error(`項目「${itemId}」は設計対象にありません。`);
  }

  const items = { ...doc.items };
  delete items[itemId];
  const excludedItems = {
    ...doc.excludedItems,
    [itemId]: cloneItem(item),
  };
  const itemOrder = doc.itemOrder.filter((id) => id !== itemId);

  return {
    schemaVersion: '1.2',
    screen: {
      id: doc.screen.id,
      name: doc.screen.name,
      description: doc.screen.description,
    },
    itemOrder,
    items,
    excludedItems,
  };
}

/**
 * 除外一覧の項目を設計対象へ戻す。
 * itemOrder の末尾に追加する。元 document は変更しない。
 */
export function restoreDescriptionItem(
  doc: EditableDescriptionDocument,
  itemId: string,
): EditableDescriptionDocument {
  const excluded = doc.excludedItems[itemId];
  if (!excluded) {
    throw new Error(`項目「${itemId}」は除外一覧にありません。`);
  }
  if (doc.items[itemId]) {
    throw new Error(`項目「${itemId}」は既に設計対象にあります。`);
  }

  const excludedItems = { ...doc.excludedItems };
  delete excludedItems[itemId];
  const items = {
    ...doc.items,
    [itemId]: cloneItem(excluded),
  };
  const itemOrder = [...doc.itemOrder, itemId];

  return {
    schemaVersion: '1.2',
    screen: {
      id: doc.screen.id,
      name: doc.screen.name,
      description: doc.screen.description,
    },
    itemOrder,
    items,
    excludedItems,
  };
}
