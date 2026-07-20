import { createWorkingSnapshot, type WorkingSnapshot } from './snapshot.js';
import { readVersionHead } from './head.js';
import { readVersionMergeState } from './merge-state.js';
import { EMPTY_TREE_HASH, readVersionIndex } from './version-index.js';
import { readVersionObject } from './object-store.js';
import type { TreeObject } from './types.js';
import { createVersionControlError } from './errors.js';
import type { MergeConflict } from './merge-conflict.js';

export type VersionChange = {
  path: string;
  kind: 'added' | 'modified' | 'deleted' | 'typeChanged';
  oldHash?: string;
  newHash?: string;
  oldType?: 'blob' | 'tree';
  newType?: 'blob' | 'tree';
  scope:
    | 'project'
    | 'screen'
    | 'feature'
    | 'reference'
    | 'capture'
    | 'theme'
    | 'other';
  screenId?: string;
  featureId?: string;
  assetType?: 'meta' | 'png' | 'html' | 'json' | 'css' | 'other';
};

type FlatEntry = { hash: string; type: 'blob' | 'tree' };

function classify(path: string): Pick<
  VersionChange,
  'scope' | 'screenId' | 'assetType'
> {
  if (path === 'project.json') {
    return { scope: 'project', assetType: 'json' };
  }
  if (path === 'features.json') {
    return { scope: 'feature', assetType: 'json' };
  }
  if (path === 'theme/preview.css') {
    return { scope: 'theme', assetType: 'css' };
  }
  const media = /^screens\/([^/]+)\/(references|captures)\//.exec(path);
  if (media) {
    const assetType = path.endsWith('.png')
      ? 'png'
      : path.endsWith('meta.json')
        ? 'meta'
        : 'other';
    return {
      scope: media[2] === 'references' ? 'reference' : 'capture',
      screenId: media[1],
      assetType,
    };
  }
  const screen = /^screens\/([^/]+)/.exec(path);
  if (screen) {
    let assetType: VersionChange['assetType'] = 'other';
    if (path.endsWith('.html')) assetType = 'html';
    else if (path.endsWith('.json')) assetType = 'json';
    else if (path.endsWith('.css')) assetType = 'css';
    return { scope: 'screen', screenId: screen[1], assetType };
  }
  return { scope: 'other', assetType: 'other' };
}

function compareName(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** object store 上の tree を logical file path へ展開する。 */
export function flattenVersionTree(
  options: { rootDir: string; projectName: string },
  hash: string | null,
  prefix = '',
  output = new Map<string, FlatEntry>(),
): Map<string, FlatEntry> {
  if (!hash || hash === EMPTY_TREE_HASH) {
    return output;
  }
  let obj;
  try {
    obj = readVersionObject({
      ...options,
      hash,
      expectedType: 'tree',
    });
  } catch (err) {
    if (err instanceof Error && 'code' in err) {
      throw err;
    }
    throw createVersionControlError(
      'SPEC_VERSION_DIFF_FAILED',
      'tree を展開できませんでした。',
    );
  }
  const tree = JSON.parse(obj.payload.toString('utf8')) as TreeObject;
  for (const entry of tree.entries) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.objectType === 'tree') {
      flattenVersionTree(options, entry.hash, name, output);
    } else {
      output.set(name, { hash: entry.hash, type: 'blob' });
    }
  }
  return output;
}

/** in-memory snapshot を logical file path へ展開する（object store 不要）。 */
export function flattenSnapshotTree(
  snapshot: WorkingSnapshot,
): Map<string, FlatEntry> {
  const output = new Map<string, FlatEntry>();
  const visit = (hash: string, prefix: string): void => {
    const object = snapshot.objects.get(hash);
    if (!object) {
      throw createVersionControlError(
        'SPEC_VERSION_DIFF_FAILED',
        'snapshot object が不足しています。',
      );
    }
    const nul = object.encoded.indexOf(0);
    const header = object.encoded.subarray(0, nul).toString('utf8');
    const type = header.slice(0, header.indexOf(' '));
    if (type === 'blob') {
      if (prefix) {
        output.set(prefix, { hash, type: 'blob' });
      }
      return;
    }
    if (type !== 'tree') {
      throw createVersionControlError(
        'SPEC_VERSION_DIFF_FAILED',
        '未対応の object type です。',
      );
    }
    const tree = JSON.parse(
      object.encoded.subarray(nul + 1).toString('utf8'),
    ) as TreeObject;
    for (const entry of tree.entries) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.objectType === 'tree') {
        visit(entry.hash, name);
      } else {
        output.set(name, { hash: entry.hash, type: 'blob' });
      }
    }
  };
  visit(snapshot.rootTreeHash, '');
  return output;
}

