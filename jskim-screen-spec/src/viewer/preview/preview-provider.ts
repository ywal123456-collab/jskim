/**
 * Preview provider 選択（Live / PC / SP / 参照）。
 * project 単位で sessionStorage に保持する。
 */

export type PreviewProvider = 'live' | 'pc' | 'sp' | 'reference';

export type DeviceCaptureViewport = 'pc' | 'sp';

export type ReferenceViewport = 'pc' | 'sp';

const STORAGE_PREFIX = 'jskim-spec-preview-provider:';

const VALID: ReadonlySet<string> = new Set(['live', 'pc', 'sp', 'reference']);

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

export function isReferenceViewport(
  value: unknown,
): value is ReferenceViewport {
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

export type PreviewTabAvailability = {
  /** Live / PC / SP タブを出せるか（実装 Preview あり） */
  canShowDeviceTabs: boolean;
  /** 参照タブを出せるか */
  canShowReferenceTab: boolean;
};

/**
 * 現在画面で選べる Preview provider 一覧。
 * DESIGN_ONLY では参照のみ、実装ありでは Live/PC/SP/参照。
 */
export function listAvailablePreviewProviders(
  options: PreviewTabAvailability,
): PreviewProvider[] {
  const list: PreviewProvider[] = [];
  if (options.canShowDeviceTabs) {
    list.push('live', 'pc', 'sp');
  }
  if (options.canShowReferenceTab) {
    list.push('reference');
  }
  return list;
}

/**
 * preferred を可能な限り尊重する。
 * タブが無い場合は 'live'（呼び出し側で No Preview 判定）。
 * preferred が現在タブに無い場合は先頭（通常 Live、DESIGN_ONLY なら reference）。
 */
export function resolveEffectivePreviewProvider(
  preferred: PreviewProvider,
  options: PreviewTabAvailability,
): PreviewProvider {
  const available = listAvailablePreviewProviders(options);
  if (available.length === 0) {
    return 'live';
  }
  if (available.includes(preferred)) {
    return preferred;
  }
  return available[0];
}
