import { createVersionControlError } from './errors.js';
import { readVersionObject } from './object-store.js';
import type { CommitObject } from './types.js';
import { assertCommitObject } from './validate-object.js';

export type MergeBaseKind = 'already-up-to-date' | 'fast-forward' | 'three-way';

export type MergeBaseResult = {
  kind: MergeBaseKind;
  ours: string;
  theirs: string;
  base: string;
  oursTree: string;
  theirsTree: string;
  baseTree: string;
};

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

function collectAncestors(
  options: { rootDir: string; projectName: string },
  start: string,
): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const hash = queue.shift();
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    const commit = loadCommit(options, hash);
    for (const parent of commit.parents) {
      if (!seen.has(parent)) {
        queue.push(parent);
      }
    }
  }
  return seen;
}

function isAncestorOf(
  options: { rootDir: string; projectName: string },
  ancestor: string,
  commit: string,
): boolean {
  if (ancestor === commit) return true;
  const ancestors = collectAncestors(options, commit);
  return ancestors.has(ancestor);
}

/**
 * 両 commit から到達可能な common ancestor のうち、
 * 他の common ancestor の子孫にならないもの（best bases）を返す。
 */
function findBestCommonBases(
  options: { rootDir: string; projectName: string },
  ours: string,
  theirs: string,
): string[] {
  const oursAncestors = collectAncestors(options, ours);
  const theirsAncestors = collectAncestors(options, theirs);
  const common: string[] = [];
  for (const hash of oursAncestors) {
    if (theirsAncestors.has(hash)) {
      common.push(hash);
    }
  }
  if (common.length === 0) {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_BASE_NOT_FOUND',
      '共通 ancestor が見つかりません。',
    );
  }
  const best = common.filter(
    (candidate) =>
      !common.some(
        (other) =>
          other !== candidate &&
          isAncestorOf(options, other, candidate) &&
          !isAncestorOf(options, candidate, other),
      ),
  );
  if (best.length === 0) {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_BASE_NOT_FOUND',
      '共通 ancestor が見つかりません。',
    );
  }
  return best;
}

/**
 * current（ours）と target（theirs）の merge 種別と 3-way base を決定する。
 * DAG は parents[] のみを辿り、timestamp は使わない。
 */
export function findMergeBase(options: {
  rootDir: string;
  projectName: string;
  currentCommit: string;
  targetCommit: string;
}): MergeBaseResult {
  const ours = options.currentCommit;
  const theirs = options.targetCommit;

  if (ours === theirs) {
    const commit = loadCommit(options, ours);
    return {
      kind: 'already-up-to-date',
      ours,
      theirs,
      base: ours,
      oursTree: commit.tree,
      theirsTree: commit.tree,
      baseTree: commit.tree,
    };
  }

  if (isAncestorOf(options, theirs, ours)) {
    const commit = loadCommit(options, ours);
    return {
      kind: 'already-up-to-date',
      ours,
      theirs,
      base: theirs,
      oursTree: commit.tree,
      theirsTree: loadCommit(options, theirs).tree,
      baseTree: loadCommit(options, theirs).tree,
    };
  }

  if (isAncestorOf(options, ours, theirs)) {
    const oursCommit = loadCommit(options, ours);
    const theirsCommit = loadCommit(options, theirs);
    return {
      kind: 'fast-forward',
      ours,
      theirs,
      base: ours,
      oursTree: oursCommit.tree,
      theirsTree: theirsCommit.tree,
      baseTree: oursCommit.tree,
    };
  }

  const bestBases = findBestCommonBases(options, ours, theirs);
  if (bestBases.length > 1) {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_BASE_AMBIGUOUS',
      '複数の merge base が見つかりました。',
    );
  }
  const base = bestBases[0];
  if (!base) {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_BASE_NOT_FOUND',
      '共通 ancestor が見つかりません。',
    );
  }
  const baseCommit = loadCommit(options, base);
  return {
    kind: 'three-way',
    ours,
    theirs,
    base,
    oursTree: loadCommit(options, ours).tree,
    theirsTree: loadCommit(options, theirs).tree,
    baseTree: baseCommit.tree,
  };
}