function diffFlatMaps(
  oldFiles: Map<string, FlatEntry>,
  newFiles: Map<string, FlatEntry>,
): VersionChange[] {
  const paths = new Set([...oldFiles.keys(), ...newFiles.keys()]);
  const changes: VersionChange[] = [];
  for (const path of [...paths].sort(compareName)) {
    const old = oldFiles.get(path);
    const next = newFiles.get(path);
    if (old?.hash === next?.hash && old?.type === next?.type) {
      continue;
    }
    const kind: VersionChange['kind'] = !old
      ? 'added'
      : !next
        ? 'deleted'
        : old.type !== next.type
          ? 'typeChanged'
          : 'modified';
    changes.push({
      path,
      kind,
      oldHash: old?.hash,
      newHash: next?.hash,
      oldType: old?.type,
      newType: next?.type,
      ...classify(path),
    });
  }
  return changes;
}

/**
 * object store 上の 2 tree を比較する。
 * 同一 hash の subtree は展開せず skip する（flatten 前に root が等しければ空）。
 */
export function diffVersionTrees(options: {
  rootDir: string;
  projectName: string;
  oldTreeHash: string | null;
  newTreeHash: string | null;
}): VersionChange[] {
  if (options.oldTreeHash === options.newTreeHash) {
    return [];
  }
  return diffFlatMaps(
    flattenVersionTree(options, options.oldTreeHash),
    flattenVersionTree(options, options.newTreeHash),
  );
}

export type VersionStatusResult = {
  stagedChanges: VersionChange[];
  unstagedChanges: VersionChange[];
  clean: boolean;
  unborn: boolean;
  headCommit: string | null;
  headRef: string | null;
  indexRevision: string;
  indexTree: string;
  workingTree: string;
  headChangedSinceIndex: boolean;
  mergeInProgress: boolean;
  mergeBase: string | null;
  mergeTarget: string | null;
  unresolvedConflicts: MergeConflict[];
  resolvedConflicts: MergeConflict[];
};

/**
 * HEAD / index / working snapshot を比較する。read-only（object / index を書かない）。
 */
export function getVersionStatus(options: {
  rootDir: string;
  projectName: string;
}): VersionStatusResult {
  const head = readVersionHead(options);
  const index = readVersionIndex(options);
  const snapshot = createWorkingSnapshot(options);

  const headFiles = flattenVersionTree(options, head.tree);
  const indexFiles = flattenVersionTree(options, index.tree);
  const workingFiles = flattenSnapshotTree(snapshot);

  const stagedChanges = diffFlatMaps(headFiles, indexFiles);
  const unstagedChanges = diffFlatMaps(indexFiles, workingFiles);
  const mergeState = readVersionMergeState(options);
  const resolved = new Set(mergeState?.resolvedPaths ?? []);
  const unresolvedConflicts =
    mergeState?.conflicts.filter((c) => !resolved.has(c.path)) ?? [];
  const resolvedConflicts =
    mergeState?.conflicts.filter((c) => resolved.has(c.path)) ?? [];

  return {
    stagedChanges,
    unstagedChanges,
    clean: stagedChanges.length === 0 && unstagedChanges.length === 0,
    unborn: head.unborn,
    headCommit: head.commit,
    headRef: head.ref,
    indexRevision: index.revision,
    indexTree: index.tree,
    workingTree: snapshot.rootTreeHash,
    headChangedSinceIndex: head.commit !== index.baseCommit,
    mergeInProgress: mergeState != null,
    mergeBase: mergeState?.base ?? null,
    mergeTarget: mergeState?.theirs ?? null,
    unresolvedConflicts,
    resolvedConflicts,
  };
}
