/**
 * 画面作成直後の pending 画面 ID を sessionStorage に保持するヘルパー。
 *
 * `jskim spec dev` では POST 成功後に viewer build → live reload（full page reload）
 * が走るため、作成した画面 ID を sessionStorage に残しておくことで、
 * reload 後の再 mount（main.ts）でも作成した画面へ遷移できるようにする。
 */

export const PENDING_SCREEN_KEY = 'jskim-spec-pending-screen';

/** DESIGN_ONLY 削除後の fallback（full reload 跨ぎ） */
export const PENDING_DELETE_FALLBACK_KEY = 'jskim-spec-pending-delete-fallback';

export type PendingDeleteFallback = {
  /** 削除した画面 ID（manifest から消えるのを待つ） */
  removedScreenId: string;
  /** 遷移先。empty のときは `_empty` */
  fallbackScreenId: string;
};

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

export function setPendingScreen(screenId: string): void {
  try {
    storage()?.setItem(PENDING_SCREEN_KEY, screenId);
  } catch {
    // sessionStorage が使えない環境（private mode 等）は無視する
  }
}

export function peekPendingScreen(): string | null {
  try {
    return storage()?.getItem(PENDING_SCREEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function clearPendingScreen(): void {
  try {
    storage()?.removeItem(PENDING_SCREEN_KEY);
  } catch {
    // ignore
  }
}

export function setPendingDeleteFallback(
  value: PendingDeleteFallback,
): void {
  try {
    storage()?.setItem(PENDING_DELETE_FALLBACK_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function peekPendingDeleteFallback(): PendingDeleteFallback | null {
  try {
    const raw = storage()?.getItem(PENDING_DELETE_FALLBACK_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PendingDeleteFallback;
    if (
      !parsed ||
      typeof parsed.removedScreenId !== 'string' ||
      typeof parsed.fallbackScreenId !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingDeleteFallback(): void {
  try {
    storage()?.removeItem(PENDING_DELETE_FALLBACK_KEY);
  } catch {
    // ignore
  }
}

export type WaitForScreenInManifestOptions = {
  manifestUrl: string;
  timeoutMs?: number;
  intervalMs?: number;
  fetchFn?: typeof fetch;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * manifest.json を polling し、指定 screenId が現れるまで待つ。
 * `jskim spec dev` の watcher が build するまでの反映待ちに使う
 * （固定 1 回の timeout ではなく、reload が来ない場合でも進行できるようにする）。
 *
 * @returns 見つかった場合 true、timeout まで見つからなければ false
 */
export async function waitForScreenInManifest(
  screenId: string,
  options: WaitForScreenInManifestOptions,
): Promise<boolean> {
  const {
    manifestUrl,
    timeoutMs = 10000,
    intervalMs = 200,
    fetchFn = fetch,
  } = options;
  const deadline = Date.now() + timeoutMs;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetchFn(`${manifestUrl}?_t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const manifest = (await res.json()) as {
          screens?: Array<{ id: string }>;
        };
        if (manifest.screens?.some((s) => s.id === screenId)) {
          return true;
        }
      }
    } catch {
      // 一時的な network / reload 中の失敗は無視して再試行する
    }

    if (Date.now() >= deadline) {
      return false;
    }
    await sleep(intervalMs);
  }
}

export type WaitForScreenAbsentOptions = WaitForScreenInManifestOptions;

/**
 * manifest から指定 screenId が消えるまで待つ（DESIGN_ONLY 削除後）。
 */
export async function waitForScreenAbsentFromManifest(
  screenId: string,
  options: WaitForScreenAbsentOptions,
): Promise<boolean> {
  const {
    manifestUrl,
    timeoutMs = 10000,
    intervalMs = 200,
    fetchFn = fetch,
  } = options;
  const deadline = Date.now() + timeoutMs;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetchFn(`${manifestUrl}?_t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const manifest = (await res.json()) as {
          screens?: Array<{ id: string }>;
        };
        const screens = manifest.screens || [];
        if (!screens.some((s) => s.id === screenId)) {
          return true;
        }
      }
    } catch {
      // 再試行
    }

    if (Date.now() >= deadline) {
      return false;
    }
    await sleep(intervalMs);
  }
}

export type WaitForScreenStatusOptions = WaitForScreenInManifestOptions & {
  status: string;
};

/**
 * 指定 screenId の status が期待値になるまで待つ（LINKED → implementation-only）。
 */
export async function waitForScreenStatusInManifest(
  screenId: string,
  options: WaitForScreenStatusOptions,
): Promise<boolean> {
  const {
    manifestUrl,
    status,
    timeoutMs = 10000,
    intervalMs = 200,
    fetchFn = fetch,
  } = options;
  const deadline = Date.now() + timeoutMs;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetchFn(`${manifestUrl}?_t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const manifest = (await res.json()) as {
          screens?: Array<{ id: string; status?: string }>;
        };
        const screen = manifest.screens?.find((s) => s.id === screenId);
        if (screen && screen.status === status) {
          return true;
        }
      }
    } catch {
      // 再試行
    }

    if (Date.now() >= deadline) {
      return false;
    }
    await sleep(intervalMs);
  }
}
