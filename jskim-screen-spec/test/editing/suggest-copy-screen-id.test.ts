import { describe, expect, it } from 'vitest';
import {
  suggestCopyScreenId,
  suggestCopyScreenName,
} from '../../src/viewer/editing/suggest-copy-screen-id';

describe('suggestCopyScreenId / suggestCopyScreenName', () => {
  it('衝突しない -copy / -copy-2 を提案する', () => {
    expect(suggestCopyScreenId('inquiry-input', [])).toBe('inquiry-input-copy');
    expect(
      suggestCopyScreenId('inquiry-input', ['inquiry-input-copy']),
    ).toBe('inquiry-input-copy-2');
    expect(
      suggestCopyScreenId('inquiry-input', [
        'inquiry-input-copy',
        'inquiry-input-copy-2',
      ]),
    ).toBe('inquiry-input-copy-3');
  });

  it('最大長を超えないように suffix 空間を確保する', () => {
    const long = 'a'.repeat(120);
    const suggested = suggestCopyScreenId(long, []);
    expect(suggested.length).toBeLessThanOrEqual(128);
    expect(suggested.endsWith('-copy')).toBe(true);
  });

  it('画面名に 「 コピー」を付ける', () => {
    expect(suggestCopyScreenName('商品登録')).toBe('商品登録 コピー');
    const longName = 'あ'.repeat(198);
    const name = suggestCopyScreenName(longName);
    expect(name.length).toBeLessThanOrEqual(200);
    expect(name.endsWith(' コピー')).toBe(true);
  });
});
