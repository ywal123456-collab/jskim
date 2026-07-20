import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createVersionControlError } from './errors.js';
import { assertMetadataPathBoundary } from './fs-guards.js';
import { versionRepositoryPath } from './repository-paths.js';

/**
 * lock の取得順序: mutation lock → index lock → ref CAS。
 */

function lockPath(rootDir: string, projectName: string): string {
  return path.join(
    versionRepositoryPath(rootDir, projectName),
    'locks',
    'mutation.lock',
  );
}

function assertOperation(operation: string): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(operation)) {
    throw createVersionControlError(
      'SPEC_VERSION_REPOSITORY_IN_PROGRESS',
      'mutation lock の operation が不正です。',
    );
  }
}

function acquireMutationLock(
  options: { rootDir: string; projectName: string },
  operation: string,
): string {
  assertOperation(operation);
  const repo = versionRepositoryPath(options.rootDir, options.projectName);
  if (!fs.existsSync(path.join(repo, 'format.json'))) {
    throw createVersionControlError(
      'SPEC_VERSION_NOT_INITIALIZED',
      '版管理リポジトリが初期化されていません。',
    );
  }
  const locks = path.join(repo, 'locks');
  const lock = lockPath(options.rootDir, options.projectName);
  try {
    fs.mkdirSync(locks, { recursive: true });
    assertMetadataPathBoundary(locks, 'locks');
    assertMetadataPathBoundary(lock, 'mutation lock');
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
      throw createVersionControlError(
        'SPEC_VERSION_REPOSITORY_IN_PROGRESS',
        '版管理リポジトリは他の変更処理中です。',
      );
    }
    if (error instanceof Error && 'code' in error && code?.startsWith('SPEC_VERSION_')) {
      throw error;
    }
    throw createVersionControlError(
      'SPEC_VERSION_REPOSITORY_IN_PROGRESS',
      'mutation lock を取得できませんでした。',
    );
  }
  return lock;
}

function releaseMutationLock(lock: string): void {
  try {
    fs.unlinkSync(lock);
  } catch {
    // stale lock は次操作で明示的に検出し、自動削除しない
  }
}

/** リポジトリ全体を変更する操作を exclusive lock で囲む。 */
export function withMutationLock<T>(
  options: { rootDir: string; projectName: string },
  operation: string,
  fn: () => T,
): T {
  const lock = acquireMutationLock(options, operation);
  try {
    return fn();
  } finally {
    releaseMutationLock(lock);
  }
}
