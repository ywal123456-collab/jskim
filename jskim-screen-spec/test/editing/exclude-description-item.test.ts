import { describe, expect, it } from 'vitest';
import {
  excludeDescriptionItem,
  restoreDescriptionItem,
} from '../../src/editing/exclude-description-item.js';
import { createEmptyEditableDocument } from '../../src/editing/validate-description-document.js';

describe('exclude-description-item', () => {
  function sampleDoc() {
    const doc = createEmptyEditableDocument('demo');
    doc.screen.name = 'Demo';
    doc.items = {
      title: {
        name: 'タイトル',
        type: 'text',
        description: '見出し',
        note: 'n',
      },
      submit: {
        name: '送信',
        type: 'button',
        description: '',
        note: '',
      },
    };
    doc.itemOrder = ['title', 'submit'];
    return doc;
  }

  it('exclude は説明を excludedItems へ退避し itemOrder から外す', () => {
    const doc = sampleDoc();
    const next = excludeDescriptionItem(doc, 'title');

    expect(next.items.title).toBeUndefined();
    expect(next.itemOrder).toEqual(['submit']);
    expect(next.excludedItems.title).toEqual({
      name: 'タイトル',
      type: 'text',
      description: '見出し',
      note: 'n',
    });
    expect(next.schemaVersion).toBe('1.2');
    // 元は変更しない
    expect(doc.items.title).toBeDefined();
    expect(doc.itemOrder).toEqual(['title', 'submit']);
  });

  it('restore は説明を戻し itemOrder 末尾へ追加する', () => {
    const excluded = excludeDescriptionItem(sampleDoc(), 'title');
    const restored = restoreDescriptionItem(excluded, 'title');

    expect(restored.items.title).toEqual({
      name: 'タイトル',
      type: 'text',
      description: '見出し',
      note: 'n',
    });
    expect(restored.excludedItems.title).toBeUndefined();
    expect(restored.itemOrder).toEqual(['submit', 'title']);
  });

  it('存在しない ID の exclude / restore は Error を投げる', () => {
    const doc = sampleDoc();
    expect(() => excludeDescriptionItem(doc, 'missing')).toThrow(/設計対象/);
    expect(() => restoreDescriptionItem(doc, 'title')).toThrow(/除外一覧/);
  });

  it('二重 exclude / 二重 restore は Error を投げる', () => {
    const excluded = excludeDescriptionItem(sampleDoc(), 'title');
    expect(() => excludeDescriptionItem(excluded, 'title')).toThrow(/既に除外/);
    const restored = restoreDescriptionItem(excluded, 'title');
    expect(() => restoreDescriptionItem(restored, 'title')).toThrow(/除外一覧/);
  });
});
