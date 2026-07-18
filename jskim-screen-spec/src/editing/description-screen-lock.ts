/**
 * Description の screenId 単位シリアライズ。
 * 同一 process 内の PUT / create / DELETE / Collector merge-write を直列化する。
 * 異なる screenId は並列可能。外部 editor の TOCTOU は対象外。
 */

const tails = new Map<string, Promise<unknown>>();

/**
 * 指定 screenId の临界区間を直列実行する。
 * 先行 operation が reject しても後続は実行される。
 * 完了後に tail が自分自身なら Map から除去する（memory leak 防止）。
 */
export function withDescriptionScreenLock<T>(
  screenId: string,
  operation: () => T | Promise<T>,
): Promise<T> {
  const key = String(screenId);
  const previous = tails.get(key) || Promise.resolve();

  const run = previous.then(
    () => operation(),
    () => operation(),
  );

  // 失敗しても chain を切らない（次の待機者が進める）
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
export function descriptionScreenLockSizeForTest(): number {
  return tails.size;
}

/** テスト用: 全 lock を破棄（異常終了後の掃除） */
export function resetDescriptionScreenLocksForTest(): void {
  tails.clear();
}
