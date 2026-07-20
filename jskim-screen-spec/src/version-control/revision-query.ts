import { createVersionControlError, VersionControlError } from './errors.js';
import { readVersionHead } from './head.js';
import { listIncompleteTransactions } from './transaction.js';
import { readVersionObject } from './object-store.js';
import { versionRepositoryPath } from './repository-paths.js';
import { resolveVersionRevision } from './revision-resolver.js';
import {
  diffVersionTrees,
  flattenVersionTree,
  getVersionStatus,
  type VersionChange,
} from './status.js';
import { listVersionBranches } from './branch-version.js';
import { listVersionTags } from './tag-version.js';
import { EMPTY_TREE_HASH } from './version-index.js';
import type { CommitObject } from './types.js';
import { assertCommitObject } from './validate-object.js';
import fs from 'node:fs';
import path from 'node:path';
import { loadScreenFeatures } from '../features/load-features.js';
import { loadScreenSpecProject } from '../builder/load-screen-spec-project.js';

export type BrowserVersionStatus =
  | {
      initialized: false;
      capability: 'local-read-only';
    }
  | {
      initialized: true;
      capability: 'local-read-only';
      head: {
        mode: 'symbolic' | 'detached';
        branch?: string;
        commit?: string;
        shortHash?: string;
        unborn: boolean;
      };
      workingTree: {
        clean: boolean;
        stagedCount: number;
        unstagedCount: number;
      };
      recovery: {
        required: boolean;
        operation?: string;
        phase?: string;
      };
    };

export type BrowserRevisionSummary = {
  changedFeatureCount: number;
  changedScreenCount: number;
  changedItemCount: number;
  changedReferenceCount: number;
  changedCaptureCount: number;
};

export type BrowserRevisionListItem = {
  hash: string;
  shortHash: string;
  parents: string[];
  parentCount: number;
  message: string;
  author: { name: string };
  committedAt: string;
  tags: string[];
  summary: BrowserRevisionSummary;
};

export type BrowserScreenChange = {
  screenId: string;
  kind: 'added' | 'modified' | 'deleted';
  sections: string[];
};

export type BrowserFeatureChange = {
  featureId: string;
  kind: 'added' | 'modified' | 'deleted';
  membershipChanged: boolean;
  orderChanged: boolean;
  name?: string;
};

export type BrowserAssetChange = {
  screenId: string;
  viewport?: string;
  stateId?: string;
  kind: 'added' | 'modified' | 'deleted';
  assetType: 'reference' | 'capture';
};

export type BrowserItemChange = {
  itemId: string;
  kind: 'added' | 'modified' | 'deleted';
  changedFields?: string[];
  label?: string;
};

export type BrowserRevisionDetail = {
  hash: string;
  shortHash: string;
  parents: string[];
  parentCount: number;
  message: string;
  author: { name: string };
  committedAt: string;
  tags: string[];
  isMerge: boolean;
  summary: BrowserRevisionSummary;
  featureChanges: BrowserFeatureChange[];
  screenChanges: BrowserScreenChange[];
  itemChanges: BrowserItemChange[];
  assetChanges: BrowserAssetChange[];
  truncated: boolean;
};

export type BrowserFeatureList = {
  features: Array<{
    featureId: string;
    name: string;
    displayOrder: number;
    screenIds: string[];
  }>;
  ungroupedScreenIds: string[];
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_ITEM_CHANGES = 200;
const MAX_SCREEN_CHANGES = 200;
const MAX_ASSET_CHANGES = 200;
const SCREEN_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const FEATURE_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

function isRepoInitialized(rootDir: string, projectName: string): boolean {
  return fs.existsSync(
    path.join(versionRepositoryPath(rootDir, projectName), 'format.json'),
  );
}

function loadCommit(
  options: { rootDir: string; projectName: string },
  hash: string,
): CommitObject {
  const object = readVersionObject({
    ...options,
    hash,
    expectedType: 'commit',
  });
  return assertCommitObject(JSON.parse(object.payload.toString('utf8')));
}

function assertScreenId(screenId: string): string {
  if (
    typeof screenId !== 'string' ||
    screenId.length === 0 ||
    screenId.length > 128 ||
    !SCREEN_ID_RE.test(screenId)
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      'screenId が不正です。',
    );
  }
  return screenId;
}

