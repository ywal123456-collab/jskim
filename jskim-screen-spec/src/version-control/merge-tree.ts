import type { MergeConflict, MergeConflictKind } from './merge-conflict.js';
import { mergeFeaturesDocument } from './merge-features.js';
import {
  collectScreenIdsFromPaths,
  mergeProjectDocument,
} from './merge-project.js';
import { writeVersionObject, readVersionObject } from './object-store.js';
import { flattenVersionTree } from './status.js';

type FlatEntry = { hash: string; type: 'blob' | 'tree' };

export type MergeTreeResult = {
  mergedFiles: Map<string, FlatEntry>;
  conflicts: MergeConflict[];
};

function readBlobBytes(
  options: { rootDir: string; projectName: string },
  hash: string | undefined,
): Buffer | null {
  if (!hash) return null;
  return readVersionObject({
    ...options,
    hash,
    expectedType: 'blob',
  }).payload;
}

function conflictKindForPath(path: string, reason?: string): MergeConflictKind {
  if (path === 'project.json') {
    if (reason === 'projectName') return 'projectName';
    if (reason === 'screenOrder') return 'screenOrder';
    return 'content';
  }
  if (path === 'features.json') return 'features';
  return 'content';
}

function mergeBlobPath(
  path: string,
  base: FlatEntry | undefined,
  ours: FlatEntry | undefined,
  theirs: FlatEntry | undefined,
): { entry: FlatEntry | null; conflict: MergeConflict | null } {
  const baseHash = base?.hash ?? null;
  const oursHash = ours?.hash ?? null;
  const theirsHash = theirs?.hash ?? null;

  if (base && ours && theirs) {
    if (base.hash === ours.hash && base.hash === theirs.hash) {
      return { entry: ours, conflict: null };
    }
    if (base.hash === ours.hash && base.hash !== theirs.hash) {
      return { entry: theirs, conflict: null };
    }
    if (base.hash === theirs.hash && base.hash !== ours.hash) {
      return { entry: ours, conflict: null };
    }
    if (ours.hash === theirs.hash) {
      return { entry: ours, conflict: null };
    }
    return {
      entry: null,
      conflict: {
        path,
        kind: 'content',
        baseHash,
        oursHash,
        theirsHash,
      },
    };
  }

  if (!base && ours && theirs) {
    if (ours.hash === theirs.hash) {
      return { entry: ours, conflict: null };
    }
    return {
      entry: null,
      conflict: {
        path,
        kind: 'add-add',
        baseHash: null,
        oursHash,
        theirsHash,
      },
    };
  }

  if (base && !ours && !theirs) {
    return { entry: null, conflict: null };
  }
  if (base && !ours && theirs) {
    if (base.hash === theirs.hash) {
      return { entry: null, conflict: null };
    }
    return {
      entry: null,
      conflict: {
        path,
        kind: 'delete-modify',
        baseHash,
        oursHash: null,
        theirsHash,
      },
    };
  }
  if (base && ours && !theirs) {
    if (base.hash === ours.hash) {
      return { entry: null, conflict: null };
    }
    return {
      entry: null,
      conflict: {
        path,
        kind: 'delete-modify',
        baseHash,
        oursHash,
        theirsHash: null,
      },
    };
  }
  if (!base && ours && !theirs) {
    return { entry: ours, conflict: null };
  }
  if (!base && !ours && theirs) {
    return { entry: theirs, conflict: null };
  }

  return { entry: null, conflict: null };
}

/**
 * logical path 集合の generic 3-way merge。
 * project.json / features.json は domain merge を使う。
 */
