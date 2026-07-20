import fs from 'node:fs';
import path from 'node:path';
import { resolveVersionAuthor } from './author-config.js';
import { createVersionControlError } from './errors.js';
import { readVersionHead } from './head.js';
import {
  buildMaterializePlan,
  writeMaterializePlanToDirectory,
} from './materialize-snapshot.js';
import { findMergeBase } from './merge-base.js';
import type { MergeConflict } from './merge-conflict.js';
import {
  assertMergeCanStart,
  assertMergeInProgress,
} from './merge-gates.js';
import {
  readVersionMergeState,
  removeVersionMergeState,
  writeVersionMergeState,
  type VersionMergeState,
} from './merge-state.js';
import {
  buildIndexTreeFiles,
  mergeLogicalTrees,
} from './merge-tree.js';
import { withMutationLock } from './mutation-lock.js';
import { writeVersionObject } from './object-store.js';
import { compareAndSwapVersionRef } from './refs.js';
import { resolveVersionRevision } from './revision-resolver.js';
import { createWorkingSnapshot } from './snapshot.js';
import { getVersionStatus } from './status.js';
import { persistTreeFromFlatBlobs } from './tree-builder.js';
import type { CommitObject, VersionPerson } from './types.js';
import { assertCommitObject } from './validate-object.js';
import {
  assertNoIncompleteTransaction,
  createOperationId,
  headSnapshotFromVersionHead,
  removeTransactionArtifacts,
  renamePath,
  transactionBackupPagesPath,
  transactionBackupSpecPath,
  transactionNextRoot,
  updateTransactionPhase,
  writeTransactionJournal,
  type VersionTransactionJournal,
} from './transaction.js';
import {
  readVersionIndex,
  withIndexLock,
  writeVersionIndex,
} from './version-index.js';

export type MergeVersionOptions = {
  rootDir: string;
  projectName: string;
  target: string;
  message?: string;
  author?: VersionPerson;
  committedAt?: string;
  expectedHead?: string | null;
  /** fault injection / test 用 transaction adapter */
  adapters?: MergeTransactionAdapters;
};

export type MergeVersionResult =
  | {
      outcome: 'already-up-to-date';
      commitHash: string;
      treeHash: string;
    }
  | {
      outcome: 'fast-forward';
      commitHash: string;
      treeHash: string;
    }
  | {
      outcome: 'merged';
      commitHash: string;
      treeHash: string;
      parents: string[];
    }
  | {
      outcome: 'conflicts';
      conflicts: MergeConflict[];
      mergeState: VersionMergeState;
    };

export type InspectMergeVersionResult = {
  inProgress: boolean;
  mergeState: VersionMergeState | null;
  unresolvedConflicts: MergeConflict[];
  resolvedConflicts: MergeConflict[];
};

export type ContinueMergeVersionOptions = {
  rootDir: string;
  projectName: string;
  message?: string;
  author?: VersionPerson;
  committedAt?: string;
  expectedHead?: string | null;
  /** fault injection / test 用 transaction adapter */
  adapters?: MergeTransactionAdapters;
};

export type AbortMergeVersionOptions = {
  rootDir: string;
  projectName: string;
  expectedHead?: string | null;
  /** fault injection / test 用 transaction adapter */
  adapters?: MergeTransactionAdapters;
};

export type MergeTransactionAdapters = {
  writeTransactionJournal?: typeof writeTransactionJournal;
  updateTransactionPhase?: typeof updateTransactionPhase;
  writeVersionIndex?: typeof writeVersionIndex;
  writeVersionMergeState?: typeof writeVersionMergeState;
  removeVersionMergeState?: typeof removeVersionMergeState;
  removeTransactionArtifacts?: typeof removeTransactionArtifacts;
  compareAndSwapVersionRef?: typeof compareAndSwapVersionRef;
};

function resolveMergeAdapters(
  adapters?: MergeTransactionAdapters,
): Required<MergeTransactionAdapters> {
  return {
    writeTransactionJournal:
      adapters?.writeTransactionJournal ?? writeTransactionJournal,
    updateTransactionPhase:
      adapters?.updateTransactionPhase ?? updateTransactionPhase,
    writeVersionIndex: adapters?.writeVersionIndex ?? writeVersionIndex,
    writeVersionMergeState:
      adapters?.writeVersionMergeState ?? writeVersionMergeState,
    removeVersionMergeState:
      adapters?.removeVersionMergeState ?? removeVersionMergeState,
    removeTransactionArtifacts:
      adapters?.removeTransactionArtifacts ?? removeTransactionArtifacts,
    compareAndSwapVersionRef:
      adapters?.compareAndSwapVersionRef ?? compareAndSwapVersionRef,
  };
}

function projectSpecSrc(rootDir: string, projectName: string): string {
  return path.join(rootDir, 'spec', projectName, 'src');
}

function projectPages(rootDir: string, projectName: string): string {
  return path.join(rootDir, 'src', projectName, 'pages');
}

function workingTreeHash(options: {
  rootDir: string;
  projectName: string;
}): string {
  return createWorkingSnapshot(options).rootTreeHash;
}