function assertFeatureId(featureId: string): string {
  if (
    typeof featureId !== 'string' ||
    featureId.length === 0 ||
    featureId.length > 128 ||
    !FEATURE_ID_RE.test(featureId)
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      'featureId が不正です。',
    );
  }
  return featureId;
}

function parseLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      `limit は 1〜${MAX_LIMIT} の整数である必要があります。`,
    );
  }
  return value;
}

function parentTreeHash(
  options: { rootDir: string; projectName: string },
  commit: CommitObject,
): string {
  if (commit.parents.length === 0) return EMPTY_TREE_HASH;
  const parent = loadCommit(options, commit.parents[0]!);
  return parent.tree;
}

function buildTagMap(options: {
  rootDir: string;
  projectName: string;
}): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const tag of listVersionTags(options)) {
    const list = map.get(tag.targetCommitHash) ?? [];
    list.push(tag.name);
    map.set(tag.targetCommitHash, list);
  }
  return map;
}

function readJsonBlob(
  options: { rootDir: string; projectName: string },
  treeHash: string,
  logicalPath: string,
): unknown | null {
  const files = flattenVersionTree(options, treeHash);
  const entry = files.get(logicalPath);
  if (!entry || entry.type !== 'blob') return null;
  const object = readVersionObject({
    ...options,
    hash: entry.hash,
    expectedType: 'blob',
  });
  try {
    return JSON.parse(object.payload.toString('utf8'));
  } catch {
    return null;
  }
}

type FeatureSnap = {
  byId: Map<string, { name: string; displayOrder: number; screenIds: string[] }>;
  screenToFeature: Map<string, string>;
};

function readFeatureSnap(
  options: { rootDir: string; projectName: string },
  treeHash: string,
): FeatureSnap {
  const byId = new Map<
    string,
    { name: string; displayOrder: number; screenIds: string[] }
  >();
  const screenToFeature = new Map<string, string>();
  const raw = readJsonBlob(options, treeHash, 'features.json');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { byId, screenToFeature };
  }
  const features = (raw as { features?: unknown }).features;
  if (!Array.isArray(features)) return { byId, screenToFeature };
  for (const item of features) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.featureId !== 'string') continue;
    const screenIds = Array.isArray(rec.screenIds)
      ? rec.screenIds.filter((id): id is string => typeof id === 'string')
      : [];
    byId.set(rec.featureId, {
      name: typeof rec.name === 'string' ? rec.name : rec.featureId,
      displayOrder:
        typeof rec.displayOrder === 'number' ? rec.displayOrder : 0,
      screenIds,
    });
    for (const sid of screenIds) {
      screenToFeature.set(sid, rec.featureId);
    }
  }
  return { byId, screenToFeature };
}

function readScreenOrder(
  options: { rootDir: string; projectName: string },
  treeHash: string,
): string[] {
  const raw = readJsonBlob(options, treeHash, 'project.json');
  if (!raw || typeof raw !== 'object') return [];
  const order = (raw as { screenOrder?: unknown }).screenOrder;
  return Array.isArray(order)
    ? order.filter((id): id is string => typeof id === 'string')
    : [];
}

function summarizeChanges(changes: VersionChange[]): BrowserRevisionSummary {
  const features = new Set<string>();
  const screens = new Set<string>();
  let items = 0;
  let references = 0;
  let captures = 0;
  for (const change of changes) {
    if (change.scope === 'feature' || change.path === 'features.json') {
      features.add(change.featureId ?? 'features');
    }
    if (change.screenId) screens.add(change.screenId);
    if (change.path.includes('/description.json')) items += 1;
    if (change.scope === 'reference') references += 1;
    if (change.scope === 'capture') captures += 1;
  }
  return {
    changedFeatureCount: features.size,
    changedScreenCount: screens.size,
    changedItemCount: items,
    changedReferenceCount: references,
    changedCaptureCount: captures,
  };
}

