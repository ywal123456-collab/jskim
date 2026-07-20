import fs from 'node:fs';
import path from 'node:path';
import { createFileAtomic, writeFileAtomic } from '../util/write-file-atomic.js';
import {
  DEFAULT_BRANCH,
  HASH_ALGORITHM,
  HEAD_MAIN_REF,
  REPOSITORY_FORMAT_VERSION,
} from './constants.js';
import { createVersionControlError } from './errors.js';
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

function readExistingFormat(formatPath: string): RepositoryFormatDocument {
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

function assertHeadUnbornMain(headFile: string): void {
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
  if (normalized !== HEAD_MAIN_REF) {
    // existing repo may already have advanced HEAD in later phases;
    // for 7E-1 idempotent init we only accept unborn main OR reject overwrite.
    // If HEAD points elsewhere, treat as existing valid repo only when format ok —
    // but do not rewrite. Accept any `ref: refs/heads/...` or 64-hex for existing.
    const okSymbolic = /^ref: refs\/heads\/[A-Za-z0-9._/-]+$/.test(normalized);
    const okDetached = /^[a-f0-9]{64}$/.test(normalized);
    if (!okSymbolic && !okDetached) {
      throw createVersionControlError(
        'SPEC_VERSION_REPOSITORY_CORRUPT',
        'HEAD の形式が不正です。',
      );
    }
  }
}

/**
 * 版管理リポジトリ metadata のみを初期化する。
 * 自動 stage / initial commit / features.json 生成は行わない。
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
    if (err instanceof Error && 'code' in err && (err as { code: string }).code.startsWith('SPEC_')) {
      throw err;
    }
  }

  if (fs.existsSync(formatPath)) {
    readExistingFormat(formatPath);
    if (!fs.existsSync(headFile)) {
      throw createVersionControlError(
        'SPEC_VERSION_REPOSITORY_CORRUPT',
        'HEAD がありません。',
      );
    }
    assertHeadUnbornMain(headFile);
    return {
      status: 'existing',
      repositoryRelativePath: relativePath,
      headRef: `refs/heads/${DEFAULT_BRANCH}`,
    };
  }

  // 新規作成
  try {
    fs.mkdirSync(path.join(repo, 'objects'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'refs', 'heads'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'refs', 'tags'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'locks'), { recursive: true });
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
    const formatResult = createFileAtomic(formatPath, formatBody);
    if (formatResult.status === 'exists') {
      // 競合: 他 process が先に作った
      readExistingFormat(formatPath);
      if (fs.existsSync(headFile)) {
        assertHeadUnbornMain(headFile);
      }
      return {
        status: 'existing',
        repositoryRelativePath: relativePath,
        headRef: `refs/heads/${DEFAULT_BRANCH}`,
      };
    }

    if (!fs.existsSync(headFile)) {
      const headResult = createFileAtomic(headFile, headBody);
      if (headResult.status === 'exists') {
        assertHeadUnbornMain(headFile);
      }
    } else {
      assertHeadUnbornMain(headFile);
    }
  } catch (err) {
    if (err instanceof Error && 'code' in err) {
      const code = (err as { code: string }).code;
      if (code.startsWith('SPEC_VERSION_')) {
        throw err;
      }
    }
    // 部分作成の掃除はしない（不完全 repo は corrupt として次回検出）
    throw createVersionControlError(
      'SPEC_VERSION_INIT_FAILED',
      '版管理リポジトリの初期化に失敗しました。',
    );
  }

  // format だけ先に存在し HEAD が無い場合の修復は writeFileAtomic で HEAD 作成済み想定
  if (!fs.existsSync(headFile)) {
    try {
      writeFileAtomic(headFile, headBody);
    } catch {
      throw createVersionControlError(
        'SPEC_VERSION_INIT_FAILED',
        'HEAD の作成に失敗しました。',
      );
    }
  }

  return {
    status: 'created',
    repositoryRelativePath: relativePath,
    headRef: `refs/heads/${DEFAULT_BRANCH}`,
  };
}
