import fs from 'node:fs';
import path from 'node:path';
import { createVersionControlError } from './errors.js';
import { assertNoMergeInProgress } from './merge-gates.js';
import {
  readVersionHead,
  writeVersionHeadDetached,
  writeVersionHeadSymbolic,
} from './head.js';
import {
  buildMaterializePlan,
  writeMaterializePlanToDirectory,
} from './materialize-snapshot.js';
import { withMutationLock } from './mutation-lock.js';
import { resolveVersionRevision } from './revision-resolver.js';
import { createWorkingSnapshot } from './snapshot.js';
import { getVersionStatus } from './status.js';
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

export type CheckoutTransactionAdapters = {
  writeTransactionJournal?: typeof writeTransactionJournal;
  updateTransactionPhase?: typeof updateTransactionPhase;
  writeVersionIndex?: typeof writeVersionIndex;
  removeTransactionArtifacts?: typeof removeTransactionArtifacts;
  renamePath?: typeof renamePath;
  removeDerived?: (
    rootDir: string,
    relativePaths: string[],
  ) => { ok: boolean };
};

export type CheckoutVersionOptions = {
  rootDir: string;
  projectName: string;
  target: string;
  adapters?: CheckoutTransactionAdapters;
};

export type CheckoutVersionResult = {
  commitHash: string;
  treeHash: string;
  headKind: 'symbolic' | 'detached';
  headRef: string | null;
  noop: boolean;
};

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

function removeDerivedBestEffort(
  rootDir: string,
  relativePaths: string[],
): { ok: boolean } {
  try {
    for (const relative of relativePaths) {
      const abs = path.join(rootDir, ...relative.split('/'));
      if (!fs.existsSync(abs)) continue;
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) {
        throw createVersionControlError(
          'SPEC_VERSION_SYMLINK_NOT_ALLOWED',
          'シンボリックリンクは許可されていません。',
        );
      }
      fs.rmSync(abs, { recursive: true, force: true });
    }
    return { ok: true };
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      String((error as { code: string }).code).startsWith('SPEC_VERSION_')
    ) {
      throw error;
    }
    return { ok: false };
  }
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

/**
 * revision を working source へ checkout する。
 * ref/HEAD update を commit point とする。
 */