function buildSemanticDiff(
  options: { rootDir: string; projectName: string },
  oldTree: string,
  newTree: string,
): {
  featureChanges: BrowserFeatureChange[];
  screenChanges: BrowserScreenChange[];
  itemChanges: BrowserItemChange[];
  assetChanges: BrowserAssetChange[];
  summary: BrowserRevisionSummary;
  truncated: boolean;
} {
  const changes = diffVersionTrees({
    ...options,
    oldTreeHash: oldTree,
    newTreeHash: newTree,
  });
  const oldFeat = readFeatureSnap(options, oldTree);
  const newFeat = readFeatureSnap(options, newTree);
  const oldOrder = readScreenOrder(options, oldTree);
  const newOrder = readScreenOrder(options, newTree);

  const featureChanges: BrowserFeatureChange[] = [];
  const allFeatureIds = new Set([
    ...oldFeat.byId.keys(),
    ...newFeat.byId.keys(),
  ]);
  for (const featureId of [...allFeatureIds].sort()) {
    const oldF = oldFeat.byId.get(featureId);
    const newF = newFeat.byId.get(featureId);
    if (!oldF && newF) {
      featureChanges.push({
        featureId,
        kind: 'added',
        membershipChanged: true,
        orderChanged: false,
        name: newF.name,
      });
    } else if (oldF && !newF) {
      featureChanges.push({
        featureId,
        kind: 'deleted',
        membershipChanged: true,
        orderChanged: false,
        name: oldF.name,
      });
    } else if (oldF && newF) {
      const membershipChanged =
        oldF.screenIds.join('\0') !== newF.screenIds.join('\0');
      const orderChanged = oldF.displayOrder !== newF.displayOrder;
      const renamed = oldF.name !== newF.name;
      if (membershipChanged || orderChanged || renamed) {
        featureChanges.push({
          featureId,
          kind: 'modified',
          membershipChanged,
          orderChanged,
          name: newF.name,
        });
      }
    }
  }

  const screenMap = new Map<string, Set<string>>();
  const markScreen = (screenId: string, section: string) => {
    const set = screenMap.get(screenId) ?? new Set<string>();
    set.add(section);
    screenMap.set(screenId, set);
  };

  for (const change of changes) {
    if (change.screenId) {
      if (change.scope === 'reference') markScreen(change.screenId, 'reference');
      else if (change.scope === 'capture') markScreen(change.screenId, 'capture');
      else if (change.path.includes('/description.json'))
        markScreen(change.screenId, 'description');
      else if (change.path.includes('/source.json'))
        markScreen(change.screenId, 'source');
      else if (change.path.includes('/snapshots/'))
        markScreen(change.screenId, 'state');
      else if (change.path.includes('/resources/'))
        markScreen(change.screenId, 'resource');
      else markScreen(change.screenId, 'other');
    }
  }
  for (const id of oldOrder) {
    if (!newOrder.includes(id)) markScreen(id, 'screenOrder');
  }
  for (const id of newOrder) {
    if (!oldOrder.includes(id)) markScreen(id, 'screenOrder');
  }
  for (const [sid, fid] of oldFeat.screenToFeature) {
    if (newFeat.screenToFeature.get(sid) !== fid) {
      markScreen(sid, 'membership');
    }
  }
  for (const [sid, fid] of newFeat.screenToFeature) {
    if (oldFeat.screenToFeature.get(sid) !== fid) {
      markScreen(sid, 'membership');
    }
  }

  const screenChanges: BrowserScreenChange[] = [];
  let truncated = false;
  for (const [screenId, sections] of [...screenMap.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  )) {
    if (screenChanges.length >= MAX_SCREEN_CHANGES) {
      truncated = true;
      break;
    }
    const inOld = oldOrder.includes(screenId);
    const inNew = newOrder.includes(screenId);
    const kind =
      !inOld && inNew ? 'added' : inOld && !inNew ? 'deleted' : 'modified';
    screenChanges.push({
      screenId,
      kind,
      sections: [...sections].sort(),
    });
  }

  const assetChanges: BrowserAssetChange[] = [];
  for (const change of changes) {
    if (change.scope !== 'reference' && change.scope !== 'capture') continue;
    if (!change.screenId) continue;
    if (assetChanges.length >= MAX_ASSET_CHANGES) {
      truncated = true;
      break;
    }
    const parts = change.path.split('/');
    // screens/{id}/references/{viewport}/...
    // screens/{id}/captures/{state}/{viewport}/...
    let viewport: string | undefined;
    let stateId: string | undefined;
    if (change.scope === 'reference' && parts.length >= 4) {
      viewport = parts[3];
    }
    if (change.scope === 'capture' && parts.length >= 5) {
      stateId = parts[3];
      viewport = parts[4];
    }
    assetChanges.push({
      screenId: change.screenId,
      viewport,
      stateId,
      kind:
        change.kind === 'added'
          ? 'added'
          : change.kind === 'deleted'
            ? 'deleted'
            : 'modified',
      assetType: change.scope,
    });
  }

  const itemChanges: BrowserItemChange[] = [];
  for (const change of changes) {
    if (!change.path.endsWith('/description.json') || !change.screenId) {
      continue;
    }
    try {
      const oldDoc = readJsonBlob(options, oldTree, change.path) as {
        items?: Record<string, Record<string, unknown>>;
        itemOrder?: string[];
      } | null;
      const newDoc = readJsonBlob(options, newTree, change.path) as {
        items?: Record<string, Record<string, unknown>>;
        itemOrder?: string[];
      } | null;
      if (!oldDoc && !newDoc) {
        continue;
      }
      const oldItems = oldDoc?.items ?? {};
      const newItems = newDoc?.items ?? {};
      const ids = new Set([...Object.keys(oldItems), ...Object.keys(newItems)]);
      let parsedItems = false;
      for (const itemId of [...ids].sort()) {
        if (itemChanges.length >= MAX_ITEM_CHANGES) {
          truncated = true;
          break;
        }
        const oldItem = oldItems[itemId];
        const newItem = newItems[itemId];
        if (!oldItem && newItem) {
          parsedItems = true;
          itemChanges.push({
            itemId,
            kind: 'added',
            label:
              typeof newItem.name === 'string' ? newItem.name : undefined,
          });
        } else if (oldItem && !newItem) {
          parsedItems = true;
          itemChanges.push({
            itemId,
            kind: 'deleted',
            label:
              typeof oldItem.name === 'string' ? oldItem.name : undefined,
          });
        } else if (oldItem && newItem) {
          const changedFields: string[] = [];
          for (const field of ['name', 'type', 'description', 'note'] as const) {
            if (oldItem[field] !== newItem[field]) {
              changedFields.push(field);
            }
          }
          if (changedFields.length > 0) {
            parsedItems = true;
            itemChanges.push({
              itemId,
              kind: 'modified',
              changedFields,
              label:
                typeof newItem.name === 'string' ? newItem.name : undefined,
            });
          }
        }
      }
      const oldOrder = Array.isArray(oldDoc?.itemOrder)
        ? oldDoc.itemOrder.join('\0')
        : '';
      const newOrder = Array.isArray(newDoc?.itemOrder)
        ? newDoc.itemOrder.join('\0')
        : '';
      if (oldOrder !== newOrder && !parsedItems) {
        // itemOrder のみ変化した場合は section 側で既に description と印付け済み
        parsedItems = true;
      }
      void parsedItems;
    } catch (err) {
      if (err instanceof VersionControlError) {
        throw err;
      }
      // 任意 detail の parse 失敗は section-level に fallback（revision 全体は失敗させない）
    }
  }

  return {
    featureChanges,
    screenChanges,
    itemChanges,
    assetChanges,
    summary: summarizeChanges(changes),
    truncated,
  };
}

