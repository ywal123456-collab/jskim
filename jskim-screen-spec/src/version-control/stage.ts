import { loadScreenFeatures } from '../features/load-features.js';
import { canonicalizeJsonBytes } from './canonical-json.js';
import { createVersionControlError } from './errors.js';
import { encodeVersionObject } from './object-format.js';
import { writeVersionObject, readVersionObject } from './object-store.js';
import {
  assertVersionProjectDocument,
  compareScreenIdOrder,
  mergeScreenOrderForStage,
  type VersionProjectDocument,
} from './project-document.js';
import {
  createWorkingSnapshot,
  persistSnapshotObjects,
  type WorkingSnapshot,
} from './snapshot.js';
import { flattenSnapshotTree, flattenVersionTree } from './status.js';
import { readVersionHead } from './head.js';
import { assertNoIncompleteTransaction } from './transaction.js';
import {
  readVersionIndex,
  withIndexLock,
  writeVersionIndex,
  type ReadVersionIndexResult,
  type VersionIndex,
} from './version-index.js';
import type { TreeObject } from './types.js';

export type StageResult = {
  status: 'created' | 'updated' | 'unchanged';
  indexRevision: string;
  treeHash: string;
  baseCommit: string | null;
  featuresJsonFullyStaged?: boolean;
};

type FlatEntry = { hash: string; type: 'blob' | 'tree' };

