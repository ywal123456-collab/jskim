import fs from 'node:fs';
import path from 'node:path';
import { createVersionControlError } from './errors.js';
import { readVersionHead } from './head.js';
import { readVersionObject } from './object-store.js';
import { listRefNames, readVersionRef, validateRefName } from './refs.js';
import { assertValidObjectHash, versionRepositoryPath } from './repository-paths.js';
import { assertCommitObject, assertTagObject } from './validate-object.js';

export const MIN_SHORT_HASH_LENGTH = 7;

export type ResolvedVersionRevision = {
  commitHash: string;
  treeHash: string;
  kind: 'commit' | 'branch' | 'tag' | 'head' | 'hash';
  refName?: string;
};

function peelTagToCommit(
  options: { rootDir: string; projectName: string },
  tagHash: string,
  seen: Set<string>,
): string {
  if (seen.has(tagHash)) {
    throw createVersionControlError(
      'SPEC_VERSION_REPOSITORY_CORRUPT',
      'tag の参照に循環があります。',
    );
  }
  seen.add(tagHash);
  const object = readVersionObject({
    ...options,
    hash: tagHash,
    expectedType: 'tag',
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(object.payload.toString('utf8'));
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_CORRUPT',
      'tag オブジェクトが不正です。',
    );
  }
  const tag = assertTagObject(parsed);
  if (tag.objectType !== 'commit') {
    throw createVersionControlError(
      'SPEC_VERSION_REVISION_TYPE_MISMATCH',
      'tag の対象 type が不正です。',
    );
  }
  return tag.object;
}

function commitTree(
  options: { rootDir: string; projectName: string },
  commitHash: string,
): string {
  const object = readVersionObject({
    ...options,
    hash: commitHash,
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
  const commit = assertCommitObject(parsed);
  return commit.tree;
}

function collectObjectHashes(repo: string): string[] {
  const objects = path.join(repo, 'objects');
  if (!fs.existsSync(objects)) return [];
  const hashes: string[] = [];
  for (const fanout of fs.readdirSync(objects)) {
    if (!/^[a-f0-9]{2}$/.test(fanout)) continue;
    const dir = path.join(objects, fanout);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory() || st.isSymbolicLink()) continue;
    for (const rest of fs.readdirSync(dir)) {
      if (!/^[a-f0-9]{62}$/.test(rest)) continue;
      hashes.push(`${fanout}${rest}`);
    }
  }
  return hashes;
}

function resolveShortHash(
  options: { rootDir: string; projectName: string },
  prefix: string,
): string {
  if (
    prefix.length < MIN_SHORT_HASH_LENGTH ||
    prefix.length > 63 ||
    !/^[a-f0-9]+$/.test(prefix)
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_REVISION_NOT_FOUND',
      'revision が見つかりません。',
    );
  }
  const repo = versionRepositoryPath(options.rootDir, options.projectName);
  const matches = collectObjectHashes(repo).filter((hash) =>
    hash.startsWith(prefix),
  );
  if (matches.length === 0) {
    throw createVersionControlError(
      'SPEC_VERSION_REVISION_NOT_FOUND',
      'revision が見つかりません。',
    );
  }
  if (matches.length > 1) {
    throw createVersionControlError(
      'SPEC_VERSION_REVISION_AMBIGUOUS',
      '短縮 hash が複数のオブジェクトに一致します。',
    );
  }
  const hash = matches[0];
  if (!hash) {
    throw createVersionControlError(
      'SPEC_VERSION_REVISION_NOT_FOUND',
      'revision が見つかりません。',
    );
  }
  // commit のみ受理（blob/tree/tag の短縮一致は type mismatch）
  readVersionObject({ ...options, hash, expectedType: 'commit' });
  return hash;
}

/**
 * revision 文字列を commit に解決する。
 *
 * 優先順位:
 * 1. 明示的な refs/heads/... / refs/tags/...
 * 2. HEAD
 * 3. 64 hex 完全 hash
 * 4. 一意な短縮 hash（最短 7）
 * 5. branch と tag の短名が両方ある場合は曖昧エラー
 * 6. branch
 * 7. tag（commit へ peel）
 */
export function resolveVersionRevision(options: {
  rootDir: string;
  projectName: string;
  revision: string;
}): ResolvedVersionRevision {
  const revision = options.revision.trim();
  if (revision === '' || revision.includes('\0')) {
    throw createVersionControlError(
      'SPEC_VERSION_REVISION_NOT_FOUND',
      'revision が見つかりません。',
    );
  }

  if (revision === 'HEAD') {
    const head = readVersionHead(options);
    if (head.unborn || !head.commit || !head.tree) {
      throw createVersionControlError(
        'SPEC_VERSION_REVISION_NOT_FOUND',
        'HEAD に commit がありません。',
      );
    }
    return {
      commitHash: head.commit,
      treeHash: head.tree,
      kind: 'head',
      refName: head.ref ?? undefined,
    };
  }

  if (revision.startsWith('refs/heads/')) {
    const name = validateRefName('heads', revision.slice('refs/heads/'.length));
    const commitHash = readVersionRef({
      ...options,
      kind: 'heads',
      name,
    });
    return {
      commitHash,
      treeHash: commitTree(options, commitHash),
      kind: 'branch',
      refName: name,
    };
  }

  if (revision.startsWith('refs/tags/')) {
    const name = validateRefName('tags', revision.slice('refs/tags/'.length));
    const tagHash = readVersionRef({
      ...options,
      kind: 'tags',
      name,
    });
    const commitHash = peelTagToCommit(options, tagHash, new Set());
    return {
      commitHash,
      treeHash: commitTree(options, commitHash),
      kind: 'tag',
      refName: name,
    };
  }

  if (/^[a-f0-9]{64}$/.test(revision)) {
    assertValidObjectHash(revision);
    return {
      commitHash: revision,
      treeHash: commitTree(options, revision),
      kind: 'hash',
    };
  }

  if (/^[a-f0-9]{7,63}$/.test(revision)) {
    const commitHash = resolveShortHash(options, revision);
    return {
      commitHash,
      treeHash: commitTree(options, commitHash),
      kind: 'hash',
    };
  }

  const branches = new Set(listRefNames({ ...options, kind: 'heads' }));
  const tags = new Set(listRefNames({ ...options, kind: 'tags' }));
  const asBranch = branches.has(revision);
  const asTag = tags.has(revision);
  if (asBranch && asTag) {
    throw createVersionControlError(
      'SPEC_VERSION_REVISION_AMBIGUOUS',
      'branch と tag で同じ名前が存在します。refs/ を明示してください。',
    );
  }
  if (asBranch) {
    const commitHash = readVersionRef({
      ...options,
      kind: 'heads',
      name: revision,
    });
    return {
      commitHash,
      treeHash: commitTree(options, commitHash),
      kind: 'branch',
      refName: revision,
    };
  }
  if (asTag) {
    const tagHash = readVersionRef({
      ...options,
      kind: 'tags',
      name: revision,
    });
    const commitHash = peelTagToCommit(options, tagHash, new Set());
    return {
      commitHash,
      treeHash: commitTree(options, commitHash),
      kind: 'tag',
      refName: revision,
    };
  }

  throw createVersionControlError(
    'SPEC_VERSION_REVISION_NOT_FOUND',
    'revision が見つかりません。',
  );
}
