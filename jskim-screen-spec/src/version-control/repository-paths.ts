import path from 'node:path';
import {
  SHA256_HEX_RE,
  VERSION_DIR_SEGMENTS,
} from './constants.js';
import { createVersionControlError } from './errors.js';

export function versionRepositoryRelativePath(projectName: string): string {
  return `spec/${projectName}/${VERSION_DIR_SEGMENTS.join('/')}`;
}

export function versionRepositoryPath(
  rootDir: string,
  projectName: string,
): string {
  return path.join(
    rootDir,
    'spec',
    projectName,
    ...VERSION_DIR_SEGMENTS,
  );
}

export function assertValidObjectHash(hash: string): void {
  if (typeof hash !== 'string' || !SHA256_HEX_RE.test(hash)) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_HASH',
      'オブジェクト hash が不正です。',
    );
  }
}

export function objectRelativePath(hash: string): string {
  assertValidObjectHash(hash);
  return `objects/${hash.slice(0, 2)}/${hash.slice(2)}`;
}

export function objectAbsolutePath(
  repositoryPath: string,
  hash: string,
): string {
  assertValidObjectHash(hash);
  const resolvedRepo = path.resolve(repositoryPath);
  const abs = path.resolve(
    resolvedRepo,
    'objects',
    hash.slice(0, 2),
    hash.slice(2),
  );
  const rel = path.relative(resolvedRepo, abs);
  if (
    rel.startsWith('..') ||
    path.isAbsolute(rel) ||
    rel.includes('\0')
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_HASH',
      'オブジェクト path が不正です。',
    );
  }
  return abs;
}

export function formatJsonPath(repositoryPath: string): string {
  return path.join(repositoryPath, 'format.json');
}

export function headPath(repositoryPath: string): string {
  return path.join(repositoryPath, 'HEAD');
}
