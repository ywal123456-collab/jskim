/**
 * Reference Image の project + screenId + viewport 単位シリアライズ。
 * 同一 key は直列。異なる viewport / screen は並列可能。
 */

const tails = new Map<string, Promise<unknown>>();

export function referenceImageLockKey(options: {
  projectName: string;
  screenId: string;
  viewport: string;
}): string {
  return `${options.projectName}\0${options.screenId}\0${options.viewport}`;
}

/**
 * 指定 key の临界区間を直列実行する。
 * 先行 operation が reject しても後続は実行される。
 * settled 後に tail が自分自身なら Map から除去する。
 */
export function withReferenceImageLock<T>(
  key: string,
  operation: () => T | Promise<T>,
): Promise<T> {
  const previous = tails.get(key) || Promise.resolve();

  const run = previous.then(
    () => operation(),
    () => operation(),
  );

  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, settled);

  settled.then(() => {
    if (tails.get(key) === settled) {
      tails.delete(key);
    }
  });

  return run;
}

/** テスト用: 待機中・保持中の lock entry 数 */
export function referenceImageLockSizeForTest(): number {
  return tails.size;
}

/** テスト用: 全 lock を破棄 */
export function resetReferenceImageLocksForTest(): void {
  tails.clear();
}