export function mergeLogicalTrees(options: {
  rootDir: string;
  projectName: string;
  baseTree: string;
  oursTree: string;
  theirsTree: string;
}): MergeTreeResult {
  const repo = options;
  const baseFiles = flattenVersionTree(repo, options.baseTree);
  const oursFiles = flattenVersionTree(repo, options.oursTree);
  const theirsFiles = flattenVersionTree(repo, options.theirsTree);

  const allPaths = new Set([
    ...baseFiles.keys(),
    ...oursFiles.keys(),
    ...theirsFiles.keys(),
  ]);

  const knownScreenIds = collectScreenIdsFromPaths(allPaths);
  const mergedFiles = new Map<string, FlatEntry>();
  const conflicts: MergeConflict[] = [];

  for (const logicalPath of [...allPaths].sort()) {
    if (logicalPath === 'project.json') {
      const result = mergeProjectDocument({
        projectName: options.projectName,
        knownScreenIds,
        base: readBlobBytes(repo, baseFiles.get(logicalPath)?.hash),
        ours: readBlobBytes(repo, oursFiles.get(logicalPath)?.hash),
        theirs: readBlobBytes(repo, theirsFiles.get(logicalPath)?.hash),
      });
      if (!result.ok) {
        conflicts.push({
          path: logicalPath,
          kind: conflictKindForPath(logicalPath, result.reason),
          baseHash: baseFiles.get(logicalPath)?.hash ?? null,
          oursHash: oursFiles.get(logicalPath)?.hash ?? null,
          theirsHash: theirsFiles.get(logicalPath)?.hash ?? null,
        });
        continue;
      }
      const write = writeVersionObject({
        ...repo,
        type: 'blob',
        payload: result.bytes,
      });
      mergedFiles.set(logicalPath, { hash: write.hash, type: 'blob' });
      continue;
    }

    if (logicalPath === 'features.json') {
      const result = mergeFeaturesDocument({
        knownScreenIds,
        base: readBlobBytes(repo, baseFiles.get(logicalPath)?.hash),
        ours: readBlobBytes(repo, oursFiles.get(logicalPath)?.hash),
        theirs: readBlobBytes(repo, theirsFiles.get(logicalPath)?.hash),
      });
      if (!result.ok) {
        conflicts.push({
          path: logicalPath,
          kind: 'features',
          baseHash: baseFiles.get(logicalPath)?.hash ?? null,
          oursHash: oursFiles.get(logicalPath)?.hash ?? null,
          theirsHash: theirsFiles.get(logicalPath)?.hash ?? null,
        });
        continue;
      }
      const write = writeVersionObject({
        ...repo,
        type: 'blob',
        payload: result.bytes,
      });
      mergedFiles.set(logicalPath, { hash: write.hash, type: 'blob' });
      continue;
    }

    const base = baseFiles.get(logicalPath);
    const ours = oursFiles.get(logicalPath);
    const theirs = theirsFiles.get(logicalPath);
    const { entry, conflict } = mergeBlobPath(logicalPath, base, ours, theirs);
    if (conflict) {
      conflicts.push(conflict);
      continue;
    }
    if (entry) {
      mergedFiles.set(logicalPath, entry);
    }
  }

  return { mergedFiles, conflicts };
}

/** merge 結果から working tree 用の完全 flat map（conflict path は ours を保持）。 */
export function buildWorkingTreeFiles(options: {
  rootDir: string;
  projectName: string;
  oursTree: string;
  mergeResult: MergeTreeResult;
}): Map<string, FlatEntry> {
  const oursFiles = flattenVersionTree(options, options.oursTree);
  const result = new Map<string, FlatEntry>();
  const conflictPaths = new Set(
    options.mergeResult.conflicts.map((c) => c.path),
  );

  for (const [p, entry] of options.mergeResult.mergedFiles) {
    result.set(p, entry);
  }
  for (const conflict of options.mergeResult.conflicts) {
    const ours = oursFiles.get(conflict.path);
    if (ours) {
      result.set(conflict.path, ours);
    }
  }
  for (const [p, entry] of oursFiles) {
    if (!result.has(p) && !conflictPaths.has(p)) {
      result.set(p, entry);
    }
  }
  return result;
}

/** auto-merge 成功時の index tree 用 flat map（conflict path は ours）。 */
export function buildIndexTreeFiles(options: {
  rootDir: string;
  projectName: string;
  oursTree: string;
  mergeResult: MergeTreeResult;
}): Map<string, FlatEntry> {
  return buildWorkingTreeFiles(options);
}

/** conflict 時: index は ours tree のまま。 */
export function oursTreeFiles(options: {
  rootDir: string;
  projectName: string;
  oursTree: string;
}): Map<string, FlatEntry> {
  return flattenVersionTree(options, options.oursTree);
}
