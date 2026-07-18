import { describe, expect, it } from 'vitest';
import {
  resolveDeleteScreenFallback,
  resolveFallbackAgainstCurrentScreens,
} from '../../src/viewer/editing/resolve-delete-screen-fallback';

describe('resolveDeleteScreenFallback', () => {
  it('中間画面削除 → 次の画面', () => {
    expect(resolveDeleteScreenFallback(['a', 'b', 'c'], 'b')).toEqual({
      kind: 'screen',
      screenId: 'c',
    });
  });

  it('最後の画面削除 → 前の画面', () => {
    expect(resolveDeleteScreenFallback(['a', 'b', 'c'], 'c')).toEqual({
      kind: 'screen',
      screenId: 'b',
    });
  });

  it('先頭画面削除 → 次の画面', () => {
    expect(resolveDeleteScreenFallback(['a', 'b', 'c'], 'a')).toEqual({
      kind: 'screen',
      screenId: 'b',
    });
  });

  it('唯一の画面削除 → empty', () => {
    expect(resolveDeleteScreenFallback(['only'], 'only')).toEqual({
      kind: 'empty',
    });
  });

  it('現在画面が一覧に無いとき → 先頭へ', () => {
    expect(resolveDeleteScreenFallback(['a', 'b'], 'missing')).toEqual({
      kind: 'screen',
      screenId: 'a',
    });
  });

  it('空一覧 → empty', () => {
    expect(resolveDeleteScreenFallback([], 'x')).toEqual({ kind: 'empty' });
  });
});

describe('resolveFallbackAgainstCurrentScreens', () => {
  it('preferred が残っていれば維持', () => {
    expect(
      resolveFallbackAgainstCurrentScreens(['a', 'c'], {
        kind: 'screen',
        screenId: 'c',
      }),
    ).toEqual({ kind: 'screen', screenId: 'c' });
  });

  it('preferred が消えたら先頭へ', () => {
    expect(
      resolveFallbackAgainstCurrentScreens(['a', 'z'], {
        kind: 'screen',
        screenId: 'c',
      }),
    ).toEqual({ kind: 'screen', screenId: 'a' });
  });

  it('残り 0 件なら empty', () => {
    expect(
      resolveFallbackAgainstCurrentScreens([], {
        kind: 'screen',
        screenId: 'c',
      }),
    ).toEqual({ kind: 'empty' });
  });

  it('preferred が empty でも画面が残っていれば先頭へ', () => {
    expect(
      resolveFallbackAgainstCurrentScreens(['a'], { kind: 'empty' }),
    ).toEqual({ kind: 'screen', screenId: 'a' });
  });
});
