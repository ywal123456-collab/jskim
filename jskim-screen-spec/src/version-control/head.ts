import fs from 'node:fs';
import path from 'node:path';
import { createVersionControlError } from './errors.js';
import { assertMetadataPathBoundary } from './fs-guards.js';
import { readVersionObject } from './object-store.js';
import {
  assertValidObjectHash,
  headPath,
  versionRepositoryPath,
} from './repository-paths.js';

export type VersionHead = {
  commit: string | null;
  tree: string | null;
  ref: string | null;
  unborn: boolean;
};

function replaceHeadDurably(target: string, content: string): void {
  const dir = path.dirname(target);
  const temp = path.join(
    dir,
    `.HEAD.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  let fd: number | null = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    assertMetadataPathBoundary(dir, 'HEAD directory');
    assertMetadataPathBoundary(target, 'HEAD');
    fd = fs.openSync(temp, 'wx');
    const bytes = Buffer.from(content, 'utf8');
    fs.writeSync(fd, bytes, 0, bytes.byteLength, 0);
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
      'SPEC_VERSION_HEAD_CORRUPT',
      'HEAD を安全に更新できませんでした。',
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

function assertBranchName(name: string): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) ||
    name.includes('..') ||
    name.includes('//') ||
    name.endsWith('/') ||
    name.endsWith('.')
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_REF_INVALID',
      'HEAD の branch 名が不正です。',
    );
  }
}

export function readVersionHead(options: { rootDir: string; projectName: string }): VersionHead {
  const repo = versionRepositoryPath(options.rootDir, options.projectName);
  if (!fs.existsSync(path.join(repo, 'format.json'))) {
    throw createVersionControlError('SPEC_VERSION_NOT_INITIALIZED', '版管理リポジトリが初期化されていません。');
  }
  let value: string;
  try { value = fs.readFileSync(headPath(repo), 'utf8').trim(); } catch {
    throw createVersionControlError('SPEC_VERSION_HEAD_CORRUPT', 'HEAD を読み取れませんでした。');
  }
  let ref: string | null = null;
  let commit = value;
  if (value.startsWith('ref: ')) {
    ref = value.slice(5);
    if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(ref) || ref.includes('..')) {
      throw createVersionControlError('SPEC_VERSION_REF_CORRUPT', 'HEAD の参照先が不正です。');
    }
    const refPath = path.resolve(repo, ref);
    if (!refPath.startsWith(`${path.resolve(repo)}${path.sep}`)) throw createVersionControlError('SPEC_VERSION_REF_CORRUPT', 'HEAD の参照先が不正です。');
    if (!fs.existsSync(refPath)) return { commit: null, tree: null, ref, unborn: true };
    commit = fs.readFileSync(refPath, 'utf8').trim();
  }
  if (!/^[a-f0-9]{64}$/.test(commit)) throw createVersionControlError('SPEC_VERSION_HEAD_CORRUPT', 'HEAD の commit hash が不正です。');
  const object = readVersionObject({ ...options, hash: commit, expectedType: 'commit' });
  let parsed: { tree?: unknown };
  try { parsed = JSON.parse(object.payload.toString('utf8')) as { tree?: unknown }; } catch {
    throw createVersionControlError('SPEC_VERSION_HEAD_CORRUPT', 'HEAD commit が不正です。');
  }
  if (typeof parsed.tree !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.tree)) throw createVersionControlError('SPEC_VERSION_HEAD_CORRUPT', 'HEAD tree が不正です。');
  return { commit, tree: parsed.tree, ref, unborn: false };
}

/** HEAD を指定 branch への symbolic ref として durable に置換する。 */
export function writeVersionHeadSymbolic(options: {
  rootDir: string;
  projectName: string;
  name: string;
}): void {
  assertBranchName(options.name);
  const repo = versionRepositoryPath(options.rootDir, options.projectName);
  replaceHeadDurably(headPath(repo), `ref: refs/heads/${options.name}\n`);
}

/** HEAD を指定 commit hash の detached 状態として durable に置換する。 */
export function writeVersionHeadDetached(options: {
  rootDir: string;
  projectName: string;
  hash: string;
}): void {
  assertValidObjectHash(options.hash);
  const repo = versionRepositoryPath(options.rootDir, options.projectName);
  replaceHeadDurably(headPath(repo), `${options.hash}\n`);
}

/** 楽観的更新用に、読み取った HEAD が期待値から変わっていないことを確認する。 */
export function assertHeadMatchesExpected(
  head: VersionHead,
  expectedHead?: string | null,
): void {
  if (expectedHead === undefined) return;
  if (head.commit !== expectedHead) {
    throw createVersionControlError(
      'SPEC_VERSION_HEAD_CHANGED',
      'HEAD が期待した状態から変更されています。',
    );
  }
}
