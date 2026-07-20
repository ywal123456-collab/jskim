import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalizeJsonBytes } from './canonical-json.js';
import { createVersionControlError } from './errors.js';
import { assertMetadataPathBoundary } from './fs-guards.js';
import { readVersionHead } from './head.js';
import { assertIndexTreeReachable } from './index-integrity.js';
import { hashVersionObject } from './object-format.js';
import { versionRepositoryPath } from './repository-paths.js';
import type { TreeObject } from './types.js';

export type VersionIndex = {
  schemaVersion: '1.0';
  baseCommit: string | null;
  tree: string;
};

export type ReadVersionIndexResult = VersionIndex & {
  revision: string;
  virtual: boolean;
};

const emptyTree: TreeObject = { formatVersion: '1.0', entries: [] };
export const EMPTY_TREE_HASH = hashVersionObject('tree', emptyTree);

function indexPath(rootDir: string, projectName: string): string {
  return path.join(versionRepositoryPath(rootDir, projectName), 'index.json');
}

function lockPath(rootDir: string, projectName: string): string {
  return path.join(
    versionRepositoryPath(rootDir, projectName),
    'locks',
    'index.lock',
  );
}

export function computeIndexRevision(index: VersionIndex): string {
  return crypto
    .createHash('sha256')
    .update(canonicalizeJsonBytes(index))
    .digest('hex');
}

export function readVersionIndex(options: {
  rootDir: string;
  projectName: string;
}): ReadVersionIndexResult {
  const repo = versionRepositoryPath(options.rootDir, options.projectName);
  if (!fs.existsSync(path.join(repo, 'format.json'))) {
    throw createVersionControlError(
      'SPEC_VERSION_NOT_INITIALIZED',
      '版管理リポジトリが初期化されていません。',
    );
  }
  const target = indexPath(options.rootDir, options.projectName);
  if (!fs.existsSync(target)) {
    const head = readVersionHead(options);
    const index: VersionIndex = {
      schemaVersion: '1.0',
      baseCommit: head.commit,
      tree: head.tree ?? EMPTY_TREE_HASH,
    };
    return {
      ...index,
      revision: computeIndexRevision(index),
      virtual: true,
    };
  }

  assertMetadataPathBoundary(target, 'index.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_INDEX_CORRUPT',
      'index.json が不正です。',
    );
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_INDEX_CORRUPT',
      'index.json が不正です。',
    );
  }
  const index = parsed as VersionIndex;
  if (
    index.schemaVersion !== '1.0' ||
    (index.baseCommit !== null &&
      (typeof index.baseCommit !== 'string' ||
        !/^[a-f0-9]{64}$/.test(index.baseCommit))) ||
    typeof index.tree !== 'string' ||
    !/^[a-f0-9]{64}$/.test(index.tree)
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_INDEX_CORRUPT',
      'index.json が不正です。',
    );
  }
  assertIndexTreeReachable({
    rootDir: options.rootDir,
    projectName: options.projectName,
    treeHash: index.tree,
  });

  return {
    schemaVersion: '1.0',
    baseCommit: index.baseCommit,
    tree: index.tree,
    revision: computeIndexRevision({
      schemaVersion: '1.0',
      baseCommit: index.baseCommit,
      tree: index.tree,
    }),
    virtual: false,
  };
}

function acquireIndexLock(rootDir: string, projectName: string): string {
  const repo = versionRepositoryPath(rootDir, projectName);
  const locks = path.join(repo, 'locks');
  fs.mkdirSync(locks, { recursive: true });
  assertMetadataPathBoundary(locks, 'locks');
  const lock = lockPath(rootDir, projectName);
  try {
    fs.writeFileSync(
      lock,
      `${JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
      })}\n`,
      { flag: 'wx' },
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EEXIST') {
      throw createVersionControlError(
        'SPEC_VERSION_INDEX_IN_PROGRESS',
        'index は他の処理中です。',
      );
    }
    throw createVersionControlError(
      'SPEC_VERSION_INDEX_WRITE_FAILED',
      'index lock を取得できませんでした。',
    );
  }
  return lock;
}

function releaseIndexLock(lock: string): void {
  try {
    fs.unlinkSync(lock);
  } catch {
    // cleanup 失敗は握りつぶす（次操作で IN_PROGRESS）
  }
}

/**
 * index mutation 全体を exclusive lock で囲む。
 * stale lock の自動削除は行わない（PID 判定で他 process の lock を消さない）。
 */
export function withIndexLock<T>(
  options: { rootDir: string; projectName: string },
  fn: () => T,
): T {
  const lock = acquireIndexLock(options.rootDir, options.projectName);
  try {
    return fn();
  } finally {
    releaseIndexLock(lock);
  }
}

/**
 * index.json を durable に置換する。
 * TEMP へ全書き込み → file fsync → rename。失敗時は既存 index を維持。
 */
export function writeVersionIndex(options: {
  rootDir: string;
  projectName: string;
  index: VersionIndex;
  /** withIndexLock 内から呼ぶ場合 true */
  alreadyLocked?: boolean;
}): ReadVersionIndexResult {
  const run = (): ReadVersionIndexResult => {
    const target = indexPath(options.rootDir, options.projectName);
    assertMetadataPathBoundary(target, 'index.json');
    const bytes = canonicalizeJsonBytes(options.index);
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    const temp = path.join(
      dir,
      `.index.json.${process.pid}.${Date.now()}.tmp`,
    );
    let fd: number | null = null;
    try {
      fd = fs.openSync(temp, 'wx');
      fs.writeSync(fd, bytes, 0, bytes.byteLength, 0);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      try {
        fs.renameSync(temp, target);
      } catch {
        try {
          fs.unlinkSync(temp);
        } catch {
          // ignore
        }
        throw createVersionControlError(
          'SPEC_VERSION_INDEX_RENAME_FAILED',
          'index を置換できませんでした。',
        );
      }
    } catch (error) {
      if (fd != null) {
        try {
          fs.closeSync(fd);
        } catch {
          // ignore
        }
      }
      try {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
      } catch {
        // ignore
      }
      if (
        error instanceof Error &&
        'code' in error &&
        String((error as { code: string }).code).startsWith('SPEC_VERSION_')
      ) {
        throw error;
      }
      throw createVersionControlError(
        'SPEC_VERSION_INDEX_WRITE_FAILED',
        'index を書き込めませんでした。',
      );
    }

    return {
      ...options.index,
      revision: computeIndexRevision(options.index),
      virtual: false,
    };
  };

  if (options.alreadyLocked) {
    return run();
  }
  return withIndexLock(options, run);
}

/**
 * index.json を削除して virtual index 状態へ戻す。
 * journal.oldIndex.exists === false の recovery 用。
 */
export function removeVersionIndex(options: {
  rootDir: string;
  projectName: string;
  alreadyLocked?: boolean;
}): void {
  const run = (): void => {
    const target = indexPath(options.rootDir, options.projectName);
    if (!fs.existsSync(target)) return;
    assertMetadataPathBoundary(target, 'index.json');
    try {
      fs.unlinkSync(target);
    } catch {
      throw createVersionControlError(
        'SPEC_VERSION_INDEX_WRITE_FAILED',
        'index を削除できませんでした。',
      );
    }
  };
  if (options.alreadyLocked) {
    run();
    return;
  }
  withIndexLock(options, run);
}
