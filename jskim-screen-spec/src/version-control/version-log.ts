import { createVersionControlError } from './errors.js';
import { readVersionObject } from './object-store.js';
import { resolveVersionRevision } from './revision-resolver.js';
import type { CommitObject, VersionPerson } from './types.js';
import { assertCommitObject } from './validate-object.js';

export type VersionCommitSummary = {
  hash: string;
  shortHash: string;
  tree: string;
  parents: string[];
  author: VersionPerson;
  committer: VersionPerson;
  committedAt: string;
  message: string;
};

export type GetVersionLogOptions = {
  rootDir: string;
  projectName: string;
  /** 省略時は HEAD */
  start?: string;
  limit?: number;
  /** 直前ページ最後の commit hash。次ページはこの直後から。 */
  cursor?: string;
};

export type GetVersionLogResult = {
  commits: VersionCommitSummary[];
  nextCursor: string | null;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function loadCommit(
  options: { rootDir: string; projectName: string },
  hash: string,
): CommitObject {
  const object = readVersionObject({
    ...options,
    hash,
    expectedType: 'commit',
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(object.payload.toString('utf8'));
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_CORRUPT',
      'commit オブジェクトが不正です。',
    );
  }
  return assertCommitObject(parsed);
}

function toSummary(hash: string, commit: CommitObject): VersionCommitSummary {
  return {
    hash,
    shortHash: hash.slice(0, 12),
    tree: commit.tree,
    parents: [...commit.parents],
    author: commit.author,
    committer: commit.committer,
    committedAt: commit.committedAt,
    message: commit.message,
  };
}

/** 単一 commit の詳細を返す。 */
export function getVersionCommit(options: {
  rootDir: string;
  projectName: string;
  revision: string;
}): VersionCommitSummary {
  const resolved = resolveVersionRevision(options);
  const commit = loadCommit(options, resolved.commitHash);
  return toSummary(resolved.commitHash, commit);
}

/**
 * start から parent 配列順の決定的 graph walk。
 * 訪問済みは再出力しない。timestamp ソートは行わない。
 */
export function getVersionLog(
  options: GetVersionLogOptions,
): GetVersionLogResult {
  const limit = options.limit ?? DEFAULT_LIMIT;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIMIT
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      'log の limit が不正です。',
    );
  }

  const start = resolveVersionRevision({
    rootDir: options.rootDir,
    projectName: options.projectName,
    revision: options.start ?? 'HEAD',
  });

  const visited = new Set<string>();
  const queue: string[] = [start.commitHash];
  const ordered: string[] = [];

  while (queue.length > 0) {
    const hash = queue.shift();
    if (!hash || visited.has(hash)) continue;
    visited.add(hash);
    ordered.push(hash);
    const commit = loadCommit(options, hash);
    for (const parent of commit.parents) {
      if (visited.has(parent)) continue;
      // cycle: parent が後で再び現れる場合は visited で抑止。
      // 自己参照はここで検出。
      if (parent === hash) {
        throw createVersionControlError(
          'SPEC_VERSION_REPOSITORY_CORRUPT',
          'commit の parent に循環があります。',
        );
      }
      queue.push(parent);
    }
  }

  let startIndex = 0;
  if (options.cursor !== undefined) {
    const cursorIndex = ordered.indexOf(options.cursor);
    if (cursorIndex < 0) {
      throw createVersionControlError(
        'SPEC_VERSION_REVISION_NOT_FOUND',
        'log cursor が見つかりません。',
      );
    }
    startIndex = cursorIndex + 1;
  }

  const slice = ordered.slice(startIndex, startIndex + limit);
  const commits = slice.map((hash) =>
    toSummary(hash, loadCommit(options, hash)),
  );
  const last = slice[slice.length - 1];
  const nextCursor =
    last && startIndex + slice.length < ordered.length ? last : null;

  return { commits, nextCursor };
}
