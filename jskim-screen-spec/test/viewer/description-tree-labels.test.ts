import { describe, expect, it } from 'vitest';
import { formatGroupKindLabel } from '../../src/viewer/editing/description-tree-labels.js';

describe('formatGroupKindLabel', () => {
  it('既知 kind を日本語ラベルに変換する', () => {
    expect(formatGroupKindLabel('SECTION')).toBe('セクション');
    expect(formatGroupKindLabel('REPEATABLE')).toBe('繰り返し');
    expect(formatGroupKindLabel('ACTIONS')).toBe('操作');
  });

  it('unknown kind は保存値を表示する', () => {
    expect(formatGroupKindLabel('UNKNOWN_KIND')).toBe('UNKNOWN_KIND');
    expect(formatGroupKindLabel('')).toBe('不明');
  });
});
