import { parsePngIhdr } from '../util/png-ihdr.js';
import { createReferenceImageError } from './errors.js';
import {
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGE_HEIGHT,
  MAX_REFERENCE_IMAGE_WIDTH,
} from './presets.js';

/**
 * 参照画像 PNG を検証する（サイズ上限 → signature/IHDR → 寸法上限）。
 */
export function assertReferencePngBuffer(bytes: Buffer): {
  width: number;
  height: number;
} {
  if (bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_FILE_TOO_LARGE',
      '参照画像のファイルサイズが上限を超えています。',
    );
  }
  const parsed = parsePngIhdr(bytes);
  if (!parsed.ok) {
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_INVALID_PNG',
      parsed.reason,
    );
  }
  if (
    parsed.width > MAX_REFERENCE_IMAGE_WIDTH ||
    parsed.height > MAX_REFERENCE_IMAGE_HEIGHT
  ) {
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_DIMENSION_LIMIT',
      '参照画像の幅または高さが上限を超えています。',
    );
  }
  return { width: parsed.width, height: parsed.height };
}
