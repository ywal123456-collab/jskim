import fs from 'node:fs';
import path from 'node:path';
import { createDurableFileAtomic } from './durable-create.js';
import {
  DEFAULT_BRANCH,
  HASH_ALGORITHM,
  HEAD_MAIN_REF,
  REPOSITORY_FORMAT_VERSION,
} from './constants.js';
import { createVersionControlError } from './errors.js';
import {
  assertMetadataPathBoundary,
  assertNotSymlink,
} from './fs-guards.js';
import {
  formatJsonPath,
  headPath,
  versionRepositoryPath,
  versionRepositoryRelativePath,
} from './repository-paths.js';
import type {
  InitVersionRepositoryOptions,
  InitVersionRepositoryResult,
  RepositoryFormatDocument,
} from './types.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function ensureRequiredDirs(repo: string): void {
  fs.mkdirSync(path.join(repo, 'objects'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'refs', 'heads'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'refs', 'tags'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'locks'), { recursive: true });
}

function readExistingFormat(formatPath: string): RepositoryFormatDocument {
  assertMetadataPathBoundary(formatPath, 'format.json');
  let text: string;
  try {
    text = fs.readFileSync(formatPath, 'utf8');
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_REPOSITORY_CORRUPT',
      'format.json を読み取れませんでした。',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_REPOSITORY_CORRUPT',
      'format.json が不正な JSON です。',
    );
  }
  if (!isPlainObject(parsed)) {
    throw createVersionControlError(
      'SPEC_VERSION_REPOSITORY_CORRUPT',
      'format.json が不正です。',
    );
  }
  if (parsed.repositoryFormatVersion !== REPOSITORY_FORMAT_VERSION) {
    throw createVersionControlError(
      'SPEC_VERSION_UNSUPPORTED_FORMAT',
      '未対応の repositoryFormatVersion です。',
    );
  }
  if (parsed.hashAlgorithm !== HASH_ALGORITHM) {
    throw createVersionControlError(
      'SPEC_VERSION_UNSUPPORTED_FORMAT',
      '未対応の hashAlgorithm です。',
    );
  }
  return {
    repositoryFormatVersion: '1.0',
    hashAlgorithm: 'sha256',
  };
}

function assertHeadReadable(headFile: string): void {
  assertMetadataPathBoundary(headFile, 'HEAD');
  let text: string;
  try {
    text = fs.readFileSync(headFile, 'utf8');
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_REPOSITORY_CORRUPT',
      'HEAD を読み取れませんでした。',
    );
  }
  const normalized = text.replace(/\r\n/g, '\n').trimEnd();
  if (normalized === HEAD_MAIN_REF) {
    return;
  }
  const okSymbolic = /^ref: refs\/heads\/[A-Za-z0-9._/-]+$/.test(normalized);
  const okDetached = /^[a-f0-9]{64}$/.test(normalized);
  if (!okSymbolic && !okDetached) {
    throw createVersionControlError(
      'SPEC_VERSION_REPOSITORY_CORRUPT',
      'HEAD の形式が不正です。',
    );
  }
}

function hasUnexpectedContent(repo: string): boolean {
  const objects = path.join(repo, 'objects');
  if (fs.existsSync(objects)) {
    try {
      const fanouts = fs.readdirSync(objects);
      for (const f of fanouts) {
        const abs = path.join(objects, f);
        const st = fs.lstatSync(abs);
        if (st.isSymbolicLink()) return true;
        if (st.isDirectory()) {
          const files = fs.readdirSync(abs);
          if (files.length > 0) return true;
        } else if (st.isFile()) {
          return true;
        }
      }
    } catch {
      return true;
    }
  }
  const heads = path.join(repo, 'refs', 'heads');
  if (fs.existsSync(heads)) {
    try {
      if (fs.readdirSync(heads).length > 0) return true;
    } catch {
      return true;
    }
  }
  const tags = path.join(repo, 'refs', 'tags');
  if (fs.existsSync(tags)) {
    try {
      if (fs.readdirSync(tags).length > 0) return true;
    } catch {
      return true;
    }
  }
  const indexFile = path.join(repo, 'index.json');
  if (fs.existsSync(indexFile)) return true;
  return false;
}

function writeFormatIfAbsent(formatPath: string, body: string): void {
  const result = createDurableFileAtomic(formatPath, body);
  if (result.status === 'exists') {
    readExistingFormat(formatPath);
  }
}

function writeHeadIfAbsent(headFile: string, body: string): void {
  const result = createDurableFileAtomic(headFile, body);
  if (result.status === 'exists') {
    assertHeadReadable(headFile);
  }
}

/**
 * 版管理リポジトリ metadata のみを初期化する。
 * 空の部分初期化（directory のみ / format のみ / HEAD のみ / 欠落 dir）は
 * 安全な範囲で idempotent に補完する。
 * 破損 format/HEAD・予期しない object/ref・symlink は自動修復しない。
 */
