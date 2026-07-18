import { describe, expect, it } from 'vitest';
import {
  assertPngBuffer,
  readPngDimensions,
} from '../../src/device-capture/png-dimensions.js';
import { DeviceCaptureError } from '../../src/device-capture/errors.js';
import {
  MAX_CAPTURE_IMAGE_HEIGHT,
  MAX_CAPTURE_IMAGE_WIDTH,
} from '../../src/device-capture/presets.js';

/** 最小有効 PNG（1x1）を組み立てる */
function buildPng(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type RGB
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const type = Buffer.from('IHDR');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(13, 0);
  const crc = Buffer.alloc(4); // 検証しないので 0 でよい
  return Buffer.concat([sig, len, type, ihdrData, crc]);
}

describe('PNG dimensions', () => {
  it('IHDR から width/height を読む', () => {
    const png = buildPng(1440, 900);
    expect(readPngDimensions(png)).toEqual({ width: 1440, height: 900 });
  });

  it('シグネチャ不正を拒否する', () => {
    const bad = Buffer.from('not-a-png-file!!!!!!!');
    expect(() => assertPngBuffer(bad)).toThrow(DeviceCaptureError);
  });

  it('0 寸法を拒否する', () => {
    expect(() => assertPngBuffer(buildPng(0, 100))).toThrow(DeviceCaptureError);
  });

  it('寸法上限を拒否する', () => {
    expect(() =>
      assertPngBuffer(buildPng(MAX_CAPTURE_IMAGE_WIDTH + 1, 100)),
    ).toThrow(/上限/);
    expect(() =>
      assertPngBuffer(buildPng(100, MAX_CAPTURE_IMAGE_HEIGHT + 1)),
    ).toThrow(/上限/);
  });

  it('短すぎるファイルを拒否する', () => {
    expect(() => assertPngBuffer(Buffer.alloc(10))).toThrow(DeviceCaptureError);
  });
});