function branchNameFromRef(ref: string | null): string | null {
  if (!ref || !ref.startsWith('refs/heads/')) return null;
  return ref.slice('refs/heads/'.length);
}

function defaultMergeMessage(
  projectName: string,
  branchName: string,
  targetRevision: string,
): string {
  return `Merge ${targetRevision} into ${branchName}`;
}

function installFromNext(
  rootDir: string,
  projectName: string,
  nextRoot: string,
): void {
  const workSpec = path.join(nextRoot, 'spec', projectName, 'src');
  const workPages = path.join(nextRoot, 'src', projectName, 'pages');
  const destSpec = projectSpecSrc(rootDir, projectName);
  const destPages = projectPages(rootDir, projectName);
  fs.mkdirSync(path.dirname(destSpec), { recursive: true });
  fs.mkdirSync(path.dirname(destPages), { recursive: true });
  if (fs.existsSync(workSpec)) {
    if (fs.existsSync(destSpec)) {
      fs.rmSync(destSpec, { recursive: true, force: true });
    }
    renamePath(workSpec, destSpec);
  }
  if (fs.existsSync(workPages)) {
    if (fs.existsSync(destPages)) {
      fs.rmSync(destPages, { recursive: true, force: true });
    }
    renamePath(workPages, destPages);
  }
}

function removeDerivedBestEffort(
  rootDir: string,
  projectName: string,
): boolean {
  const paths = [
    path.join(rootDir, 'spec', projectName, 'src', 'resources', 'manifest.json'),
    path.join(rootDir, 'spec', projectName, 'dist'),
  ];
  try {
    for (const abs of paths) {
      if (!fs.existsSync(abs)) continue;
      fs.rmSync(abs, { recursive: true, force: true });
    }
    return true;
  } catch {
    return false;
  }
}

function rollbackInstalledSourceFromBackup(options: {
  rootDir: string;
  projectName: string;
  operationId: string;
  expectedInstalledTree: string;
}): void {
  const backupSpec = transactionBackupSpecPath(
    options.rootDir,
    options.projectName,
    options.operationId,
  );
  const backupPages = transactionBackupPagesPath(
    options.rootDir,
    options.projectName,
    options.operationId,
  );
  const specSrc = projectSpecSrc(options.rootDir, options.projectName);
  const pages = projectPages(options.rootDir, options.projectName);
  const currentWorking = workingTreeHash(options);
  if (currentWorking !== options.expectedInstalledTree) {
    return;
  }
  if (fs.existsSync(backupSpec)) {
    if (fs.existsSync(specSrc)) {
      fs.rmSync(specSrc, { recursive: true, force: true });
    }
    renamePath(backupSpec, specSrc);
  }
  if (fs.existsSync(backupPages)) {
    if (fs.existsSync(pages)) {
      fs.rmSync(pages, { recursive: true, force: true });
    }
    renamePath(backupPages, pages);
  }
}

function restoreIndexFromJournalSnapshot(
  options: { rootDir: string; projectName: string },
  snapshot: VersionTransactionJournal['oldIndex'],
): void {
  if (!snapshot.exists || !snapshot.baseCommit || !snapshot.tree) {
    return;
  }
  writeVersionIndex({
    rootDir: options.rootDir,
    projectName: options.projectName,
    index: {
      schemaVersion: '1.0',
      baseCommit: snapshot.baseCommit,
      tree: snapshot.tree,
    },
    alreadyLocked: true,
  });
}

function materializeTreeToWorking(options: {
  rootDir: string;
  projectName: string;
  treeHash: string;
  operationId: string;
  journal: VersionTransactionJournal;
  oldTree: string;
}): VersionTransactionJournal {
  const nextRoot = transactionNextRoot(
    options.rootDir,
    options.projectName,
    options.operationId,
  );
  const backupSpec = transactionBackupSpecPath(
    options.rootDir,
    options.projectName,
    options.operationId,
  );
  const backupPages = transactionBackupPagesPath(
    options.rootDir,
    options.projectName,
    options.operationId,
  );

  const plan = buildMaterializePlan({
    rootDir: options.rootDir,
    projectName: options.projectName,
    treeHash: options.treeHash,
  });
  fs.mkdirSync(nextRoot, { recursive: true });
  writeMaterializePlanToDirectory({
    rootDir: options.rootDir,
    destinationRoot: nextRoot,
    plan,
  });

  const specSrc = projectSpecSrc(options.rootDir, options.projectName);
  const pages = projectPages(options.rootDir, options.projectName);
  fs.mkdirSync(path.dirname(backupSpec), { recursive: true });
  if (fs.existsSync(specSrc)) renamePath(specSrc, backupSpec);
  if (fs.existsSync(pages)) renamePath(pages, backupPages);

  let journal = updateTransactionPhase({
    rootDir: options.rootDir,
    projectName: options.projectName,
    journal: options.journal,
    phase: 'source_backed_up',
  });

  installFromNext(options.rootDir, options.projectName, nextRoot);
  const installed = workingTreeHash(options);
  if (installed !== options.treeHash) {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_FAILED',
      'merge source の snapshot hash が一致しません。',
    );
  }
  journal = updateTransactionPhase({
    rootDir: options.rootDir,
    projectName: options.projectName,
    journal,
    phase: 'source_installed',
  });
  return journal;
}