function commitMatchesScope(
  options: { rootDir: string; projectName: string },
  commit: CommitObject,
  scope: 'project' | 'feature' | 'screen',
  featureId?: string,
  screenId?: string,
): boolean {
  if (scope === 'project') return true;
  const oldTree = parentTreeHash(options, commit);
  const changes = diffVersionTrees({
    ...options,
    oldTreeHash: oldTree,
    newTreeHash: commit.tree,
  });
  const oldFeat = readFeatureSnap(options, oldTree);
  const newFeat = readFeatureSnap(options, commit.tree);
  const oldOrder = readScreenOrder(options, oldTree);
  const newOrder = readScreenOrder(options, commit.tree);

  if (scope === 'screen' && screenId) {
    if (changes.some((c) => c.screenId === screenId)) return true;
    if (oldOrder.includes(screenId) !== newOrder.includes(screenId)) {
      return true;
    }
    if (oldOrder.indexOf(screenId) !== newOrder.indexOf(screenId)) {
      return true;
    }
    if (
      oldFeat.screenToFeature.get(screenId) !==
      newFeat.screenToFeature.get(screenId)
    ) {
      return true;
    }
    return false;
  }

  if (scope === 'feature' && featureId) {
    const oldF = oldFeat.byId.get(featureId);
    const newF = newFeat.byId.get(featureId);
    if (!oldF && !newF) {
      // screen content of members still may match via membership at either side
    } else {
      if (!oldF || !newF) return true;
      if (
        oldF.name !== newF.name ||
        oldF.displayOrder !== newF.displayOrder ||
        oldF.screenIds.join('\0') !== newF.screenIds.join('\0')
      ) {
        return true;
      }
    }
    const memberScreens = new Set([
      ...(oldF?.screenIds ?? []),
      ...(newF?.screenIds ?? []),
    ]);
    // screens that moved into/out of this feature
    for (const [sid, fid] of oldFeat.screenToFeature) {
      if (fid === featureId || newFeat.screenToFeature.get(sid) === featureId) {
        memberScreens.add(sid);
      }
    }
    for (const [sid, fid] of newFeat.screenToFeature) {
      if (fid === featureId || oldFeat.screenToFeature.get(sid) === featureId) {
        memberScreens.add(sid);
      }
    }
    for (const change of changes) {
      if (change.screenId && memberScreens.has(change.screenId)) return true;
    }
    return false;
  }

  return false;
}

