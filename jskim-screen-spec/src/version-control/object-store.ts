import fs from 'node:fs';
import path from 'node:path';
import { createFileAtomic } from '../util/write-file-atomic.js';
import {
  MAX_VERSION_OBJECT_BYTES,
  type VersionObjectType,
} from './constants.js';
import { createVersionControlError } from './errors.js';
import {
  decodeVersionObjectBytes,
  encodeVersionObject,
  hashVersionObject,
} from './object-format.js';
import {
  objectAbsolutePath,
  versionRepositoryPath,
} from './repository-paths.js';
import type {
  ReadVersionObjectOptions,
  ReadVersionObjectResult,
  WriteVersionObjectOptions,
  WriteVersionObjectResult,
} from './types.js';

export { hashVersionObject };

function ensureRepositoryInitialized(
  rootDir: string,
  projectName: string,
): string {
  const repo = versionRepositoryPath(rootDir, projectName);
  const formatPath = path.join(repo, 'format.json');
  if (!fs.existsSync(formatPath)) {
    throw createVersionControlError(
      'SPEC_VERSION_REPOSITORY_CORRUPT',
      '版管理リポジトリが初期化されていません。',
    );
  }
  return repo;
}

/**
 * content-addressed object を書く。同一 hash が既にあれば integrity 確認後 unchanged。
 */
export function writeVersionObject(
  options: WriteVersionObjectOptions,
): WriteVersionObjectResult {
  const maxBytes = options.maxBytes ?? MAX_VERSION_OBJECT_BYTES;
  const repo = ensureRepositoryInitialized(
    options.rootDir,
    options.projectName,
  );
  const encoded = encodeVersionObject(
    options.type,
    options.payload,
    maxBytes,
  );
  const target = objectAbsolutePath(repo, encoded.hash);

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_WRITE_FAILED',
      'オブジェクト用ディレクトリを作成できませんでした。',
    );
  }

  try {
    const created = createFileAtomic(target, encoded.encoded);
    if (created.status === 'created') {
      return {
        status: 'created',
        hash: encoded.hash,
        type: encoded.type,
      };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'CREATE_FILE_ATOMIC_UNSUPPORTED') {
      throw createVersionControlError(
        'SPEC_VERSION_OBJECT_WRITE_FAILED',
        'オブジェクトを安全に書き込めませんでした。',
      );
    }
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_WRITE_FAILED',
      'オブジェクトの書き込みに失敗しました。',
    );
  }

  // exists: integrity 確認
  let existing: Buffer;
  try {
    existing = fs.readFileSync(target);
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_CORRUPT',
      '既存オブジェクトを読み取れませんでした。',
    );
  }
  try {
    decodeVersionObjectBytes(existing, encoded.hash, maxBytes);
  } catch (err) {
    if (err instanceof Error && 'code' in err) {
      throw err;
    }
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_CORRUPT',
      '既存オブジェクトが破損しています。',
    );
  }
  return {
    status: 'unchanged',
    hash: encoded.hash,
    type: encoded.type,
  };
}

export function hasVersionObject(options: {
  rootDir: string;
  projectName: string;
  hash: string;
}): boolean {
  const repo = ensureRepositoryInitialized(
    options.rootDir,
    options.projectName,
  );
  const target = objectAbsolutePath(repo, options.hash);
  return fs.existsSync(target);
}

export function readVersionObject(
  options: ReadVersionObjectOptions,
): ReadVersionObjectResult {
  const maxBytes = options.maxBytes ?? MAX_VERSION_OBJECT_BYTES;
  const repo = ensureRepositoryInitialized(
    options.rootDir,
    options.projectName,
  );
  const target = objectAbsolutePath(repo, options.hash);
  if (!fs.existsSync(target)) {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_NOT_FOUND',
      'オブジェクトが見つかりません。',
    );
  }

  let encoded: Buffer;
  try {
    encoded = fs.readFileSync(target);
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_CORRUPT',
      'オブジェクトを読み取れませんでした。',
    );
  }

  const decoded = decodeVersionObjectBytes(encoded, options.hash, maxBytes);
  if (options.expectedType && decoded.type !== options.expectedType) {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_TYPE_MISMATCH',
      'オブジェクト type が一致しません。',
    );
  }
  return {
    hash: decoded.hash,
    type: decoded.type,
    payload: decoded.payload,
  };
}

export function readTypedVersionObject(
  options: ReadVersionObjectOptions & { expectedType: VersionObjectType },
): ReadVersionObjectResult {
  return readVersionObject(options);
}
