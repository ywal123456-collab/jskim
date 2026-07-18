/**
 * Preview provider 選択（Live / PC / SP）。
 * project 単位で sessionStorage に保持する。
 */

export type PreviewProvider = 'live' | 'pc' | 'sp';

export type DeviceCaptureViewport = 'pc' | 'sp';

const STORAGE_PREFIX = 'jskim-spec-preview-provider:';

const VALID: ReadonlySet<string> = new Set(['live', 'pc', 'sp']);

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === 'undefined') {
      return null;
    }
    return sessionStorage;
  } catch {
    return null;
  }
}

export function previewProviderStorageKey(projectName: string): string {
  return `${STORAGE_PREFIX}${projectName}`;
}

export function isPreviewProvider(value: unknown): value is PreviewProvider {
  return typeof value === 'string' && VALID.has(value);
}

export function isDeviceCaptureViewport(
  value: unknown,
): value is DeviceCaptureViewport {
  return value === 'pc' || value === 'sp';
}

/** 壊れた値は Live にフォールバック */
export function normalizePreviewProvider(value: unknown): PreviewProvider {
  return isPreviewProvider(value) ? value : 'live';
}

export function readPreferredPreviewProvider(
  projectName: string,
): PreviewProvider {
  try {
    const raw = storage()?.getItem(previewProviderStorageKey(projectName));
    return normalizePreviewProvider(raw);
  } catch {
    return 'live';
  }
}

export function writePreferredPreviewProvider(
  projectName: string,
  provider: PreviewProvider,
): void {
  if (!isPreviewProvider(provider)) {
    return;
  }
  try {
    storage()?.setItem(previewProviderStorageKey(projectName), provider);
  } catch {
    // private mode 等は無視
  }
}

/**
 * 実装 Preview がある画面では preferred をそのまま使う。
 * DESIGN_ONLY 等でタブが出せない場合は effective を決めず呼び出し側で No Preview にする。
 */
export function resolveEffectivePreviewProvider(
  preferred: PreviewProvider,
  options: { canShowDeviceTabs: boolean },
): PreviewProvider {
  if (!options.canShowDeviceTabs) {
    return 'live';
  }
  return preferred;
}
