/**
 * Description JSON の project + screenId 単位 mutation 直列化。
 * 同一 process 内 queue + filesystem lock（`spec/{project}/.jskim/description-mutation/`）。
 * Group mutation / legacy PUT / Collector write / create / DELETE が共通境界を使う。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { containsPathTraversal, isValidScreenId } from '../util/screen-id.js';
import { DescriptionDocumentError } from './description-document/errors.js';
import { descriptionScreenMutationLockPath } from './description-document/paths.js';

export type DescriptionScreenLockContext = {
  rootDir: string;
  projectName: string;
  screenId: string;
};

const tails = new Map<string, Promise<unknown>>();

function lockKey(rootDir: string, projectName: string, screenId: string): string {
  return `${path.resolve(rootDir)}\0${projectName}\0${screenId}`;
}

function assertContext(ctx: DescriptionScreenLockContext): void {
  if (!isValidScreenId(ctx.screenId) || containsPathTraversal(ctx.screenId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: '画面 ID が不正です。',
    });
  }
}

function assertOperation(operation: string): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(operation)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_MUTATION_IN_PROGRESS',
      message: 'Description mutation lock の operation が不正です。',
    });
  }
}

function assertLockPathBoundary(
  lockPath: string,
  rootDir: string,
  projectName: string,
  screenId: string,
): void {
  const expected = path.resolve(
    descriptionScreenMutationLockPath(rootDir, projectName, screenId),
  );
  const resolved = path.resolve(lockPath);
  if (resolved !== expected) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_MUTATION_IN_PROGRESS',
      message: 'Description mutation lock の path が不正です。',
    });
  }
  try {
    const st = fs.lstatSync(path.dirname(lockPath));
    if (st.isSymbolicLink()) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_MUTATION_IN_PROGRESS',
        message: 'Description mutation lock の配置先が不正です。',
      });
    }
  } catch (err) {
    if (err instanceof DescriptionDocumentError) {
      throw err;
    }
    // 親ディレクトリ未作成は acquire 側で mkdir する
  }
}

function acquireDescriptionScreenMutationLock(
  rootDir: string,
  projectName: string,
  screenId: string,
  operation: string,
): string {
  assertOperation(operation);
  const lock = descriptionScreenMutationLockPath(rootDir, projectName, screenId);
  assertLockPathBoundary(lock, rootDir, projectName, screenId);
  const dir = path.dirname(lock);
  try {
    fs.mkdirSync(dir, { recursive: true });
    assertLockPathBoundary(lock, rootDir, projectName, screenId);
    const payload = {
      schemaVersion: '1.0',
      operation,
      screenId,
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
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_MUTATION_IN_PROGRESS',
        message:
          '画面設計書の変更処理中です。しばらく待ってから再試行してください。',
      });
    }
    if (error instanceof DescriptionDocumentError) {
      throw error;
    }
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_MUTATION_IN_PROGRESS',
      message: 'Description mutation lock を取得できませんでした。',
    });
  }
  return lock;
}

function releaseDescriptionScreenMutationLock(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // stale lock は次操作で EEXIST として検出し、自動削除しない
  }
}

/**
 * 指定 screen の Description mutation 临界区間を直列実行する。
 * lock 取得後に fn を実行する。先行 operation が reject しても後続は実行される。
 */
export function withDescriptionScreenLock<T>(
  ctx: DescriptionScreenLockContext,
  operation: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  assertContext(ctx);
  const key = lockKey(ctx.rootDir, ctx.projectName, ctx.screenId);
  const previous = tails.get(key) || Promise.resolve();

  const run = previous.then(async () => {
    const lockPath = acquireDescriptionScreenMutationLock(
      ctx.rootDir,
      ctx.projectName,
      ctx.screenId,
      operation,
    );
    try {
      return await fn();
    } finally {
      releaseDescriptionScreenMutationLock(lockPath);
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

/**
 * legacy PUT / create / DELETE API 向け: `(screenId, fn)` シグネチャへ束縛する。
 */
export function bindDescriptionScreenLock(
  rootDir: string,
  projectName: string,
): <T>(screenId: string, fn: () => T | Promise<T>) => Promise<T> {
  return (screenId, fn) =>
    withDescriptionScreenLock(
      { rootDir, projectName, screenId },
      'legacy-edit',
      fn,
    );
}

/** テスト用: 待機中・保持中の lock entry 数 */
export function descriptionScreenLockSizeForTest(): number {
  return tails.size;
}

/** テスト用: 全 lock を破棄（異常終了後の掃除） */
export function resetDescriptionScreenLocksForTest(): void {
  tails.clear();
}