export function checkoutVersion(
  options: CheckoutVersionOptions,
): CheckoutVersionResult {
  return withMutationLock(options, 'checkout', () =>
    withIndexLock(options, () => {
      assertNoIncompleteTransaction(options);
      assertNoMergeInProgress(options);

      const status = getVersionStatus(options);
      if (!status.clean) {
        throw createVersionControlError(
          'SPEC_VERSION_WORKING_TREE_DIRTY',
          'staged または unstaged の変更があるため checkout できません。',
        );
      }

      const resolved = resolveVersionRevision({
        rootDir: options.rootDir,
        projectName: options.projectName,
        revision: options.target,
      });
      const head = readVersionHead(options);
      const index = readVersionIndex(options);

      const wantSymbolic =
        resolved.kind === 'branch' && resolved.refName
          ? (`refs/heads/${resolved.refName}` as const)
          : null;

      // same target（mode+ref+commit）のみ no-op
      if (
        !head.unborn &&
        head.commit === resolved.commitHash &&
        ((wantSymbolic && head.ref === wantSymbolic) ||
          (!wantSymbolic && head.ref === null))
      ) {
        return {
          commitHash: resolved.commitHash,
          treeHash: resolved.treeHash,
          headKind: wantSymbolic ? 'symbolic' : 'detached',
          headRef: wantSymbolic,
          noop: true,
        };
      }

      const oldTree = status.workingTree;
      const sourceNeedsSwap = oldTree !== resolved.treeHash;
      const operationId = createOperationId();
      const nextRoot = transactionNextRoot(
        options.rootDir,
        options.projectName,
        operationId,
      );
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

      const newHead = wantSymbolic
        ? {
            mode: 'symbolic' as const,
            ref: wantSymbolic,
            commit: resolved.commitHash,
          }
        : {
            mode: 'detached' as const,
            ref: null,
            commit: resolved.commitHash,
          };

      let journal: VersionTransactionJournal = {
        schemaVersion: '1.0',
        operationId,
        operation: 'checkout',
        phase: 'prepared',
        oldHead: headSnapshotFromVersionHead(head),
        newHead,
        oldIndex: {
          exists: !index.virtual,
          revision: index.revision,
          baseCommit: index.baseCommit,
          tree: index.tree,
        },
        newIndex: {
          baseCommit: resolved.commitHash,
          tree: resolved.treeHash,
        },
        oldTree,
        newTree: resolved.treeHash,
        sourceSwap: sourceNeedsSwap,
      };

      const derivedPaths = [
        `spec/${options.projectName}/src/resources/manifest.json`,
        `spec/${options.projectName}/dist`,
      ];
      const adapters = options.adapters ?? {};
      const writeJournal =
        adapters.writeTransactionJournal ?? writeTransactionJournal;
      const updatePhase =
        adapters.updateTransactionPhase ?? updateTransactionPhase;
      const writeIndex = adapters.writeVersionIndex ?? writeVersionIndex;
      const removeArtifacts =
        adapters.removeTransactionArtifacts ?? removeTransactionArtifacts;
      const doRename = adapters.renamePath ?? renamePath;
      const removeDerived = adapters.removeDerived ?? removeDerivedBestEffort;

      try {
        if (sourceNeedsSwap) {
          const plan = buildMaterializePlan({
            rootDir: options.rootDir,
            projectName: options.projectName,
            treeHash: resolved.treeHash,
          });
          fs.mkdirSync(nextRoot, { recursive: true });
          writeMaterializePlanToDirectory({
            rootDir: options.rootDir,
            destinationRoot: nextRoot,
            plan,
          });
        }

        writeJournal({ ...options, journal });

        if (sourceNeedsSwap) {
          const specSrc = projectSpecSrc(options.rootDir, options.projectName);
          const pages = projectPages(options.rootDir, options.projectName);
          fs.mkdirSync(path.dirname(backupSpec), { recursive: true });
          if (fs.existsSync(specSrc)) doRename(specSrc, backupSpec);
          if (fs.existsSync(pages)) doRename(pages, backupPages);
          journal = updatePhase({
            ...options,
            journal,
            phase: 'source_backed_up',
          });

          installFromNext(options.rootDir, options.projectName, nextRoot);
          const installed = workingTreeHash(options);
          if (installed !== resolved.treeHash) {
            throw createVersionControlError(
              'SPEC_VERSION_CHECKOUT_FAILED',
              'installed source の snapshot hash が target tree と一致しません。',
            );
          }
          journal = updatePhase({
            ...options,
            journal,
            phase: 'source_installed',
          });
        }

        // commit point: HEAD/ref
        if (wantSymbolic && resolved.refName) {
          writeVersionHeadSymbolic({
            rootDir: options.rootDir,
            projectName: options.projectName,
            name: resolved.refName,
          });
        } else {
          writeVersionHeadDetached({
            rootDir: options.rootDir,
            projectName: options.projectName,
            hash: resolved.commitHash,
          });
        }
        journal = updatePhase({
          ...options,
          journal,
          phase: 'ref_updated',
        });

        try {
          writeIndex({
            rootDir: options.rootDir,
            projectName: options.projectName,
            index: {
              schemaVersion: '1.0',
              baseCommit: resolved.commitHash,
              tree: resolved.treeHash,
            },
            alreadyLocked: true,
          });
        } catch {
          throw createVersionControlError(
            'SPEC_VERSION_RECOVERY_REQUIRED',
            'checkout の ref 更新後に index 更新が失敗しました。recovery が必要です。',
          );
        }
        journal = updatePhase({
          ...options,
          journal,
          phase: 'index_reset',
        });

        const derived = removeDerived(options.rootDir, derivedPaths);
        if (!derived.ok) {
          journal = updatePhase({
            ...options,
            journal,
            phase: 'cleanup_pending',
          });
          throw createVersionControlError(
            'SPEC_VERSION_RECOVERY_REQUIRED',
            'checkout は完了しましたが derived 出力の整理に失敗しました。',
          );
        }

        journal = updatePhase({
          ...options,
          journal,
          phase: 'cleanup_pending',
        });
        removeArtifacts({ ...options, operationId });

        return {
          commitHash: resolved.commitHash,
          treeHash: resolved.treeHash,
          headKind: wantSymbolic ? 'symbolic' : 'detached',
          headRef: wantSymbolic,
          noop: false,
        };
      } catch (error) {
        const code =
          error instanceof Error && 'code' in error
            ? String((error as { code: string }).code)
            : '';
        if (code === 'SPEC_VERSION_RECOVERY_REQUIRED') {
          throw error;
        }

        // commit point 前: source を backup から戻す
        try {
          const current = readVersionHead(options);
          const refIsNew =
            current.commit === resolved.commitHash &&
            ((wantSymbolic && current.ref === wantSymbolic) ||
              (!wantSymbolic && current.ref === null));
          if (!refIsNew && sourceNeedsSwap) {
            const specSrc = projectSpecSrc(
              options.rootDir,
              options.projectName,
            );
            const pages = projectPages(options.rootDir, options.projectName);
            if (fs.existsSync(backupSpec) && !fs.existsSync(specSrc)) {
              doRename(backupSpec, specSrc);
            } else if (fs.existsSync(backupSpec) && fs.existsSync(specSrc)) {
              // installed new を捨てて backup を戻す
              fs.rmSync(specSrc, { recursive: true, force: true });
              doRename(backupSpec, specSrc);
            }
            if (fs.existsSync(backupPages) && !fs.existsSync(pages)) {
              doRename(backupPages, pages);
            } else if (fs.existsSync(backupPages) && fs.existsSync(pages)) {
              fs.rmSync(pages, { recursive: true, force: true });
              doRename(backupPages, pages);
            }
            removeArtifacts({ ...options, operationId });
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
          'checkout に失敗しました。',
        );
      }
    }),
  );
}