function flatMapToTreeHash(
  options: { rootDir: string; projectName: string },
  files: Map<string, { hash: string }>,
): string {
  const blobMap = new Map<string, string>();
  for (const [logical, entry] of files) {
    blobMap.set(logical, entry.hash);
  }
  return persistTreeFromFlatBlobs({
    ...options,
    files: blobMap,
  });
}

function assertAllConflictsResolved(state: VersionMergeState): void {
  const resolved = new Set(state.resolvedPaths);
  const unresolved = state.conflicts.filter((c) => !resolved.has(c.path));
  if (unresolved.length > 0) {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_UNRESOLVED',
      `未解決の merge conflict があります: ${unresolved
        .slice(0, 10)
        .map((c) => c.path)
        .join(', ')}`,
    );
  }
}

/**
 * merge state がある場合の 2-parent commit 完了処理。
 * continueMergeVersion / commitVersion から共有する。
 */
export function finishMergeCommit(options: {
  rootDir: string;
  projectName: string;
  message: string;
  author?: VersionPerson;
  committedAt?: string;
  expectedHead?: string | null;
  adapters?: MergeTransactionAdapters;
}): {
  commitHash: string;
  treeHash: string;
  parents: string[];
  message: string;
} {
  return withMutationLock(options, 'merge-continue', () =>
    withIndexLock(options, () => {
      assertNoIncompleteTransaction(options);
      const mergeState = assertMergeInProgress(options);
      assertAllConflictsResolved(mergeState);
      const adapters = resolveMergeAdapters(options.adapters);

      const head = readVersionHead(options);
      if (head.unborn || !head.commit || !head.ref) {
        throw createVersionControlError(
          'SPEC_VERSION_MERGE_DETACHED_HEAD',
          'detached HEAD では merge を完了できません。',
        );
      }
      if (head.commit !== mergeState.ours) {
        throw createVersionControlError(
          'SPEC_VERSION_MERGE_HEAD_CHANGED',
          'merge 開始後に HEAD が変更されました。',
        );
      }
      if (
        options.expectedHead !== undefined &&
        options.expectedHead !== head.commit
      ) {
        throw createVersionControlError(
          'SPEC_VERSION_MERGE_HEAD_CHANGED',
          'HEAD が期待した状態から変更されています。',
        );
      }

      const index = readVersionIndex(options);
      if (index.baseCommit !== head.commit) {
        throw createVersionControlError(
          'SPEC_VERSION_HEAD_CHANGED',
          'index の baseCommit が HEAD と一致しません。',
        );
      }

      const author = resolveVersionAuthor({
        rootDir: options.rootDir,
        projectName: options.projectName,
        author: options.author,
      });
      const committedAt = options.committedAt ?? new Date().toISOString();
      const parents = [mergeState.ours, mergeState.theirs];
      const payload: CommitObject = {
        formatVersion: '1.0',
        tree: index.tree,
        parents,
        author,
        committer: author,
        committedAt,
        message: options.message,
      };
      assertCommitObject(payload);

      const commitHash = writeVersionObject({
        rootDir: options.rootDir,
        projectName: options.projectName,
        type: 'commit',
        payload,
      }).hash;

      const branchName = branchNameFromRef(head.ref);
      if (!branchName) {
        throw createVersionControlError(
          'SPEC_VERSION_HEAD_CORRUPT',
          'HEAD の branch 参照が不正です。',
        );
      }

      const operationId = createOperationId();
      let journal: VersionTransactionJournal = {
        schemaVersion: '1.0',
        operationId,
        operation: 'merge-continue',
        phase: 'prepared',
        oldHead: headSnapshotFromVersionHead(head),
        newHead: {
          mode: 'symbolic',
          ref: head.ref,
          commit: commitHash,
        },
        oldIndex: {
          exists: !index.virtual,
          revision: index.revision,
          baseCommit: index.baseCommit,
          tree: index.tree,
        },
        newIndex: { baseCommit: commitHash, tree: index.tree },
        oldTree: head.tree,
        newTree: index.tree,
        sourceSwap: false,
      };

      try {
        adapters.writeTransactionJournal({
          rootDir: options.rootDir,
          projectName: options.projectName,
          journal,
        });

        adapters.compareAndSwapVersionRef({
          rootDir: options.rootDir,
          projectName: options.projectName,
          kind: 'heads',
          name: branchName,
          expectedOldHash: head.commit,
          newHash: commitHash,
        });
        journal = adapters.updateTransactionPhase({
          rootDir: options.rootDir,
          projectName: options.projectName,
          journal,
          phase: 'ref_updated',
        });

        try {
          adapters.writeVersionIndex({
            rootDir: options.rootDir,
            projectName: options.projectName,
            index: {
              schemaVersion: '1.0',
              baseCommit: commitHash,
              tree: index.tree,
            },
            alreadyLocked: true,
          });
        } catch {
          throw createVersionControlError(
            'SPEC_VERSION_RECOVERY_REQUIRED',
            'merge commit の ref 更新後に index 更新が失敗しました。recovery が必要です。',
          );
        }
        journal = adapters.updateTransactionPhase({
          rootDir: options.rootDir,
          projectName: options.projectName,
          journal,
          phase: 'index_reset',
        });

        adapters.removeVersionMergeState(options);
        journal = adapters.updateTransactionPhase({
          rootDir: options.rootDir,
          projectName: options.projectName,
          journal,
          phase: 'cleanup_pending',
        });
        adapters.removeTransactionArtifacts({
          rootDir: options.rootDir,
          projectName: options.projectName,
          operationId,
        });

        return {
          commitHash,
          treeHash: index.tree,
          parents,
          message: options.message,
        };
      } catch (error) {
        const code =
          error instanceof Error && 'code' in error
            ? String((error as { code: string }).code)
            : '';
        if (code === 'SPEC_VERSION_RECOVERY_REQUIRED') {
          throw error;
        }
        try {
          const current = readVersionHead(options);
          if (current.commit !== commitHash) {
            removeTransactionArtifacts({
              rootDir: options.rootDir,
              projectName: options.projectName,
              operationId,
            });
          }
        } catch {
          // journal 残置
        }
        if (
          error instanceof Error &&
          'code' in error &&
          String((error as { code: string }).code).startsWith('SPEC_VERSION_')
        ) {
          throw error;
        }
        throw createVersionControlError(
          'SPEC_VERSION_COMMIT_FAILED',
          'merge commit に失敗しました。',
        );
      }
    }),
  );
}