export function initVersionRepository(
  options: InitVersionRepositoryOptions,
): InitVersionRepositoryResult {
  const repo = versionRepositoryPath(options.rootDir, options.projectName);
  const relativePath = versionRepositoryRelativePath(options.projectName);
  const formatPath = formatJsonPath(repo);
  const headFile = headPath(repo);

  try {
    const st = fs.existsSync(repo) ? fs.lstatSync(repo) : null;
    if (st && st.isFile()) {
      throw createVersionControlError(
        'SPEC_VERSION_INIT_FAILED',
        '版管理リポジトリ path がファイルです。',
      );
    }
    if (st && st.isSymbolicLink()) {
      throw createVersionControlError(
        'SPEC_VERSION_INIT_FAILED',
        '版管理リポジトリ path がシンボリックリンクです。',
      );
    }
  } catch (err) {
    if (
      err instanceof Error &&
      'code' in err &&
      String((err as { code: string }).code).startsWith('SPEC_')
    ) {
      throw err;
    }
  }

  const formatExists = fs.existsSync(formatPath);
  const headExists = fs.existsSync(headFile);

  if (formatExists && headExists) {
    readExistingFormat(formatPath);
    assertHeadReadable(headFile);
    try {
      ensureRequiredDirs(repo);
    } catch {
      throw createVersionControlError(
        'SPEC_VERSION_INIT_FAILED',
        '版管理リポジトリのディレクトリを作成できませんでした。',
      );
    }
    assertNotSymlink(path.join(repo, 'objects'), 'objects');
    assertNotSymlink(path.join(repo, 'locks'), 'locks');
    return {
      status: 'existing',
      repositoryRelativePath: relativePath,
      headRef: `refs/heads/${DEFAULT_BRANCH}`,
    };
  }

  // 片方だけ / どちらも無い場合
  if (formatExists && !headExists) {
    readExistingFormat(formatPath);
    if (hasUnexpectedContent(repo)) {
      throw createVersionControlError(
        'SPEC_VERSION_REPOSITORY_CORRUPT',
        'format.json のみ存在し、予期しない内容があるため自動修復できません。',
      );
    }
    try {
      ensureRequiredDirs(repo);
      writeHeadIfAbsent(headFile, `${HEAD_MAIN_REF}\n`);
    } catch (err) {
      if (
        err instanceof Error &&
        'code' in err &&
        String((err as { code: string }).code).startsWith('SPEC_')
      ) {
        throw err;
      }
      throw createVersionControlError(
        'SPEC_VERSION_INIT_FAILED',
        'HEAD の補完に失敗しました。',
      );
    }
    return {
      status: 'created',
      repositoryRelativePath: relativePath,
      headRef: `refs/heads/${DEFAULT_BRANCH}`,
    };
  }

  if (!formatExists && headExists) {
    assertHeadReadable(headFile);
    const normalized = fs
      .readFileSync(headFile, 'utf8')
      .replace(/\r\n/g, '\n')
      .trimEnd();
    if (normalized !== HEAD_MAIN_REF || hasUnexpectedContent(repo)) {
      throw createVersionControlError(
        'SPEC_VERSION_REPOSITORY_CORRUPT',
        'HEAD のみ存在し、自動修復できない状態です。',
      );
    }
    const formatDoc: RepositoryFormatDocument = {
      repositoryFormatVersion: REPOSITORY_FORMAT_VERSION,
      hashAlgorithm: HASH_ALGORITHM,
    };
    const formatBody = `${JSON.stringify(formatDoc, null, 2)}\n`;
    try {
      ensureRequiredDirs(repo);
      writeFormatIfAbsent(formatPath, formatBody);
    } catch (err) {
      if (
        err instanceof Error &&
        'code' in err &&
        String((err as { code: string }).code).startsWith('SPEC_')
      ) {
        throw err;
      }
      throw createVersionControlError(
        'SPEC_VERSION_INIT_FAILED',
        'format.json の補完に失敗しました。',
      );
    }
    return {
      status: 'created',
      repositoryRelativePath: relativePath,
      headRef: `refs/heads/${DEFAULT_BRANCH}`,
    };
  }

  // 完全新規（directory のみ含む）
  if (hasUnexpectedContent(repo)) {
    throw createVersionControlError(
      'SPEC_VERSION_REPOSITORY_CORRUPT',
      '未初期化リポジトリに予期しない内容があります。',
    );
  }

  try {
    ensureRequiredDirs(repo);
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_INIT_FAILED',
      '版管理リポジトリのディレクトリを作成できませんでした。',
    );
  }

  const formatDoc: RepositoryFormatDocument = {
    repositoryFormatVersion: REPOSITORY_FORMAT_VERSION,
    hashAlgorithm: HASH_ALGORITHM,
  };
  const formatBody = `${JSON.stringify(formatDoc, null, 2)}\n`;
  const headBody = `${HEAD_MAIN_REF}\n`;

  try {
    writeFormatIfAbsent(formatPath, formatBody);
    writeHeadIfAbsent(headFile, headBody);
  } catch (err) {
    if (
      err instanceof Error &&
      'code' in err &&
      String((err as { code: string }).code).startsWith('SPEC_')
    ) {
      throw err;
    }
    throw createVersionControlError(
      'SPEC_VERSION_INIT_FAILED',
      '版管理リポジトリの初期化に失敗しました。',
    );
  }

  return {
    status: 'created',
    repositoryRelativePath: relativePath,
    headRef: `refs/heads/${DEFAULT_BRANCH}`,
  };
}
