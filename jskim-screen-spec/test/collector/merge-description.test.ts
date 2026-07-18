import { describe, expect, it } from 'vitest';
import { mergeDescription } from '../../src/collector/merge-description.js';

describe('merge-description', () => {
  it('既存 item の説明文を保持し、新規 ID だけ空 entry を追加する（1.0 → 1.2 upgrade）', () => {
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
    expect(result.description.schemaVersion).toBe('1.2');
    expect(result.description.itemOrder).toEqual(['keep-me', 'orphan', 'new-item']);
    expect(result.description.excludedItems).toEqual({});
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
    expect(result.description.excludedItems).toBeUndefined();
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
    expect(result.description.itemOrder).toEqual(['b', 'a']);
    expect(result.description.excludedItems).toBeUndefined();
  });

  it('既存 1.1 に新規 ID がある場合は 1.2 へ upgrade する', () => {
    const result = mergeDescription({
      existing: {
        schemaVersion: '1.1',
        screen: { id: 'demo', name: 'デモ', description: '' },
        itemOrder: ['a'],
        items: {
          a: { name: '', type: '', description: '', note: '' },
        },
      },
      screenId: 'demo',
      foundItemIds: ['a', 'b'],
    });

    expect(result.description.schemaVersion).toBe('1.2');
    expect(result.description.itemOrder).toEqual(['a', 'b']);
    expect(result.description.excludedItems).toEqual({});
    expect(result.addedItemIds).toEqual(['b']);
  });

  it('Description が無い場合は 1.2 の draft を DOM 出現順の itemOrder で作成する', () => {
    const result = mergeDescription({
      existing: null,
      screenId: 'fresh',
      foundItemIds: ['a', 'b'],
    });

    expect(result.created).toBe(true);
    expect(result.description.schemaVersion).toBe('1.2');
    expect(result.description.screen).toEqual({
      id: 'fresh',
      name: '',
      description: '',
    });
    expect(Object.keys(result.description.items)).toEqual(['a', 'b']);
    expect(result.description.itemOrder).toEqual(['a', 'b']);
    expect(result.description.excludedItems).toEqual({});
  });

  it('excludedItems にある ID は items / itemOrder へ再追加しない', () => {
    const result = mergeDescription({
      existing: {
        schemaVersion: '1.2',
        screen: { id: 'demo', name: 'デモ', description: '' },
        itemOrder: ['keep'],
        excludedItems: {
          layout: {
            name: 'レイアウト',
            type: 'container',
            description: '除外',
            note: '',
          },
        },
        items: {
          keep: { name: '残す', type: 'text', description: '', note: '' },
        },
      },
      screenId: 'demo',
      foundItemIds: ['keep', 'layout', 'new-item'],
    });

    expect(result.addedItemIds).toEqual(['new-item']);
    expect(result.description.items.layout).toBeUndefined();
    expect(result.description.itemOrder).toEqual(['keep', 'new-item']);
    expect(result.description.excludedItems?.layout?.name).toBe('レイアウト');
    expect(result.description.schemaVersion).toBe('1.2');
  });

  it('既存 1.2 で追加が無くても excludedItems を維持する', () => {
    const result = mergeDescription({
      existing: {
        schemaVersion: '1.2',
        screen: { id: 'demo', name: 'デモ', description: '' },
        itemOrder: ['a'],
        excludedItems: {
          x: { name: 'X', type: '', description: '', note: '' },
        },
        items: {
          a: { name: '', type: '', description: '', note: '' },
        },
      },
      screenId: 'demo',
      foundItemIds: ['a', 'x'],
    });

    expect(result.addedItemIds).toEqual([]);
    expect(result.description.schemaVersion).toBe('1.2');
    expect(result.description.excludedItems).toEqual({
      x: { name: 'X', type: '', description: '', note: '' },
    });
    expect(result.description.itemOrder).toEqual(['a']);
  });

  it('orphan は items のみから計算する（excluded は orphan にしない）', () => {
    const result = mergeDescription({
      existing: {
        schemaVersion: '1.2',
        screen: { id: 'demo', name: '', description: '' },
        itemOrder: ['alive'],
        excludedItems: {
          gone: { name: 'Gone', type: '', description: '', note: '' },
        },
        items: {
          alive: { name: '', type: '', description: '', note: '' },
          stale: { name: '', type: '', description: '', note: '' },
        },
      },
      screenId: 'demo',
      foundItemIds: ['alive'],
    });

    expect(result.orphanItemIds).toEqual(['stale']);
    expect(result.description.excludedItems?.gone).toBeDefined();
  });
});
