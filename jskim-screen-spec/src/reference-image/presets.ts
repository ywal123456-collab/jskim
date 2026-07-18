import {
  VIEWPORT_PRESETS,
  getViewportPreset,
  type ViewportId,
  type ViewportPreset,
} from '../device-capture/presets.js';

export type { ViewportId, ViewportPreset };
export { VIEWPORT_PRESETS, getViewportPreset };

/** 最大入力 PNG サイズ（20 MiB） */
export const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;

/** PNG 寸法上限 */
export const MAX_REFERENCE_IMAGE_WIDTH = 16384;
export const MAX_REFERENCE_IMAGE_HEIGHT = 65536;

export const REFERENCE_IMAGE_FORMAT = 'png' as const;

export const REFERENCE_IMAGE_SCHEMA_VERSION = '1.0' as const;

/** generation PNG: reference-<64hex>.png */
export const REFERENCE_GENERATION_IMAGE_RE =
  /^reference-[0-9a-f]{64}\.png$/;

export function referenceGenerationImageFileName(
  imageSha256Hex: string,
): string {
  const hex = imageSha256Hex.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error('imageRevision hex が不正です。');
  }
  return `reference-${hex}.png`;
}

export function isViewportId(value: unknown): value is ViewportId {
  return value === 'pc' || value === 'sp';
}
