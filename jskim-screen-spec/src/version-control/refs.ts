import fs from 'node:fs';
import path from 'node:path';
import { WINDOWS_RESERVED_NAMES } from '../util/screen-id.js';
import { createDurableFileAtomic } from './durable-create.js';
import { createVersionControlError } from './errors.js';
import { assertMetadataPathBoundary } from './fs-guards.js';
import { readVersionObject } from './object-store.js';
import { assertValidObjectHash, versionRepositoryPath } from './repository-paths.js';

export type VersionRefKind = 'heads' | 'tags';

type RefOptions = {
  rootDir: string;
  projectName: string;
  kind: VersionRefKind;
  name: string;
};

function refRoot(repo: string, kind: VersionRefKind): string {
  return path.join(repo, 'refs', kind);
}

function isSafeSegment(segment: string): boolean {
  if (
    segment.length === 0 ||
    segment.length > 255 ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('\0') ||
    segment.includes('\\') ||
    segment.includes(':') ||
    segment.endsWith('.') ||
    segment.endsWith(' ') ||
    segment.normalize('NFC') !== segment
  ) {
    return false;
  }
  const base = segment.split('.')[0]?.toLowerCase() ?? '';
  return !WINDOWS_RESERVED_NAMES.has(base);
}

function foldName(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

/** refs/heads または refs/tags 配下の相対 ref 名を検証する。 */
export function validateRefName(kind: VersionRefKind, name: string): string {
  if (
    (kind !== 'heads' && kind !== 'tags') ||
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > 512 ||
    name.includes('\0') ||
    name.includes('\\') ||
    name.includes('//') ||
    name.startsWith('/') ||
    name.endsWith('/')
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_REF_INVALID',
      'ref 名が不正です。',
    );
  }
  const segments = name.split('/');
  if (segments.some((segment) => !isSafeSegment(segment))) {
    throw createVersionControlError(
      'SPEC_VERSION_REF_INVALID',
      'ref 名が不正です。',
    );
  }
  return name;
}

function assertInitialized(options: RefOptions): string {
  const repo = versionRepositoryPath(options.rootDir, options.projectName);
  const format = path.join(repo, 'format.json');
  if (!fs.existsSync(format)) {
    throw createVersionControlError(
      'SPEC_VERSION_NOT_INITIALIZED',
      '版管理リポジトリが初期化されていません。',
    );
  }
  assertMetadataPathBoundary(format, 'format.json');
  return repo;
}

function refPath(repo: string, kind: VersionRefKind, name: string): string {
  validateRefName(kind, name);
  const root = path.resolve(refRoot(repo, kind));
  const target = path.resolve(root, ...name.split('/'));
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw createVersionControlError(
      'SPEC_VERSION_REF_INVALID',
      'ref path が不正です。',
    );
  }
  return target;
}

function assertNoSiblingCollision(
  repo: string,
  kind: VersionRefKind,
  name: string,
): void {
  const root = refRoot(repo, kind);
  fs.mkdirSync(root, { recursive: true });
  assertMetadataPathBoundary(root, `refs/${kind}`);
  let current = root;
  for (const segment of name.split('/')) {
    assertMetadataPathBoundary(current, 'ref directory');
    let entries: string[];
    try {
      entries = fs.readdirSync(current);
    } catch {
      throw createVersionControlError(
        'SPEC_VERSION_REF_CORRUPT',
        'ref directory を読み取れませんでした。',
      );
    }
    const collision = entries.find(
      (entry) => foldName(entry) === foldName(segment) && entry !== segment,
    );
    if (collision !== undefined) {
      throw createVersionControlError(
        'SPEC_VERSION_REF_INVALID',
        'ref 名が既存 sibling と case-fold または NFC で衝突します。',
      );
    }
    current = path.join(current, segment);
  }
}

function readRefFile(target: string): string {
  assertMetadataPathBoundary(target, 'ref');
  let value: string;
  try {
    value = fs.readFileSync(target, 'utf8').trim();
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_REF_CORRUPT',
      'ref を読み取れませんでした。',
    );
  }
  try {
    assertValidObjectHash(value);
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_REF_CORRUPT',
      'ref の hash が不正です。',
    );
  }
  return value;
}

