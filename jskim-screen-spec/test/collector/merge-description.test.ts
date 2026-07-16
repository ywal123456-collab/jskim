import { describe, expect, it } from 'vitest';
import { mergeDescription } from '../../src/collector/merge-description.js';

describe('merge-description', () => {
  it('既存 item の説明文を保持し、新規 ID だけ空 entry を追加する（1.0 → 1.1 upgrade）', () => {
    const result = mergeDescription({
      existing: {
        schemaVersion: '1.0',
        screen: {
          id: 'demo',
          name: 'デモ',
          description: '説明',
        },
        items: {
          'keep-me': {
            name: '残す',
            type: 'ボタン',
            description: '既存の説明',
            note: 'メモ',
          },
          orphan: {
            name: '旧',
            type: '表示',
            description: 'orphan',
            note: '',
          },
        },
      },
      screenId: 'demo',
      foundItemIds: ['keep-me', 'new-item'],
    });

    expect(result.description.items['keep-me'].description).toBe('既存の説明');
    expect(result.description.items['keep-me'].note).toBe('メモ');
    expect(result.description.items['new-item']).toEqual({
      name: '',
      type: '',
      description: '',
      note: '',
    });
    expect(result.addedItemIds).toEqual(['new-item']);
    expect(result.orphanItemIds).toEqual(['orphan']);
    expect(result.description.items.orphan.description).toBe('orphan');
    // item が追加されたため 1.1 へ upgrade し、既存の並びを保ったまま新規 ID を末尾に追加する
    expect(result.description.schemaVersion).toBe('1.1');
    expect(result.description.itemOrder).toEqual(['keep-me', 'orphan', 'new-item']);
  });

  it('item の追加・削除が無い場合は 1.0 のまま維持する（不要な upgrade をしない）', () => {
    const result = mergeDescription({
      existing: {
        schemaVersion: '1.0',
        screen: {
          id: 'demo',
          name: 'デモ',
          description: '説明',
        },
        items: {
          title: {
            name: 'タイトル',
            type: 'text',
            description: '',
            note: '',
          },
        },
      },
      screenId: 'demo',
      foundItemIds: ['title'],
    });

    expect(result.addedItemIds).toEqual([]);
    expect(result.description.schemaVersion).toBe('1.0');
    expect(result.description.itemOrder).toBeUndefined();
  });

  it('既存が 1.1 の場合は内容変更が無くても itemOrder を維持したまま 1.1 を保つ', () => {
    const result = mergeDescription({
      existing: {
        schemaVersion: '1.1',
        screen: {
          id: 'demo',
          name: 'デモ',
          description: '説明',
        },
        itemOrder: ['b', 'a'],
        items: {
          a: { name: '', type: '', description: '', note: '' },
          b: { name: '', type: '', description: '', note: '' },
        },
      },
      screenId: 'demo',
      foundItemIds: ['a', 'b'],
    });

    expect(result.description.schemaVersion).toBe('1.1');
    // 人が並べた順序（b, a）を維持する
    expect(result.description.itemOrder).toEqual(['b', 'a']);
  });

  it('Description が無い場合は 1.1 の draft を DOM 出現順の itemOrder で作成する', () => {
    const result = mergeDescription({
      existing: null,
      screenId: 'fresh',
      foundItemIds: ['a', 'b'],
    });

    expect(result.created).toBe(true);
    expect(result.description.schemaVersion).toBe('1.1');
    expect(result.description.screen).toEqual({
      id: 'fresh',
      name: '',
      description: '',
    });
    expect(Object.keys(result.description.items)).toEqual(['a', 'b']);
    expect(result.description.itemOrder).toEqual(['a', 'b']);
  });
});