function walkCommits(
  options: { rootDir: string; projectName: string },
  startHash: string,
): string[] {
  const visited = new Set<string>();
  const queue = [startHash];
  const ordered: string[] = [];
  while (queue.length > 0) {
    const hash = queue.shift();
    if (!hash || visited.has(hash)) continue;
    visited.add(hash);
    ordered.push(hash);
    const commit = loadCommit(options, hash);
    for (const parent of commit.parents) {
      queue.push(parent);
    }
  }
  return ordered;
}

/** Viewer / API 用: repository 状態（未初期化は正常投影）。 */
export function getBrowserVersionStatus(options: {
  rootDir: string;
  projectName: string;
}): BrowserVersionStatus {
  if (!isRepoInitialized(options.rootDir, options.projectName)) {
    return { initialized: false, capability: 'local-read-only' };
  }
  const head = readVersionHead(options);
  const status = getVersionStatus(options);
  const incomplete = listIncompleteTransactions(options);
  const first = incomplete[0];
  const branch =
    head.ref && head.ref.startsWith('refs/heads/')
      ? head.ref.slice('refs/heads/'.length)
      : undefined;
  return {
    initialized: true,
    capability: 'local-read-only',
    head: {
      mode: head.ref ? 'symbolic' : 'detached',
      branch,
      commit: head.commit ?? undefined,
      shortHash: head.commit ? shortHash(head.commit) : undefined,
      unborn: head.unborn,
    },
    workingTree: {
      clean: status.clean,
      stagedCount: status.stagedChanges.length,
      unstagedCount: status.unstagedChanges.length,
    },
    recovery: {
      required: incomplete.length > 0,
      operation: first?.operation,
      phase: first?.phase,
    },
  };
}

