import { describe, expect, it } from 'vitest';
import { MAX_ITEM_ID_LENGTH } from '../../src/viewer/editing/create-item-validation';
import { suggestCopyItemId } from '../../src/viewer/editing/suggest-copy-item-id';

describe('suggestCopyItemId', () => {
  it('未使用なら -copy を付ける', () => {
    expect(suggestCopyItemId('inquiry-content', [])).toBe(
      'inquiry-content-copy',
    );
  });

  it('衝突時は -copy-2 以降を使う', () => {
    expect(
      suggestCopyItemId('inquiry-content', [
        'inquiry-content',
        'inquiry-content-copy',
      ]),
    ).toBe('inquiry-content-copy-2');

    expect(
      suggestCopyItemId('inquiry-content', [
        'inquiry-content',
        'inquiry-content-copy',
        'inquiry-content-copy-2',
      ]),
    ).toBe('inquiry-content-copy-3');
  });

  it('最大長を超えない', () => {
    const longBase = 'a'.repeat(MAX_ITEM_ID_LENGTH - 2);
    const suggested = suggestCopyItemId(longBase, []);
    expect(suggested.length).toBeLessThanOrEqual(MAX_ITEM_ID_LENGTH);
    expect(suggested.endsWith('-copy') || suggested.includes('-copy-')).toBe(
      true,
    );
  });
});