function replaceRefDurably(target: string, hash: string): void {
  const dir = path.dirname(target);
  const temp = path.join(
    dir,
    `.${path.basename(target)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  let fd: number | null = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    assertMetadataPathBoundary(dir, 'ref directory');
    assertMetadataPathBoundary(target, 'ref');
    fd = fs.openSync(temp, 'wx');
    const content = Buffer.from(`${hash}\n`, 'utf8');
    fs.writeSync(fd, content, 0, content.byteLength, 0);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temp, target);
  } catch {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        // cleanup 失敗は主エラーを上書きしない
      }
    }
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // cleanup 失敗は主エラーを上書きしない
    }
    throw createVersionControlError(
      'SPEC_VERSION_REF_CONFLICT',
      'ref を安全に更新できませんでした。',
    );
  }
  try {
    const dirFd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // directory fsync はプラットフォーム差があるため best-effort
  }
}

/** ref の hash を読む。ref が無い場合は REF_NOT_FOUND。 */
export function readVersionRef(options: RefOptions): string {
  const repo = assertInitialized(options);
  const name = validateRefName(options.kind, options.name);
  assertNoSiblingCollision(repo, options.kind, name);
  const target = refPath(repo, options.kind, name);
  if (!fs.existsSync(target)) {
    throw createVersionControlError(
      'SPEC_VERSION_REF_NOT_FOUND',
      'ref が見つかりません。',
    );
  }
  return readRefFile(target);
}

/** expectedOldHash と一致するときだけ ref を更新する。null は create-if-absent。 */
export function compareAndSwapVersionRef(
  options: RefOptions & { expectedOldHash: string | null; newHash: string },
): void {
  const repo = assertInitialized(options);
  const name = validateRefName(options.kind, options.name);
  assertNoSiblingCollision(repo, options.kind, name);
  try {
    assertValidObjectHash(options.newHash);
    if (options.expectedOldHash !== null) {
      assertValidObjectHash(options.expectedOldHash);
    }
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_REF_INVALID',
      'ref の hash が不正です。',
    );
  }
  readVersionObject({
    rootDir: options.rootDir,
    projectName: options.projectName,
    hash: options.newHash,
    expectedType: options.kind === 'heads' ? 'commit' : 'tag',
  });

  const target = refPath(repo, options.kind, name);
  const exists = fs.existsSync(target);
  if (options.expectedOldHash === null) {
    if (exists) {
      throw createVersionControlError(
        'SPEC_VERSION_REF_CONFLICT',
        'ref はすでに存在します。',
      );
    }
    assertMetadataPathBoundary(path.dirname(target), 'ref directory');
    assertMetadataPathBoundary(target, 'ref');
    try {
      const created = createDurableFileAtomic(target, `${options.newHash}\n`);
      if (created.status === 'created') return;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        String((error as { code: string }).code).startsWith('SPEC_VERSION_')
      ) {
        throw error;
      }
      throw createVersionControlError(
        'SPEC_VERSION_REF_CONFLICT',
        'ref を安全に作成できませんでした。',
      );
    }
    throw createVersionControlError(
      'SPEC_VERSION_REF_CONFLICT',
      'ref はすでに存在します。',
    );
  } else {
    if (!exists || readRefFile(target) !== options.expectedOldHash) {
      throw createVersionControlError(
        'SPEC_VERSION_REF_CONFLICT',
        'ref が期待した値と一致しません。',
      );
    }
  }
  replaceRefDurably(target, options.newHash);
}

function listFromDirectory(
  kind: VersionRefKind,
  directory: string,
  prefix: string,
  names: string[],
): void {
  assertMetadataPathBoundary(directory, 'ref directory');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_REF_CORRUPT',
      'ref directory を読み取れませんでした。',
    );
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const folded = foldName(entry.name);
    if (seen.has(folded)) {
      throw createVersionControlError(
        'SPEC_VERSION_REF_CORRUPT',
        'ref 名が sibling と衝突しています。',
      );
    }
    seen.add(folded);
    const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      listFromDirectory(kind, path.join(directory, entry.name), name, names);
    } else if (entry.isFile()) {
      try {
        validateRefName(kind, name);
      } catch {
        throw createVersionControlError(
          'SPEC_VERSION_REF_CORRUPT',
          'ref 名が不正です。',
        );
      }
      readRefFile(path.join(directory, entry.name));
      names.push(name);
    } else {
      throw createVersionControlError(
        'SPEC_VERSION_REF_CORRUPT',
        'ref に通常ファイル以外は許可されていません。',
      );
    }
  }
}

/** 指定 kind の ref 名を POSIX 相対 path で返す。 */
export function listRefNames(
  options: Omit<RefOptions, 'name'>,
): string[] {
  const repo = assertInitialized({ ...options, name: 'main' });
  const root = refRoot(repo, options.kind);
  fs.mkdirSync(root, { recursive: true });
  const names: string[] = [];
  listFromDirectory(options.kind, root, '', names);
  return names.sort();
}

/** ref ファイルを削除する（branch delete 用。object は消さない）。 */
export function deleteVersionRef(options: RefOptions): void {
  const repo = assertInitialized(options);
  const name = validateRefName(options.kind, options.name);
  const target = refPath(repo, options.kind, name);
  if (!fs.existsSync(target)) {
    throw createVersionControlError(
      'SPEC_VERSION_REF_NOT_FOUND',
      'ref が見つかりません。',
    );
  }
  assertMetadataPathBoundary(target, 'ref');
  try {
    fs.unlinkSync(target);
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_REF_CORRUPT',
      'ref を削除できませんでした。',
    );
  }
}
