/**
 * 画面作成直後の pending 画面 ID を sessionStorage に保持するヘルパー。
 *
 * `jskim spec dev` では POST 成功後に viewer build → live reload（full page reload）
 * が走るため、作成した画面 ID を sessionStorage に残しておくことで、
 * reload 後の再 mount（main.ts）でも作成した画面へ遷移できるようにする。
 */

export const PENDING_SCREEN_KEY = 'jskim-spec-pending-screen';

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
