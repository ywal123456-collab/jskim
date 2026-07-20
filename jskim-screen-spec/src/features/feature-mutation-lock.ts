import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createFeatureError } from './errors.js';
import { featureMutationLockPath } from './paths.js';

const tails = new Map<string, Promise<unknown>>();

function projectKey(rootDir: string, projectName: string): string {
  return `${path.resolve(rootDir)}\0${projectName}`;
}

function assertOperation(operation: string): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(operation)) {
    throw createFeatureError(
      'SPEC_FEATURE_IN_PROGRESS',
      'Feature mutation lock の operation が不正です。',
    );
  }
}

function assertLockPathBoundary(
  lockPath: string,
  rootDir: string,
  projectName: string,
): void {
  const expected = path.resolve(featureMutationLockPath(rootDir, projectName));
  const resolved = path.resolve(lockPath);
  if (resolved !== expected) {
    throw createFeatureError(
      'SPEC_FEATURE_IN_PROGRESS',
      'Feature mutation lock の path が不正です。',
    );
  }
  try {
    const st = fs.lstatSync(path.dirname(lockPath));
    if (st.isSymbolicLink()) {
      throw createFeatureError(
        'SPEC_FEATURE_IN_PROGRESS',
        'Feature mutation lock の配置先が不正です。',
      );
    }
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'SPEC_FEATURE_IN_PROGRESS') {
      throw err;
    }
    // 親ディレクトリ未作成は acquire 側で mkdir する
  }
}

function acquireFeatureMutationLock(
  rootDir: string,
  projectName: string,
  operation: string,
): string {
  assertOperation(operation);
  const lock = featureMutationLockPath(rootDir, projectName);
  assertLockPathBoundary(lock, rootDir, projectName);
  const dir = path.dirname(lock);
  try {
    fs.mkdirSync(dir, { recursive: true });
    assertLockPathBoundary(lock, rootDir, projectName);
    const payload = {
      schemaVersion: '1.0',
      operation,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      operationId: crypto.randomUUID(),
    };
    fs.writeFileSync(lock, `${JSON.stringify(payload)}\n`, { flag: 'wx' });
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error
        ? String((error as { code: string }).code)
        : undefined;
    if (code === 'EEXIST') {
      throw createFeatureError(
        'SPEC_FEATURE_IN_PROGRESS',
        '機能構成の変更処理中です。しばらく待ってから再試行してください。',
      );
    }
    if (
      error instanceof Error &&
      'code' in error &&
      String((error as { code: string }).code).startsWith('SPEC_FEATURE_')
    ) {
      throw error;
    }
    throw createFeatureError(
      'SPEC_FEATURE_IN_PROGRESS',
      'Feature mutation lock を取得できませんでした。',
    );
  }
  return lock;
}

function releaseFeatureMutationLock(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // stale lock は次操作で EEXIST として検出し、自動削除しない
  }
}

/**
 * 同一 project の Feature mutation を process 内 + filesystem で直列化する。
 */
export function withFeatureMutationLock<T>(
  options: { rootDir: string; projectName: string },
  operation: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const key = projectKey(options.rootDir, options.projectName);
  const previous = tails.get(key) || Promise.resolve();

  const run = previous.then(async () => {
    const lockPath = acquireFeatureMutationLock(
      options.rootDir,
      options.projectName,
      operation,
    );
    try {
      return await fn();
    } finally {
      releaseFeatureMutationLock(lockPath);
    }
  });

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

/** テスト用: 待機中 lock entry 数 */
export function featureMutationLockQueueSizeForTest(): number {
  return tails.size;
}

/** テスト用: in-process queue を破棄 */
export function resetFeatureMutationLocksForTest(): void {
  tails.clear();
}
