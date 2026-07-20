import fs from 'node:fs';
import path from 'node:path';
import { createDurableFileAtomic } from './durable-create.js';
import type { DurableCreateFs } from './durable-create.js';
import {
  MAX_VERSION_OBJECT_BYTES,
  type VersionObjectType,
} from './constants.js';
import { createVersionControlError } from './errors.js';
import {
  assertObjectReadBoundary,
  assertObjectWriteBoundary,
  assertMetadataPathBoundary,
} from './fs-guards.js';
import {
  decodeVersionObjectBytes,
  encodeVersionObject,
  hashVersionObject,
} from './object-format.js';
import {
  formatJsonPath,
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

export type WriteVersionObjectInternalOptions = WriteVersionObjectOptions & {
  /** test 用 durable filesystem 注入 */
  durableFs?: DurableCreateFs;
};

function ensureRepositoryInitialized(
  rootDir: string,
  projectName: string,
): string {
  const repo = versionRepositoryPath(rootDir, projectName);
  const formatPath = formatJsonPath(repo);
  if (!fs.existsSync(formatPath)) {
    throw createVersionControlError(
      'SPEC_VERSION_NOT_INITIALIZED',
      '版管理リポジトリが初期化されていません。',
    );
  }
  assertMetadataPathBoundary(formatPath, 'format.json');
  return repo;
}

/**
 * content-addressed object を書く。同一 hash が既にあれば integrity 確認後 unchanged。
 * 破損既存は overwrite / delete せずエラー。
 */
export function writeVersionObject(
  options: WriteVersionObjectInternalOptions,
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
    fs.mkdirSync(path.join(repo, 'objects'), { recursive: true });
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_WRITE_FAILED',
      'オブジェクト用ディレクトリを作成できませんでした。',
    );
  }

  assertObjectWriteBoundary(repo, target);

  try {
    const created = createDurableFileAtomic(target, encoded.encoded, {
      fs: options.durableFs,
    });
    if (created.status === 'created') {
      return {
        status: 'created',
        hash: encoded.hash,
        type: encoded.type,
      };
    }
  } catch (err) {
    if (err instanceof Error && 'code' in err) {
      const code = (err as { code: string }).code;
      if (code.startsWith('SPEC_VERSION_')) {
        throw err;
      }
      if (code === 'CREATE_FILE_ATOMIC_UNSUPPORTED') {
        throw createVersionControlError(
          'SPEC_VERSION_OBJECT_WRITE_FAILED',
          'オブジェクトを安全に書き込めませんでした。',
        );
      }
    }
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_WRITE_FAILED',
      'オブジェクトの書き込みに失敗しました。',
    );
  }

  // exists: integrity 確認（破損時は unchanged 成功にしない・削除しない）
  assertObjectReadBoundary(target);
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
  if (!fs.existsSync(target)) {
    return false;
  }
  try {
    assertObjectReadBoundary(target);
  } catch {
    return false;
  }
  return true;
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

  assertObjectReadBoundary(target);

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