function performFastForwardMerge(options: {
  rootDir: string;
  projectName: string;
  head: ReturnType<typeof readVersionHead>;
  targetCommit: string;
  targetTree: string;
  branchName: string;
}): MergeVersionResult {
  const operationId = createOperationId();
  const index = readVersionIndex(options);
  const oldTree = options.head.tree!;
  const sourceNeedsSwap = oldTree !== options.targetTree;

  let journal: VersionTransactionJournal = {
    schemaVersion: '1.0',
    operationId,
    operation: 'merge',
    phase: 'prepared',
    oldHead: headSnapshotFromVersionHead(options.head),
    newHead: {
      mode: 'symbolic',
      ref: options.head.ref,
      commit: options.targetCommit,
    },
    oldIndex: {
      exists: !index.virtual,
      revision: index.revision,
      baseCommit: index.baseCommit,
      tree: index.tree,
    },
    newIndex: {
      baseCommit: options.targetCommit,
      tree: options.targetTree,
    },
    oldTree,
    newTree: options.targetTree,
    sourceSwap: sourceNeedsSwap,
  };

  try {
    writeTransactionJournal({
      rootDir: options.rootDir,
      projectName: options.projectName,
      journal,
    });

    if (sourceNeedsSwap) {
      journal = materializeTreeToWorking({
        rootDir: options.rootDir,
        projectName: options.projectName,
        treeHash: options.targetTree,
        operationId,
        journal,
        oldTree,
      });
    }

    compareAndSwapVersionRef({
      rootDir: options.rootDir,
      projectName: options.projectName,
      kind: 'heads',
      name: options.branchName,
      expectedOldHash: options.head.commit!,
      newHash: options.targetCommit,
    });
    journal = updateTransactionPhase({
      rootDir: options.rootDir,
      projectName: options.projectName,
      journal,
      phase: 'ref_updated',
    });

    try {
      writeVersionIndex({
        rootDir: options.rootDir,
        projectName: options.projectName,
        index: {
          schemaVersion: '1.0',
          baseCommit: options.targetCommit,
          tree: options.targetTree,
        },
        alreadyLocked: true,
      });
    } catch {
      throw createVersionControlError(
        'SPEC_VERSION_RECOVERY_REQUIRED',
        'fast-forward merge の ref 更新後に index 更新が失敗しました。recovery が必要です。',
      );
    }
    journal = updateTransactionPhase({
      rootDir: options.rootDir,
      projectName: options.projectName,
      journal,
      phase: 'index_reset',
    });

    if (!removeDerivedBestEffort(options.rootDir, options.projectName)) {
      journal = updateTransactionPhase({
        rootDir: options.rootDir,
        projectName: options.projectName,
        journal,
        phase: 'cleanup_pending',
      });
      throw createVersionControlError(
        'SPEC_VERSION_RECOVERY_REQUIRED',
        'fast-forward merge は完了しましたが derived 出力の整理に失敗しました。',
      );
    }

    journal = updateTransactionPhase({
      rootDir: options.rootDir,
      projectName: options.projectName,
      journal,
      phase: 'cleanup_pending',
    });
    removeTransactionArtifacts({
      rootDir: options.rootDir,
      projectName: options.projectName,
      operationId,
    });

    return {
      outcome: 'fast-forward',
      commitHash: options.targetCommit,
      treeHash: options.targetTree,
    };
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error
        ? String((error as { code: string }).code)
        : '';
    if (code === 'SPEC_VERSION_RECOVERY_REQUIRED') {
      throw error;
    }
    try {
      const backupSpec = transactionBackupSpecPath(
        options.rootDir,
        options.projectName,
        operationId,
      );
      const backupPages = transactionBackupPagesPath(
        options.rootDir,
        options.projectName,
        operationId,
      );
      const specSrc = projectSpecSrc(options.rootDir, options.projectName);
      const pages = projectPages(options.rootDir, options.projectName);
      const current = readVersionHead(options);
      if (
        current.commit !== options.targetCommit &&
        sourceNeedsSwap
      ) {
        if (fs.existsSync(backupSpec) && !fs.existsSync(specSrc)) {
          renamePath(backupSpec, specSrc);
        } else if (fs.existsSync(backupSpec) && fs.existsSync(specSrc)) {
          fs.rmSync(specSrc, { recursive: true, force: true });
          renamePath(backupSpec, specSrc);
        }
        if (fs.existsSync(backupPages) && !fs.existsSync(pages)) {
          renamePath(backupPages, pages);
        } else if (fs.existsSync(backupPages) && fs.existsSync(pages)) {
          fs.rmSync(pages, { recursive: true, force: true });
          renamePath(backupPages, pages);
        }
        removeTransactionArtifacts({
          rootDir: options.rootDir,
          projectName: options.projectName,
          operationId,
        });
      }
    } catch {
      // recovery へ
    }
    if (
      error instanceof Error &&
      'code' in error &&
      String((error as { code: string }).code).startsWith('SPEC_VERSION_')
    ) {
      throw error;
    }
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_FAILED',
      'fast-forward merge に失敗しました。',
    );
  }
}

