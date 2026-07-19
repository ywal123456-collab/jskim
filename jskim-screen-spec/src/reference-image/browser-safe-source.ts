import type { ReferenceImageSource } from './types.js';

/**
 * Viewer / HTTP 向けに公開してよい Reference source。
 * fileKey / nodeId / URL / token は含めない。
 */
export type BrowserSafeReferenceSource =
  | { type: 'upload' }
  | { type: 'figma'; frameName: string; importedAt: string }
  | { type: 'unknown' };

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  const t = Date.parse(value);
  return Number.isFinite(t);
}

/**
 * server-side metadata.source を browser-safe に投影する。
 * 不明・不正な値は表示を壊さないよう unknown / upload へ落とす。
 */
export function toBrowserSafeReferenceSource(
  source: unknown,
): BrowserSafeReferenceSource | undefined {
  if (source == null || typeof source !== 'object' || Array.isArray(source)) {
    return undefined;
  }
  const obj = source as Record<string, unknown>;
  const type = obj.type;

  if (type === 'upload') {
    return { type: 'upload' };
  }

  if (type === 'figma') {
    const frameName =
      typeof obj.frameName === 'string' && obj.frameName.trim()
        ? obj.frameName.trim()
        : '（名称不明）';
    const importedAt = isIsoDate(obj.importedAt)
      ? obj.importedAt
      : undefined;
    if (!importedAt) {
      return { type: 'figma', frameName, importedAt: '' };
    }
    return { type: 'figma', frameName, importedAt };
  }

  if (typeof type === 'string' && type.length > 0) {
    return { type: 'unknown' };
  }

  return undefined;
}

/**
 * current Reference 向け。source 欠落時は upload とみなす（後方互換）。
 */
export function resolveBrowserSafeReferenceSource(
  source: ReferenceImageSource | unknown | undefined,
): BrowserSafeReferenceSource {
  const projected = toBrowserSafeReferenceSource(source);
  if (!projected) {
    return { type: 'upload' };
  }
  return projected;
}
