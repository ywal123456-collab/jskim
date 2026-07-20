import fs from 'node:fs';
import path from 'node:path';
import { createVersionControlError } from './errors.js';

/**
 * Node が symbolic link と識別する path を拒否する。
 * Windows junction / reparse point は Node が symlink として報告する場合に拒否する。
 * Node が通常 directory/file と報告する reparse point は観測限界として残る。
 */
export function assertNotSymlink(
  targetPath: string,
  label: string,
): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      return;
    }
    throw createVersionControlError(
      'SPEC_VERSION_SYMLINK_NOT_ALLOWED',
      `${label} を検査できませんでした。`,
    );
  }
  if (st.isSymbolicLink()) {
    throw createVersionControlError(
      'SPEC_VERSION_SYMLINK_NOT_ALLOWED',
      `${label} にシンボリックリンクは許可されていません。`,
    );
  }
}

/**
 * 既存 path が通常ファイルであることを要求する（symlink 拒否）。
 */
export function assertRegularFileNotSymlink(
  targetPath: string,
  label: string,
): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      throw createVersionControlError(
        'SPEC_VERSION_OBJECT_NOT_FOUND',
        `${label} が見つかりません。`,
      );
    }
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_CORRUPT',
      `${label} を検査できませんでした。`,
    );
  }
  if (st.isSymbolicLink()) {
    throw createVersionControlError(
      'SPEC_VERSION_SYMLINK_NOT_ALLOWED',
      `${label} にシンボリックリンクは許可されていません。`,
    );
  }
  if (!st.isFile()) {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_CORRUPT',
      `${label} が通常ファイルではありません。`,
    );
  }
}

/**
 * object 書き込み前に objects / fan-out 境界を検査する。
 */
export function assertObjectWriteBoundary(
  repositoryPath: string,
  objectAbsPath: string,
): void {
  const objectsDir = path.join(repositoryPath, 'objects');
  assertNotSymlink(objectsDir, 'objects');
  const fanout = path.dirname(objectAbsPath);
  assertNotSymlink(fanout, 'objects fan-out');
  assertNotSymlink(objectAbsPath, 'object file');
}

/**
 * object 読み取り前に最終ファイルが symlink でないことを検査する。
 */
export function assertObjectReadBoundary(objectAbsPath: string): void {
  assertRegularFileNotSymlink(objectAbsPath, 'object file');
}

export function assertMetadataPathBoundary(
  targetPath: string,
  label: string,
): void {
  assertNotSymlink(targetPath, label);
}