/**
 * target revision を現在 branch へ merge する。
 */
export function mergeVersion(
  options: MergeVersionOptions,
): MergeVersionResult {
  return withMutationLock(options, 'merge', () =>
    withIndexLock(options, () => {
      assertMergeCanStart(options);

      const head = readVersionHead(options);
      if (
        options.expectedHead !== undefined &&
        options.expectedHead !== head.commit
      ) {
        throw createVersionControlError(
          'SPEC_VERSION_MERGE_HEAD_CHANGED',
          'HEAD が期待した状態から変更されています。',
        );
      }

      const resolved = resolveVersionRevision({
        rootDir: options.rootDir,
        projectName: options.projectName,
        revision: options.target,
      });
      const branchName = branchNameFromRef(head.ref);
      if (!branchName || !head.commit || !head.tree) {
        throw createVersionControlError(
          'SPEC_VERSION_MERGE_DETACHED_HEAD',
          'detached HEAD では merge できません。',
        );
      }

      const analysis = findMergeBase({
        rootDir: options.rootDir,
        projectName: options.projectName,
        currentCommit: head.commit,
        targetCommit: resolved.commitHash,
      });

      if (analysis.kind === 'already-up-to-date') {
        return {
          outcome: 'already-up-to-date',
          commitHash: head.commit,
          treeHash: head.tree,
        };
      }

      if (analysis.kind === 'fast-forward') {
        return performFastForwardMerge({
          rootDir: options.rootDir,
          projectName: options.projectName,
          head,
          targetCommit: resolved.commitHash,
          targetTree: resolved.treeHash,
          branchName,
        });
      }

      const mergeResult = mergeLogicalTrees({
        rootDir: options.rootDir,
        projectName: options.projectName,
        baseTree: analysis.baseTree,
        oursTree: analysis.oursTree,
        theirsTree: analysis.theirsTree,
      });

      const defaultMessage =
        options.message ??
        defaultMergeMessage(
          options.projectName,
          branchName,
          options.target,
        );

      if (mergeResult.conflicts.length === 0) {
        const indexFiles = buildIndexTreeFiles({
          rootDir: options.rootDir,
          projectName: options.projectName,
          oursTree: analysis.oursTree,
          mergeResult,
        });
        const mergedTree = flatMapToTreeHash(
          options,
          indexFiles,
        );

        const author = resolveVersionAuthor({
          rootDir: options.rootDir,
          projectName: options.projectName,
          author: options.author,
        });
        const committedAt = options.committedAt ?? new Date().toISOString();
        const parents = [analysis.ours, analysis.theirs];
        const payload: CommitObject = {
          formatVersion: '1.0',
          tree: mergedTree,
          parents,
          author,
          committer: author,
          committedAt,
          message: defaultMessage,
        };
        assertCommitObject(payload);
        const commitHash = writeVersionObject({
          rootDir: options.rootDir,
          projectName: options.projectName,
          type: 'commit',
          payload,
        }).hash;

        const index = readVersionIndex(options);
        const operationId = createOperationId();
        let journal: VersionTransactionJournal = {
          schemaVersion: '1.0',
          operationId,
          operation: 'merge',
          phase: 'prepared',
          oldHead: headSnapshotFromVersionHead(head),
          newHead: {
            mode: 'symbolic',
            ref: head.ref,
            commit: commitHash,
          },
          oldIndex: {
            exists: !index.virtual,
            revision: index.revision,
            baseCommit: index.baseCommit,
            tree: index.tree,
          },
          newIndex: { baseCommit: commitHash, tree: mergedTree },
          oldTree: head.tree,
          newTree: mergedTree,
          sourceSwap: head.tree !== mergedTree,
        };

        try {
          writeTransactionJournal({
            rootDir: options.rootDir,
            projectName: options.projectName,
            journal,
          });

          if (journal.sourceSwap) {
            journal = materializeTreeToWorking({
              rootDir: options.rootDir,
              projectName: options.projectName,
              treeHash: mergedTree,
              operationId,
              journal,
              oldTree: head.tree,
            });
          }

          compareAndSwapVersionRef({
            rootDir: options.rootDir,
            projectName: options.projectName,
            kind: 'heads',
            name: branchName,
            expectedOldHash: head.commit,
            newHash: commitHash,
          });
          journal = updateTransactionPhase({
            rootDir: options.rootDir,
            projectName: options.projectName,
            journal,
            phase: 'ref_updated',
          });

          try {
            writeVersionIndex({
              rootDir: options.rootDir,
              projectName: options.projectName,
              index: {
                schemaVersion: '1.0',
                baseCommit: commitHash,
                tree: mergedTree,
              },
              alreadyLocked: true,
            });
          } catch {
            throw createVersionControlError(
              'SPEC_VERSION_RECOVERY_REQUIRED',
              'merge commit の ref 更新後に index 更新が失敗しました。recovery が必要です。',
            );
          }
          journal = updateTransactionPhase({
            rootDir: options.rootDir,
            projectName: options.projectName,
            journal,
            phase: 'index_reset',
          });

          if (!removeDerivedBestEffort(options.rootDir, options.projectName)) {
            journal = updateTransactionPhase({
              rootDir: options.rootDir,
              projectName: options.projectName,
              journal,
              phase: 'cleanup_pending',
            });
            throw createVersionControlError(
              'SPEC_VERSION_RECOVERY_REQUIRED',
              'merge は完了しましたが derived 出力の整理に失敗しました。',
            );
          }

          journal = updateTransactionPhase({
            rootDir: options.rootDir,
            projectName: options.projectName,
            journal,
            phase: 'cleanup_pending',
          });
          removeTransactionArtifacts({
            rootDir: options.rootDir,
            projectName: options.projectName,
            operationId,
          });

          return {
            outcome: 'merged',
            commitHash,
            treeHash: mergedTree,
            parents,
          };
        } catch (error) {
          const code =
            error instanceof Error && 'code' in error
              ? String((error as { code: string }).code)
              : '';
          if (code === 'SPEC_VERSION_RECOVERY_REQUIRED') {
            throw error;
          }
          if (
            error instanceof Error &&
            'code' in error &&
            String((error as { code: string }).code).startsWith(
              'SPEC_VERSION_',
            )
          ) {
            throw error;
          }
          throw createVersionControlError(
            'SPEC_VERSION_COMMIT_FAILED',
            'clean merge に失敗しました。',
          );
        }
      }

      const mergeIndexFiles = buildIndexTreeFiles({
        rootDir: options.rootDir,
        projectName: options.projectName,
        oursTree: analysis.oursTree,
        mergeResult,
      });
      const mergeIndexTree = flatMapToTreeHash(options, mergeIndexFiles);
      const workingTree = mergeIndexTree;

      const operationId = createOperationId();
      const index = readVersionIndex(options);
      const adapters = resolveMergeAdapters(options.adapters);
      let journal: VersionTransactionJournal = {
        schemaVersion: '1.0',
        operationId,
        operation: 'merge',
        phase: 'prepared',
        oldHead: headSnapshotFromVersionHead(head),
        newHead: {
          mode: 'symbolic',
          ref: head.ref,
          commit: head.commit,
        },
        oldIndex: {
          exists: !index.virtual,
          revision: index.revision,
          baseCommit: index.baseCommit,
          tree: index.tree,
        },
        newIndex: {
          baseCommit: head.commit,
          tree: mergeIndexTree,
        },
        oldTree: head.tree,
        newTree: workingTree,
        sourceSwap: head.tree !== workingTree,
      };

      adapters.writeTransactionJournal({
        rootDir: options.rootDir,
        projectName: options.projectName,
        journal,
      });

      try {
        if (journal.sourceSwap) {
          journal = materializeTreeToWorking({
            rootDir: options.rootDir,
            projectName: options.projectName,
            treeHash: workingTree,
            operationId,
            journal,
            oldTree: head.tree,
          });
        }

        let mergeIndexRevision: string;
        try {
          const writtenIndex = adapters.writeVersionIndex({
            rootDir: options.rootDir,
            projectName: options.projectName,
            index: {
              schemaVersion: '1.0',
              baseCommit: head.commit,
              tree: mergeIndexTree,
            },
            alreadyLocked: true,
          });
          mergeIndexRevision = writtenIndex.revision;
          journal = adapters.updateTransactionPhase({
            rootDir: options.rootDir,
            projectName: options.projectName,
            journal,
            phase: 'index_reset',
          });
        } catch {
          rollbackInstalledSourceFromBackup({
            rootDir: options.rootDir,
            projectName: options.projectName,
            operationId,
            expectedInstalledTree: workingTree,
          });
          adapters.removeTransactionArtifacts({
            rootDir: options.rootDir,
            projectName: options.projectName,
            operationId,
          });
          throw createVersionControlError(
            'SPEC_VERSION_COMMIT_FAILED',
            'merge conflict setup の index 更新に失敗しました。',
          );
        }

        const mergeState: VersionMergeState = {
          schemaVersion: '1.0',
          ours: analysis.ours,
          theirs: analysis.theirs,
          base: analysis.base,
          targetRevision: options.target,
          currentBranch: branchName,
          defaultMessage,
          conflicts: mergeResult.conflicts,
          resolvedPaths: [],
          startedAt: new Date().toISOString(),
          workingTreeHash: workingTree,
          mergeIndexTree,
          mergeIndexRevision,
        };

        try {
          adapters.writeVersionMergeState({
            rootDir: options.rootDir,
            projectName: options.projectName,
            state: mergeState,
          });
        } catch {
          restoreIndexFromJournalSnapshot(options, journal.oldIndex);
          rollbackInstalledSourceFromBackup({
            rootDir: options.rootDir,
            projectName: options.projectName,
            operationId,
            expectedInstalledTree: workingTree,
          });
          adapters.removeTransactionArtifacts({
            rootDir: options.rootDir,
            projectName: options.projectName,
            operationId,
          });
          throw createVersionControlError(
            'SPEC_VERSION_COMMIT_FAILED',
            'merge conflict setup の MERGE_STATE 書き込みに失敗しました。',
          );
        }

        journal = adapters.updateTransactionPhase({
          rootDir: options.rootDir,
          projectName: options.projectName,
          journal,
          phase: 'cleanup_pending',
        });
        try {
          adapters.removeTransactionArtifacts({
            rootDir: options.rootDir,
            projectName: options.projectName,
            operationId,
          });
        } catch {
          throw createVersionControlError(
            'SPEC_VERSION_RECOVERY_REQUIRED',
            'merge conflict setup の journal cleanup に失敗しました。recovery が必要です。',
          );
        }

        return {
          outcome: 'conflicts',
          conflicts: mergeResult.conflicts,
          mergeState,
        };
      } catch (error) {
        const code =
          error instanceof Error && 'code' in error
            ? String((error as { code: string }).code)
            : '';
        if (
          error instanceof Error &&
          'code' in error &&
          String((error as { code: string }).code).startsWith('SPEC_VERSION_')
        ) {
          throw error;
        }
        if (code !== 'SPEC_VERSION_COMMIT_FAILED') {
          try {
            restoreIndexFromJournalSnapshot(options, journal.oldIndex);
            rollbackInstalledSourceFromBackup({
              rootDir: options.rootDir,
              projectName: options.projectName,
              operationId,
              expectedInstalledTree: workingTree,
            });
            removeTransactionArtifacts({
              rootDir: options.rootDir,
              projectName: options.projectName,
              operationId,
            });
          } catch {
            // recovery へ
          }
        }
        throw createVersionControlError(
          'SPEC_VERSION_COMMIT_FAILED',
          'merge conflict setup に失敗しました。',
        );
      }
    }),
  );
}

