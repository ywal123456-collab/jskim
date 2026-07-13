import { describe, expect, it } from 'vitest';
import { mergeDescription } from '../../src/collector/merge-description.js';

describe('merge-description', () => {
  it('既存 item の説明文を保持し、新規 ID だけ空 entry を追加する', () => {
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
  });

  it('Description が無い場合は draft を作成する', () => {
    const result = mergeDescription({
      existing: null,
      screenId: 'fresh',
      foundItemIds: ['a', 'b'],
    });

    expect(result.created).toBe(true);
    expect(result.description.schemaVersion).toBe('1.0');
    expect(result.description.screen).toEqual({
      id: 'fresh',
      name: '',
      description: '',
    });
    expect(Object.keys(result.description.items)).toEqual(['a', 'b']);
  });
});