/** working tree Feature 一覧（browser-safe）。 */
export function listBrowserVersionFeatures(options: {
  rootDir: string;
  projectName: string;
}): BrowserFeatureList {
  let screenIds: string[] = [];
  try {
    const project = loadScreenSpecProject(options);
    screenIds = project.screens.map((s) => s.screenId);
  } catch {
    screenIds = [];
  }
  const loaded = loadScreenFeatures({
    ...options,
    knownScreenIds: screenIds,
  });
  return {
    features: loaded.features.map((f) => ({
      featureId: f.featureId,
      name: f.name,
      displayOrder: f.displayOrder,
      screenIds: [...f.screenIds],
    })),
    ungroupedScreenIds: [...loaded.ungroupedScreenIds],
  };
}

export type ListBrowserRevisionsOptions = {
  rootDir: string;
  projectName: string;
  scope?: 'project' | 'feature' | 'screen';
  featureId?: string;
  screenId?: string;
  limit?: number;
  cursor?: string;
  historyHead?: string;
};

export type ListBrowserRevisionsResult = {
  historyHead: string | null;
  revisions: BrowserRevisionListItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

/** commit 一覧（scope filter + pagination）。 */
export function listBrowserVersionRevisions(
  options: ListBrowserRevisionsOptions,
): ListBrowserRevisionsResult {
  if (!isRepoInitialized(options.rootDir, options.projectName)) {
    throw createVersionControlError(
      'SPEC_VERSION_NOT_INITIALIZED',
      '版管理リポジトリが初期化されていません。',
    );
  }
  const scope = options.scope ?? 'project';
  if (scope === 'screen') assertScreenId(options.screenId ?? '');
  if (scope === 'feature') assertFeatureId(options.featureId ?? '');
  const limit = parseLimit(options.limit);

  const head = readVersionHead(options);
  if (head.unborn || !head.commit) {
    return {
      historyHead: null,
      revisions: [],
      nextCursor: null,
      hasMore: false,
    };
  }

  if (options.historyHead && options.historyHead !== head.commit) {
    throw createVersionControlError(
      'SPEC_VERSION_HEAD_CHANGED',
      '履歴の起点（HEAD）が変更されています。一覧を再読み込みしてください。',
    );
  }

  const ordered = walkCommits(options, head.commit);
  const tags = buildTagMap(options);
  let startIndex = 0;
  if (options.cursor) {
    const idx = ordered.indexOf(options.cursor);
    if (idx < 0) {
      throw createVersionControlError(
        'SPEC_VERSION_REVISION_NOT_FOUND',
        'cursor が見つかりません。',
      );
    }
    startIndex = idx + 1;
  }

  const revisions: BrowserRevisionListItem[] = [];
  let lastScanned: string | null = null;
  let i = startIndex;
  for (; i < ordered.length; i += 1) {
    const hash = ordered[i]!;
    lastScanned = hash;
    const commit = loadCommit(options, hash);
    if (
      !commitMatchesScope(
        options,
        commit,
        scope,
        options.featureId,
        options.screenId,
      )
    ) {
      continue;
    }
    const oldTree = parentTreeHash(options, commit);
    const changes = diffVersionTrees({
      ...options,
      oldTreeHash: oldTree,
      newTreeHash: commit.tree,
    });
    revisions.push({
      hash,
      shortHash: shortHash(hash),
      parents: [...commit.parents],
      parentCount: commit.parents.length,
      message: commit.message,
      author: { name: commit.author.name },
      committedAt: commit.committedAt,
      tags: tags.get(hash) ?? [],
      summary: summarizeChanges(changes),
    });
    if (revisions.length >= limit) {
      break;
    }
  }

  const hasMore = i + 1 < ordered.length;
  return {
    historyHead: head.commit,
    revisions,
    nextCursor: hasMore && lastScanned ? lastScanned : null,
    hasMore,
  };
}

/** commit 詳細 + first-parent diff 要約。 */
export function getBrowserVersionRevisionDetail(options: {
  rootDir: string;
  projectName: string;
  revision: string;
}): BrowserRevisionDetail {
  if (!isRepoInitialized(options.rootDir, options.projectName)) {
    throw createVersionControlError(
      'SPEC_VERSION_NOT_INITIALIZED',
      '版管理リポジトリが初期化されていません。',
    );
  }
  const resolved = resolveVersionRevision({
    rootDir: options.rootDir,
    projectName: options.projectName,
    revision: options.revision,
  });
  const commit = loadCommit(options, resolved.commitHash);
  const oldTree = parentTreeHash(options, commit);
  const semantic = buildSemanticDiff(options, oldTree, commit.tree);
  const tags = buildTagMap(options);
  return {
    hash: resolved.commitHash,
    shortHash: shortHash(resolved.commitHash),
    parents: [...commit.parents],
    parentCount: commit.parents.length,
    message: commit.message,
    author: { name: commit.author.name },
    committedAt: commit.committedAt,
    tags: tags.get(resolved.commitHash) ?? [],
    isMerge: commit.parents.length >= 2,
    ...semantic,
  };
}

/** from/to tree diff（browser-safe）。省略時は HEAD vs parent ではなく from/to 必須寄り。 */
export function getBrowserVersionRevisionDiff(options: {
  rootDir: string;
  projectName: string;
  from?: string;
  to?: string;
}): BrowserRevisionDetail {
  if (!isRepoInitialized(options.rootDir, options.projectName)) {
    throw createVersionControlError(
      'SPEC_VERSION_NOT_INITIALIZED',
      '版管理リポジトリが初期化されていません。',
    );
  }
  const toRev = resolveVersionRevision({
    ...options,
    revision: options.to ?? 'HEAD',
  });
  const toCommit = loadCommit(options, toRev.commitHash);
  let fromTree: string;
  if (options.from) {
    const fromRev = resolveVersionRevision({
      ...options,
      revision: options.from,
    });
    fromTree = loadCommit(options, fromRev.commitHash).tree;
  } else {
    fromTree = parentTreeHash(options, toCommit);
  }
  const semantic = buildSemanticDiff(options, fromTree, toCommit.tree);
  const tags = buildTagMap(options);
  return {
    hash: toRev.commitHash,
    shortHash: shortHash(toRev.commitHash),
    parents: [...toCommit.parents],
    parentCount: toCommit.parents.length,
    message: toCommit.message,
    author: { name: toCommit.author.name },
    committedAt: toCommit.committedAt,
    tags: tags.get(toRev.commitHash) ?? [],
    isMerge: toCommit.parents.length >= 2,
    ...semantic,
  };
}

export function listBrowserVersionBranches(options: {
  rootDir: string;
  projectName: string;
}): Array<{ name: string; commitHash: string | null; current: boolean; unborn: boolean }> {
  if (!isRepoInitialized(options.rootDir, options.projectName)) {
    return [];
  }
  return listVersionBranches(options).map((b) => ({
    name: b.name,
    commitHash: b.commitHash,
    current: b.current,
    unborn: b.unborn,
  }));
}

export function listBrowserVersionTags(options: {
  rootDir: string;
  projectName: string;
}): Array<{ name: string; targetCommitHash: string }> {
  if (!isRepoInitialized(options.rootDir, options.projectName)) {
    return [];
  }
  return listVersionTags(options).map((t) => ({
    name: t.name,
    targetCommitHash: t.targetCommitHash,
  }));
}