function compareName(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function writeTreeFromFiles(
  options: { rootDir: string; projectName: string },
  files: Map<string, FlatEntry>,
): string {
  type Node = { files: Map<string, FlatEntry>; dirs: Map<string, Node> };
  const root: Node = { files: new Map(), dirs: new Map() };
  for (const logical of [...files.keys()].sort(compareName)) {
    const value = files.get(logical);
    if (!value) continue;
    let node = root;
    const names = logical.split('/');
    for (const name of names.slice(0, -1)) {
      let child = node.dirs.get(name);
      if (!child) {
        child = { files: new Map(), dirs: new Map() };
        node.dirs.set(name, child);
      }
      node = child;
    }
    const leaf = names[names.length - 1];
    if (!leaf) {
      throw createVersionControlError(
        'SPEC_VERSION_LOGICAL_PATH_CONFLICT',
        '論理 path が不正です。',
      );
    }
    node.files.set(leaf, value);
  }

  const visit = (node: Node): string => {
    const entries: TreeObject['entries'] = [];
    for (const name of [...node.files.keys()].sort(compareName)) {
      const entry = node.files.get(name);
      if (!entry) continue;
      entries.push({
        name,
        objectType: 'blob',
        hash: entry.hash,
      });
    }
    for (const name of [...node.dirs.keys()].sort(compareName)) {
      const child = node.dirs.get(name);
      if (!child) continue;
      entries.push({
        name,
        objectType: 'tree',
        hash: visit(child),
      });
    }
    entries.sort((a, b) => compareName(a.name, b.name));
    const tree: TreeObject = { formatVersion: '1.0', entries };
    encodeVersionObject('tree', tree);
    return writeVersionObject({
      ...options,
      type: 'tree',
      payload: tree,
    }).hash;
  };
  return visit(root);
}

function toStageStatus(
  before: ReadVersionIndexResult,
  after: ReadVersionIndexResult,
): StageResult['status'] {
  if (before.virtual && !after.virtual) {
    return 'created';
  }
  if (before.revision === after.revision && before.tree === after.tree) {
    return 'unchanged';
  }
  return 'updated';
}

function readProjectDocumentFromTree(
  options: { rootDir: string; projectName: string },
  treeHash: string,
  knownScreenIds: readonly string[],
): VersionProjectDocument | null {
  const flat = flattenVersionTree(options, treeHash);
  const entry = flat.get('project.json');
  if (!entry) {
    return null;
  }
  const obj = readVersionObject({
    ...options,
    hash: entry.hash,
    expectedType: 'blob',
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(obj.payload.toString('utf8'));
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_INDEX_CORRUPT',
      'index の project.json が不正です。',
    );
  }
  return assertVersionProjectDocument(parsed, { knownScreenIds });
}

function runStage(
  options: {
    rootDir: string;
    projectName: string;
    expectedIndexRevision?: string;
    expectedHead?: string | null;
  },
  select: (logicalPath: string, working: WorkingSnapshot) => boolean,
  extras?: {
    featuresJsonFullyStaged?: boolean;
    /** select 適用後に強制上書きする path（working 全量 stage を避ける） */
    overlays?: Map<string, FlatEntry>;
  },
): StageResult {
  return withIndexLock(options, () => {
    assertNoIncompleteTransaction(options);

    const indexBefore = readVersionIndex(options);
    const head = readVersionHead(options);

    if (
      options.expectedIndexRevision != null &&
      options.expectedIndexRevision !== indexBefore.revision
    ) {
      throw createVersionControlError(
        'SPEC_VERSION_INDEX_CONFLICT',
        'index revision が一致しません。',
      );
    }
    if (
      options.expectedHead !== undefined &&
      options.expectedHead !== head.commit
    ) {
      throw createVersionControlError(
        'SPEC_VERSION_HEAD_CHANGED',
        'HEAD が変更されています。',
      );
    }
    // index.baseCommit と現 HEAD が異なる場合は既定で拒否（force なし）
    if (indexBefore.baseCommit !== head.commit) {
      throw createVersionControlError(
        'SPEC_VERSION_HEAD_CHANGED',
        'HEAD が index の baseCommit 以降に変更されています。index を更新してから再実行してください。',
      );
    }

    const snapshot = createWorkingSnapshot(options);
    persistSnapshotObjects({ ...options, snapshot });

    const working = flattenSnapshotTree(snapshot);
    const base = flattenVersionTree(options, indexBefore.tree);
    const next = new Map<string, FlatEntry>();
    for (const [p, entry] of base) {
      next.set(p, entry);
    }

    const allPaths = new Set([...base.keys(), ...working.keys()]);
    for (const logicalPath of allPaths) {
      if (!select(logicalPath, snapshot)) {
        continue;
      }
      const w = working.get(logicalPath);
      if (w) {
        next.set(logicalPath, w);
      } else {
        next.delete(logicalPath);
      }
    }

    if (extras?.overlays) {
      for (const [p, entry] of extras.overlays) {
        next.set(p, entry);
      }
    }

    const treeHash = writeTreeFromFiles(options, next);
    const indexDoc: VersionIndex = {
      schemaVersion: '1.0',
      baseCommit: head.commit,
      tree: treeHash,
    };

    if (
      !indexBefore.virtual &&
      indexBefore.tree === treeHash &&
      indexBefore.baseCommit === head.commit
    ) {
      return {
        status: 'unchanged',
        indexRevision: indexBefore.revision,
        treeHash,
        baseCommit: head.commit,
        featuresJsonFullyStaged: extras?.featuresJsonFullyStaged,
      };
    }

    const written = writeVersionIndex({
      ...options,
      index: indexDoc,
      alreadyLocked: true,
    });
    return {
      status: toStageStatus(indexBefore, written),
      indexRevision: written.revision,
      treeHash: written.tree,
      baseCommit: written.baseCommit,
      featuresJsonFullyStaged: extras?.featuresJsonFullyStaged,
    };
  });
}

export function stageProject(options: {
  rootDir: string;
  projectName: string;
  expectedIndexRevision?: string;
  expectedHead?: string | null;
}): StageResult {
  return runStage(options, () => true, { featuresJsonFullyStaged: true });
}

/**
 * 選択 screen の logical subtree と、それに伴う project.json.screenOrder のみを反映する。
 * features.json は自動 stage しない。
 *
 * 契約:
 * - 内容変更: screen subtree のみ（screenOrder 不変なら project.json も実質不変）
 * - 新規/削除/当該 screen の順序変更: screenOrder を semantic merge（他 screen 相対順は index 維持）
 * - working project.json 全体の無条件 stage は行わない
 * - 順序のみの大規模再配置は stageProject を推奨
 */
export function stageScreen(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
  expectedIndexRevision?: string;
  expectedHead?: string | null;
}): StageResult {
  return withIndexLock(options, () => {
    assertNoIncompleteTransaction(options);
    // lock 内で再実行するため、外側の二重 lock を避ける alreadyLocked 経路へ委譲
    const indexBefore = readVersionIndex(options);
    const head = readVersionHead(options);

    if (
      options.expectedIndexRevision != null &&
      options.expectedIndexRevision !== indexBefore.revision
    ) {
      throw createVersionControlError(
        'SPEC_VERSION_INDEX_CONFLICT',
        'index revision が一致しません。',
      );
    }
    if (
      options.expectedHead !== undefined &&
      options.expectedHead !== head.commit
    ) {
      throw createVersionControlError(
        'SPEC_VERSION_HEAD_CHANGED',
        'HEAD が変更されています。',
      );
    }
    if (indexBefore.baseCommit !== head.commit) {
      throw createVersionControlError(
        'SPEC_VERSION_HEAD_CHANGED',
        'HEAD が index の baseCommit 以降に変更されています。index を更新してから再実行してください。',
      );
    }

    const snapshot = createWorkingSnapshot(options);
    const inWorking = snapshot.screens.includes(options.screenId);
    const indexed = flattenVersionTree(options, indexBefore.tree);
    const inIndex = [...indexed.keys()].some((p) =>
      p.startsWith(`screens/${options.screenId}/`),
    );

    if (!inWorking && !inIndex) {
      throw createVersionControlError(
        'SPEC_VERSION_SCREEN_NOT_FOUND',
        '指定された screen が見つかりません。',
      );
    }

    if (!inWorking) {
      const features = loadScreenFeatures({
        ...options,
        knownScreenIds: snapshot.screens,
      });
      if (
        features.features.some((f) => f.screenIds.includes(options.screenId))
      ) {
        throw createVersionControlError(
          'SPEC_VERSION_SNAPSHOT_INVALID',
          'features.json に残っている画面は stageScreen で削除できません。先に stageFeature または stageProject を実行してください。',
        );
      }
    }

    persistSnapshotObjects({ ...options, snapshot });
    const working = flattenSnapshotTree(snapshot);
    const base = flattenVersionTree(options, indexBefore.tree);
    const next = new Map<string, FlatEntry>();
    for (const [p, entry] of base) {
      next.set(p, entry);
    }

    const prefix = `screens/${options.screenId}/`;
    const allPaths = new Set([...base.keys(), ...working.keys()]);
    for (const logicalPath of allPaths) {
      if (!logicalPath.startsWith(prefix)) {
        continue;
      }
      const w = working.get(logicalPath);
      if (w) {
        next.set(logicalPath, w);
      } else {
        next.delete(logicalPath);
      }
    }

    // index / working の screen 集合から screenOrder を merge
    const indexScreenIds = [
      ...new Set(
        [...base.keys()]
          .map((p) => /^screens\/([^/]+)\//.exec(p)?.[1])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const workingDoc = assertVersionProjectDocument(
      JSON.parse(
        (() => {
          const h = working.get('project.json')?.hash;
          if (!h) {
            throw createVersionControlError(
              'SPEC_VERSION_SNAPSHOT_INVALID',
              'working project.json がありません。',
            );
          }
          const obj = snapshot.objects.get(h);
          if (!obj) {
            throw createVersionControlError(
              'SPEC_VERSION_SNAPSHOT_INVALID',
              'working project.json がありません。',
            );
          }
          const nul = obj.encoded.indexOf(0);
          return obj.encoded.subarray(nul + 1).toString('utf8');
        })(),
      ) as unknown,
      {
        knownScreenIds: snapshot.screens,
        expectedProjectName: options.projectName,
      },
    );

    let indexOrder = [...indexScreenIds].sort(compareScreenIdOrder);
    const indexProjectEntry = indexed.get('project.json');
    if (indexProjectEntry) {
      const indexProject = readProjectDocumentFromTree(
        options,
        indexBefore.tree,
        indexScreenIds,
      );
      if (indexProject) {
        indexOrder = indexProject.screenOrder;
      }
    }

    const mergedOrder = mergeScreenOrderForStage({
      indexOrder,
      workingOrder: workingDoc.screenOrder,
      screenId: options.screenId,
      screenInWorking: inWorking,
    });

    // 最終 tree の screen 集合と screenOrder を一致させる
    const nextScreenIds = [
      ...new Set(
        [...next.keys()]
          .map((p) => /^screens\/([^/]+)\//.exec(p)?.[1])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const finalDoc = assertVersionProjectDocument(
      {
        schemaVersion: '1.0',
        projectName: options.projectName,
        screenOrder: mergedOrder,
      },
      { knownScreenIds: nextScreenIds, expectedProjectName: options.projectName },
    );

    const projectBytes = canonicalizeJsonBytes(finalDoc);
    const projectWrite = writeVersionObject({
      ...options,
      type: 'blob',
      payload: projectBytes,
    });
    next.set('project.json', { hash: projectWrite.hash, type: 'blob' });

    const treeHash = writeTreeFromFiles(options, next);
    const indexDoc: VersionIndex = {
      schemaVersion: '1.0',
      baseCommit: head.commit,
      tree: treeHash,
    };

    if (
      !indexBefore.virtual &&
      indexBefore.tree === treeHash &&
      indexBefore.baseCommit === head.commit
    ) {
      return {
        status: 'unchanged',
        indexRevision: indexBefore.revision,
        treeHash,
        baseCommit: head.commit,
      };
    }

    const written = writeVersionIndex({
      ...options,
      index: indexDoc,
      alreadyLocked: true,
    });
    return {
      status: toStageStatus(indexBefore, written),
      indexRevision: written.revision,
      treeHash: written.tree,
      baseCommit: written.baseCommit,
    };
  });
}

/**
 * Feature stage。
 * - featureId 指定: working features.json 全体 + 当該 feature 所属 screen subtree
 * - featureId 省略/null: features.json のみ
 * project.json.screenOrder は変更しない（全 Screen 一覧は維持）。
 */
export function stageFeature(options: {
  rootDir: string;
  projectName: string;
  featureId?: string | null;
  expectedIndexRevision?: string;
  expectedHead?: string | null;
}): StageResult {
  if (options.featureId == null) {
    return runStage(options, (p) => p === 'features.json', {
      featuresJsonFullyStaged: true,
    });
  }

  const snapshot = createWorkingSnapshot(options);
  const features = loadScreenFeatures({
    ...options,
    knownScreenIds: snapshot.screens,
  });
  const feature = features.features.find(
    (item) => item.featureId === options.featureId,
  );
  if (!feature) {
    throw createVersionControlError(
      'SPEC_VERSION_FEATURE_NOT_FOUND',
      'feature が見つかりません。',
    );
  }
  const ids = new Set(feature.screenIds);
  return runStage(
    options,
    (logicalPath) =>
      logicalPath === 'features.json' ||
      [...ids].some((id) => logicalPath.startsWith(`screens/${id}/`)),
    { featuresJsonFullyStaged: true },
  );
}
