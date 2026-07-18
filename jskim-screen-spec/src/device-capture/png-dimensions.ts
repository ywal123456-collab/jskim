import {
  MAX_CAPTURE_IMAGE_HEIGHT,
  MAX_CAPTURE_IMAGE_WIDTH,
} from './presets.js';
import { createDeviceCaptureError } from './errors.js';

const PNG_SIG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * PNG IHDR から width/height を読む最小パーサ。
 */
export function readPngDimensions(bytes: Buffer): {
  width: number;
  height: number;
} {
  if (bytes.length < 33) {
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_INVALID_PNG',
      'PNG が短すぎます。',
    );
  }
  if (!bytes.subarray(0, 8).equals(PNG_SIG)) {
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_INVALID_PNG',
      'PNG シグネチャが不正です。',
    );
  }
  const length = bytes.readUInt32BE(8);
  const type = bytes.subarray(12, 16).toString('ascii');
  if (type !== 'IHDR' || length !== 13) {
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_INVALID_PNG',
      'PNG IHDR が見つかりません。',
    );
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0) {
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_INVALID_PNG',
      'PNG の幅または高さが 0 です。',
    );
  }
  if (width > MAX_CAPTURE_IMAGE_WIDTH || height > MAX_CAPTURE_IMAGE_HEIGHT) {
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_DIMENSION_LIMIT',
      `PNG 寸法が上限を超えています（最大 ${MAX_CAPTURE_IMAGE_WIDTH}x${MAX_CAPTURE_IMAGE_HEIGHT}）。` +
        ` 実際: ${width}x${height}`,
    );
  }
  return { width, height };
}

export function assertPngBuffer(bytes: Buffer): {
  width: number;
  height: number;
} {
  return readPngDimensions(bytes);
}
