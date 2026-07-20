import { describe, expect, it } from 'vitest';
import {
  VersionControlError,
  canonicalizeJson,
  canonicalizeJsonBytes,
} from '../../src/version-control/index.js';

describe('canonical JSON', () => {
  it('key 挿入順に依存しない', () => {
    const a = canonicalizeJson({ b: 1, a: 2 });
    const b = canonicalizeJson({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });

  it('nested object と配列順を扱う', () => {
    expect(canonicalizeJson({ z: { y: 1, x: [3, 1, 2] } })).toBe(
      '{"z":{"x":[3,1,2],"y":1}}',
    );
  });

  it('NFC 正規化と key 衝突検出', () => {
    const nfc = 'が'.normalize('NFC');
    const nfd = 'が'.normalize('NFD');
    expect(canonicalizeJson({ [nfc]: 1 })).toBe(canonicalizeJson({ [nfd]: 1 }));
    expect(() =>
      canonicalizeJson({ [nfc]: 1, [nfd]: 2 }),
    ).toThrow(VersionControlError);
  });

  it('日本語・韓国語・emoji を保持する', () => {
    const s = canonicalizeJson({
      ja: '画面',
      ko: '화면',
      emoji: '📐',
    });
    expect(s).toContain('画面');
    expect(s).toContain('화면');
    expect(s).toContain('📐');
  });

  it('-0 を 0 に正規化する', () => {
    expect(canonicalizeJson(-0)).toBe('0');
  });

  it('拒否値を弾く', () => {
    const bad: unknown[] = [
      undefined,
      NaN,
      Infinity,
      -Infinity,
      1n,
      new Date(),
      new Map(),
      new Set(),
      Buffer.from('x'),
      () => undefined,
      Symbol('x'),
    ];
    for (const value of bad) {
      expect(() => canonicalizeJson(value)).toThrow(VersionControlError);
    }
    const sparse: unknown[] = [];
    sparse[1] = 1;
    expect(() => canonicalizeJson(sparse)).toThrow(VersionControlError);
  });

  it('循環参照と prototype key を拒否する', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalizeJson(cyclic)).toThrow(VersionControlError);
    expect(() =>
      canonicalizeJson(JSON.parse('{"__proto__":{"x":1}}')),
    ).toThrow(VersionControlError);
  });

  it('同一入力は同一 bytes', () => {
    const value = { a: [1, { b: '画面' }], c: null, d: true };
    expect(
      Buffer.compare(canonicalizeJsonBytes(value), canonicalizeJsonBytes(value)),
    ).toBe(0);
  });

  it('golden: 空オブジェクト', () => {
    expect(canonicalizeJson({})).toBe('{}');
  });
});