export function inspectMergeVersion(options: {
  rootDir: string;
  projectName: string;
}): InspectMergeVersionResult {
  const mergeState = readVersionMergeState(options);
  if (!mergeState) {
    return {
      inProgress: false,
      mergeState: null,
      unresolvedConflicts: [],
      resolvedConflicts: [],
    };
  }
  const resolved = new Set(mergeState.resolvedPaths);
  const unresolvedConflicts = mergeState.conflicts.filter(
    (c) => !resolved.has(c.path),
  );
  const resolvedConflicts = mergeState.conflicts.filter((c) =>
    resolved.has(c.path),
  );
  return {
    inProgress: true,
    mergeState,
    unresolvedConflicts,
    resolvedConflicts,
  };
}

export function continueMergeVersion(
  options: ContinueMergeVersionOptions,
): {
  commitHash: string;
  treeHash: string;
  parents: string[];
  message: string;
} {
  const mergeState = readVersionMergeState(options);
  const message =
    options.message ?? mergeState?.defaultMessage ?? 'Merge commit';
  return finishMergeCommit({ ...options, message, adapters: options.adapters });
}

export function abortMergeVersion(
  options: AbortMergeVersionOptions,
): { restoredTree: string } {
  return withMutationLock(options, 'merge-abort', () =>
    withIndexLock(options, () => {
      assertNoIncompleteTransaction(options);
      const mergeState = assertMergeInProgress(options);
      const head = readVersionHead(options);

      if (
        options.expectedHead !== undefined &&
        options.expectedHead !== head.commit
      ) {
        throw createVersionControlError(
          'SPEC_VERSION_MERGE_HEAD_CHANGED',
          'HEAD が期待した状態から変更されています。',
        );
      }
      if (head.commit !== mergeState.ours) {
        throw createVersionControlError(
          'SPEC_VERSION_MERGE_HEAD_CHANGED',
          'merge 開始後に HEAD が変更されました。',
        );
      }

      const currentWorking = workingTreeHash(options);
      if (currentWorking !== mergeState.workingTreeHash) {
        throw createVersionControlError(
          'SPEC_VERSION_MERGE_ABORT_UNSAFE',
          'working tree が merge 開始時と異なるため abort できません。',
        );
      }

      const index = readVersionIndex(options);
      if (index.baseCommit !== head.commit) {
        throw createVersionControlError(
          'SPEC_VERSION_MERGE_ABORT_UNSAFE',
          'index の baseCommit が ours HEAD と一致しないため abort できません。',
        );
      }
      if (!head.tree) {
        throw createVersionControlError(
          'SPEC_VERSION_MERGE_ABORT_UNSAFE',
          'ours tree が取得できないため abort できません。',
        );
      }

      const operationId = createOperationId();
      const adapters = resolveMergeAdapters(options.adapters);
      let journal: VersionTransactionJournal = {
        schemaVersion: '1.0',
        operationId,
        operation: 'merge-abort',
        phase: 'prepared',
        oldHead: headSnapshotFromVersionHead(head),
        newHead: headSnapshotFromVersionHead(head),
        oldIndex: {
          exists: !index.virtual,
          revision: index.revision,
          baseCommit: index.baseCommit,
          tree: index.tree,
        },
        newIndex: {
          baseCommit: head.commit,
          tree: head.tree,
        },
        oldTree: currentWorking,
        newTree: head.tree,
        sourceSwap: currentWorking !== head.tree,
      };

      adapters.writeTransactionJournal({
        rootDir: options.rootDir,
        projectName: options.projectName,
        journal,
      });

      try {
        if (journal.sourceSwap) {
          journal = materializeTreeToWorking({
            rootDir: options.rootDir,
            projectName: options.projectName,
            treeHash: head.tree,
            operationId,
            journal,
            oldTree: currentWorking,
          });
        }

        adapters.writeVersionIndex({
          rootDir: options.rootDir,
          projectName: options.projectName,
          index: {
            schemaVersion: '1.0',
            baseCommit: head.commit,
            tree: head.tree,
          },
          alreadyLocked: true,
        });
        journal = adapters.updateTransactionPhase({
          rootDir: options.rootDir,
          projectName: options.projectName,
          journal,
          phase: 'index_reset',
        });

        adapters.removeVersionMergeState(options);
        journal = adapters.updateTransactionPhase({
          rootDir: options.rootDir,
          projectName: options.projectName,
          journal,
          phase: 'cleanup_pending',
        });
        adapters.removeTransactionArtifacts({
          rootDir: options.rootDir,
          projectName: options.projectName,
          operationId,
        });
      } catch (error) {
        const code =
          error instanceof Error && 'code' in error
            ? String((error as { code: string }).code)
            : '';
        if (
          error instanceof Error &&
          'code' in error &&
          String((error as { code: string }).code).startsWith('SPEC_VERSION_')
        ) {
          throw error;
        }
        throw createVersionControlError(
          'SPEC_VERSION_RECOVERY_REQUIRED',
          'merge abort に失敗しました。recovery が必要です。',
        );
      }

      if (!removeDerivedBestEffort(options.rootDir, options.projectName)) {
        throw createVersionControlError(
          'SPEC_VERSION_RECOVERY_REQUIRED',
          'merge abort は完了しましたが derived 出力の整理に失敗しました。',
        );
      }

      return { restoredTree: head.tree };
    }),
  );
}

/** stage 後: conflict path が staged されたら resolvedPaths を更新する。 */
export function updateMergeResolvedPathsAfterStage(options: {
  rootDir: string;
  projectName: string;
  stagedPaths: readonly string[];
}): void {
  const state = readVersionMergeState(options);
  if (!state) return;

  const conflictPaths = new Set(state.conflicts.map((c) => c.path));
  const resolved = new Set(state.resolvedPaths);
  let changed = false;
  for (const p of options.stagedPaths) {
    if (conflictPaths.has(p) && !resolved.has(p)) {
      resolved.add(p);
      changed = true;
    }
  }
  if (!changed) return;

  writeVersionMergeState({
    ...options,
    state: {
      ...state,
      resolvedPaths: [...resolved].sort(),
    },
  });
}

/** commit-version 用: merge state が存在し全 conflict 解決済みか。 */
export function isMergeReadyToCommit(options: {
  rootDir: string;
  projectName: string;
}): VersionMergeState | null {
  const state = readVersionMergeState(options);
  if (!state) return null;
  const resolved = new Set(state.resolvedPaths);
  const allResolved = state.conflicts.every((c) => resolved.has(c.path));
  return allResolved ? state : null;
}
