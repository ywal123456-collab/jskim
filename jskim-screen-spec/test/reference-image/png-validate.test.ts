import { describe, expect, it } from 'vitest';
import { assertReferencePngBuffer } from '../../src/reference-image/png-validate.js';
import { ReferenceImageError } from '../../src/reference-image/errors.js';
import {
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGE_HEIGHT,
  MAX_REFERENCE_IMAGE_WIDTH,
} from '../../src/reference-image/presets.js';
import { buildPng } from './helpers.js';

describe('Reference Image PNG 検証', () => {
  it('PC/SP 相当寸法を読む', () => {
    expect(assertReferencePngBuffer(buildPng(1440, 900))).toEqual({
      width: 1440,
      height: 900,
    });
    expect(assertReferencePngBuffer(buildPng(375, 812))).toEqual({
      width: 375,
      height: 812,
    });
  });

  it('2x export 寸法を許可する', () => {
    expect(assertReferencePngBuffer(buildPng(2880, 1800))).toEqual({
      width: 2880,
      height: 1800,
    });
  });

  it('シグネチャ不正を拒否する', () => {
    expect(() => assertReferencePngBuffer(Buffer.from('JPEG....'))).toThrow(
      ReferenceImageError,
    );
  });

  it('truncated PNG を拒否する', () => {
    expect(() => assertReferencePngBuffer(Buffer.alloc(10))).toThrow(
      /短すぎ|シグネチャ/,
    );
  });

  it('0 寸法を拒否する', () => {
    expect(() => assertReferencePngBuffer(buildPng(0, 100))).toThrow(
      ReferenceImageError,
    );
  });

  it('幅・高さ上限を拒否する', () => {
    expect(() =>
      assertReferencePngBuffer(buildPng(MAX_REFERENCE_IMAGE_WIDTH + 1, 100)),
    ).toThrow(/幅または高さ/);
    expect(() =>
      assertReferencePngBuffer(buildPng(100, MAX_REFERENCE_IMAGE_HEIGHT + 1)),
    ).toThrow(/幅または高さ/);
  });

  it('20 MiB 境界: ちょうど上限以下は通過し超過は拒否', () => {
    const base = buildPng(10, 10);
    const under = Buffer.concat([
      base,
      Buffer.alloc(MAX_REFERENCE_IMAGE_BYTES - base.length),
    ]);
    expect(under.length).toBe(MAX_REFERENCE_IMAGE_BYTES);
    expect(assertReferencePngBuffer(under)).toEqual({ width: 10, height: 10 });

    const over = Buffer.concat([under, Buffer.from([0])]);
    expect(() => assertReferencePngBuffer(over)).toThrow(
      /ファイルサイズが上限/,
    );
  });
});
