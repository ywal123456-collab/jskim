import { parsePngIhdr } from '../util/png-ihdr.js';
import {
  MAX_CAPTURE_IMAGE_HEIGHT,
  MAX_CAPTURE_IMAGE_WIDTH,
} from './presets.js';
import { createDeviceCaptureError } from './errors.js';

/**
 * PNG IHDR から width/height を読む最小パーサ。
 */
export function readPngDimensions(bytes: Buffer): {
  width: number;
  height: number;
} {
  const parsed = parsePngIhdr(bytes);
  if (!parsed.ok) {
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_INVALID_PNG',
      parsed.reason,
    );
  }
  if (
    parsed.width > MAX_CAPTURE_IMAGE_WIDTH ||
    parsed.height > MAX_CAPTURE_IMAGE_HEIGHT
  ) {
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_DIMENSION_LIMIT',
      `PNG 寸法が上限を超えています（最大 ${MAX_CAPTURE_IMAGE_WIDTH}x${MAX_CAPTURE_IMAGE_HEIGHT}）。` +
        ` 実際: ${parsed.width}x${parsed.height}`,
    );
  }
  return { width: parsed.width, height: parsed.height };
}

export function assertPngBuffer(bytes: Buffer): {
  width: number;
  height: number;
} {
  return readPngDimensions(bytes);
}
