import type { ScreenData } from './types';

export type PreviewStylesheet = {
  href?: string;
  cssText?: string;
  media?: string;
};

export type ScreenViewBundle = {
  screen: ScreenData;
  selectedStateId: string;
  snapshotHtml: string;
  stylesheets: PreviewStylesheet[];
};

export type ScreenDataReloadOutcome =
  | { status: 'applied' }
  | { status: 'failed' }
  | { status: 'stale-or-aborted' };

export type FetchStateResourcesResult =
  | { kind: 'ok'; snapshotHtml: string; stylesheets: PreviewStylesheet[] }
  | { kind: 'failed' }
  | { kind: 'stale-or-aborted' };

export type FetchScreenModelJsonResult =
  | { kind: 'ok'; data: ScreenData }
  | { kind: 'http-error' }
  | { kind: 'aborted' };

/** 新しい Screen model から表示 state を決める */
export function resolveSelectedStateId(
  screen: ScreenData,
  preferredStateId: string | null,
): string {
  if (preferredStateId && screen.states.some((state) => state.id === preferredStateId)) {
    return preferredStateId;
  }
  const firstVisible =
    screen.states.find((state) => state.viewer.visible) || screen.states[0];
  return firstVisible?.id ?? '';
}

export async function fetchScreenModelJson(
  dataFile: string,
  baseUrl: string,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<FetchScreenModelJsonResult> {
  try {
    const screenRes = await fetchFn(`${baseUrl}data/${dataFile}`, {
      cache: 'no-store',
      signal,
    });
    if (signal.aborted) {
      return { kind: 'aborted' };
    }
    if (!screenRes.ok) {
      return { kind: 'http-error' };
    }
    const data = (await screenRes.json()) as ScreenData;
    if (signal.aborted) {
      return { kind: 'aborted' };
    }
    return { kind: 'ok', data };
  } catch {
    if (signal.aborted) {
      return { kind: 'aborted' };
    }
    return { kind: 'http-error' };
  }
}

export type ResolveStylesheetsResult =
  | { kind: 'ok'; stylesheets: PreviewStylesheet[] }
  | { kind: 'failed' }
  | { kind: 'stale-or-aborted' };

export async function resolveStylesheetsFromScreen(
  screen: ScreenData,
  stateId: string,
  signal: AbortSignal,
  isActive: () => boolean,
  fetchFn: typeof fetch = fetch,
): Promise<ResolveStylesheetsResult> {
  const state = screen.states.find((entry) => entry.id === stateId);
  const styles = state?.styles || [];
  const result: PreviewStylesheet[] = [];

  for (const style of styles) {
    if (!isActive() || signal.aborted) {
      return { kind: 'stale-or-aborted' };
    }
    if (style.disabled) {
      continue;
    }
    if (style.kind === 'style') {
      try {
        const res = await fetchFn(style.href, { signal });
        if (!isActive() || signal.aborted) {
          return { kind: 'stale-or-aborted' };
        }
        if (!res.ok) {
          if (isActive()) {
            return { kind: 'failed' };
          }
          return { kind: 'stale-or-aborted' };
        }
        const cssText = await res.text();
        if (!isActive() || signal.aborted) {
          return { kind: 'stale-or-aborted' };
        }
        result.push({ cssText, media: style.media || 'all' });
      } catch {
        if (signal.aborted || !isActive()) {
          return { kind: 'stale-or-aborted' };
        }
        return { kind: 'failed' };
      }
    } else {
      result.push({ href: style.href, media: style.media || 'all' });
    }
  }

  if (!isActive() || signal.aborted) {
    return { kind: 'stale-or-aborted' };
  }
  return { kind: 'ok', stylesheets: result };
}

export async function fetchStateResourcesFromScreen(
  screen: ScreenData,
  stateId: string,
  signal: AbortSignal,
  isActive: () => boolean,
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<FetchStateResourcesResult> {
  const state = screen.states.find((entry) => entry.id === stateId);
  if (!state) {
    if (isActive()) {
      return { kind: 'ok', snapshotHtml: '', stylesheets: [] };
    }
    return { kind: 'stale-or-aborted' };
  }

  try {
    const res = await fetchFn(`${baseUrl}data/${state.snapshotFile}`, { signal });
    if (!isActive() || signal.aborted) {
      return { kind: 'stale-or-aborted' };
    }
    if (!res.ok) {
      if (isActive()) {
        return { kind: 'failed' };
      }
      return { kind: 'stale-or-aborted' };
    }
    const snapshotHtml = await res.text();
    if (!isActive() || signal.aborted) {
      return { kind: 'stale-or-aborted' };
    }
    const stylesheetsResult = await resolveStylesheetsFromScreen(
      screen,
      stateId,
      signal,
      isActive,
      fetchFn,
    );
    if (stylesheetsResult.kind === 'stale-or-aborted') {
      return { kind: 'stale-or-aborted' };
    }
    if (stylesheetsResult.kind === 'failed') {
      if (isActive()) {
        return { kind: 'failed' };
      }
      return { kind: 'stale-or-aborted' };
    }
    if (!isActive() || signal.aborted) {
      return { kind: 'stale-or-aborted' };
    }
    return { kind: 'ok', snapshotHtml, stylesheets: stylesheetsResult.stylesheets };
  } catch {
    if (signal.aborted || !isActive()) {
      return { kind: 'stale-or-aborted' };
    }
    return { kind: 'failed' };
  }
}
