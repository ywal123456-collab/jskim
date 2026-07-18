export type ViewportId = 'pc' | 'sp';

export type ViewportPreset = {
  id: ViewportId;
  width: number;
  height: number;
  deviceScaleFactor: number;
};

/** Capture 政策 version（inputRevision に含める） */
export const CAPTURE_POLICY_VERSION = '1';

export const DEVICE_CAPTURE_FORMAT = 'png' as const;

export const DEVICE_CAPTURE_FULL_PAGE = true;

/** PNG 寸法上限（過大画像拒否） */
export const MAX_CAPTURE_IMAGE_WIDTH = 8192;
export const MAX_CAPTURE_IMAGE_HEIGHT = 65536;

export const VIEWPORT_PRESETS: Record<ViewportId, ViewportPreset> = {
  pc: {
    id: 'pc',
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
  },
  sp: {
    id: 'sp',
    width: 375,
    height: 812,
    deviceScaleFactor: 1,
  },
};

export function getViewportPreset(viewport: ViewportId): ViewportPreset {
  const preset = VIEWPORT_PRESETS[viewport];
  if (!preset) {
    throw new Error(`未知の viewport です: ${String(viewport)}`);
  }
  return preset;
}

/** generation PNG ファイル名: capture-<64hex>.png */
export const GENERATION_IMAGE_RE = /^capture-[0-9a-f]{64}\.png$/;

export function generationImageFileName(imageSha256Hex: string): string {
  const hex = imageSha256Hex.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error('imageRevision hex が不正です。');
  }
  return `capture-${hex}.png`;
}
