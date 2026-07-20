import fs from 'node:fs';
import path from 'node:path';
import { resolveVersionAuthor } from './author-config.js';
import { createVersionControlError } from './errors.js';
import { assertNoMergeInProgress } from './merge-gates.js';
import { readVersionHead } from './head.js';
import {
  buildMaterializePlan,
  writeMaterializePlanToDirectory,
} from './materialize-snapshot.js';
import { withMutationLock } from './mutation-lock.js';
import { readVersionObject, writeVersionObject } from './object-store.js';
import { compareAndSwapVersionRef } from './refs.js';
import { resolveVersionRevision } from './revision-resolver.js';
import { createWorkingSnapshot } from './snapshot.js';
import { flattenVersionTree, getVersionStatus } from './status.js';
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
import { persistTreeFromFlatBlobs } from './tree-builder.js';
import type { CommitObject, VersionPerson } from './types.js';
import { assertCommitObject } from './validate-object.js';
import {
  readVersionIndex,
  withIndexLock,
  writeVersionIndex,
} from './version-index.js';

export type RevertTransactionAdapters = {
  writeTransactionJournal?: typeof writeTransactionJournal;
  updateTransactionPhase?: typeof updateTransactionPhase;
  writeVersionIndex?: typeof writeVersionIndex;
  compareAndSwapVersionRef?: typeof compareAndSwapVersionRef;
  removeTransactionArtifacts?: typeof removeTransactionArtifacts;
};

export type RevertVersionOptions = {
  rootDir: string;
  projectName: string;
  target: string;
  message?: string;
  author?: VersionPerson;
  expectedHead?: string | null;
  committedAt?: string;
  adapters?: RevertTransactionAdapters;
};

export type RevertVersionResult = {
  commitHash: string;
  treeHash: string;
  revertedCommit: string;
  conflicts: string[];
  noop: boolean;
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

function firstLine(message: string): string {
  const line = message.split(/\r?\n/, 1)[0] ?? message;
  return line.trim() || message.trim();
}

function projectSpecSrc(rootDir: string, projectName: string): string {
  return path.join(rootDir, 'spec', projectName, 'src');
}

function projectPages(rootDir: string, projectName: string): string {
  return path.join(rootDir, 'src', projectName, 'pages');
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

/**
 * 指定 commit の逆変更を新しい commit として記録する。
 * commit object を先に永続化し、source swap の commit point は branch ref CAS。
 */
export function revertVersionCommit(
  options: RevertVersionOptions,
): RevertVersionResult {
  return withMutationLock(options, 'revert', () =>
    withIndexLock(options, () => {
      assertNoIncompleteTransaction(options);
      assertNoMergeInProgress(options);

      const status = getVersionStatus(options);
      if (!status.clean) {
        throw createVersionControlError(
          'SPEC_VERSION_WORKING_TREE_DIRTY',
          'working tree が dirty なため revert できません。',
        );
      }

      const head = readVersionHead(options);
      if (head.unborn || !head.commit || !head.tree || !head.ref) {
        throw createVersionControlError(
          'SPEC_VERSION_REVERT_UNSUPPORTED',
          'symbolic branch 上でのみ revert できます。',
        );
      }
      if (
        options.expectedHead !== undefined &&
        head.commit !== options.expectedHead
      ) {
        throw createVersionControlError(
          'SPEC_VERSION_HEAD_CHANGED',
          'HEAD が期待した状態から変更されています。',
        );
      }

      const target = resolveVersionRevision({
        rootDir: options.rootDir,
        projectName: options.projectName,
        revision: options.target,
      });
      const targetCommit = loadCommit(options, target.commitHash);
      if (targetCommit.parents.length !== 1) {
        throw createVersionControlError(
          'SPEC_VERSION_REVERT_UNSUPPORTED',
          'parent が 1 つの commit のみ revert できます。',
        );
      }
      const parentHash = targetCommit.parents[0];
      if (!parentHash) {
        throw createVersionControlError(
          'SPEC_VERSION_REVERT_UNSUPPORTED',
          'parent が 1 つの commit のみ revert できます。',
        );
      }
      const parentCommit = loadCommit(options, parentHash);

      const parentFiles = flattenVersionTree(options, parentCommit.tree);
      const targetFiles = flattenVersionTree(options, targetCommit.tree);
      const headFiles = flattenVersionTree(options, head.tree);

      const paths = new Set([
        ...parentFiles.keys(),
        ...targetFiles.keys(),
      ]);
      const next = new Map(headFiles);
      const conflicts: string[] = [];
      let changed = false;

      for (const logical of [...paths].sort()) {
        const parent = parentFiles.get(logical);
        const tgt = targetFiles.get(logical);
        if (parent?.hash === tgt?.hash) continue;
        const current = headFiles.get(logical);
        if (
          (parent && current?.hash === parent.hash) ||
          (!parent && !current)
        ) {
          continue;
        }
        if ((tgt && current?.hash === tgt.hash) || (!tgt && !current)) {
          if (parent) next.set(logical, parent);
          else next.delete(logical);
          changed = true;
          continue;
        }
        conflicts.push(logical);
      }

      if (conflicts.length > 0) {
        throw createVersionControlError(
          'SPEC_VERSION_REVERT_CONFLICT',
          `revert が衝突しました: ${conflicts.slice(0, 20).join(', ')}`,
        );
      }

      if (!changed) {
        return {
          commitHash: head.commit,
          treeHash: head.tree,
          revertedCommit: target.commitHash,
          conflicts: [],
          noop: true,
        };
      }

      const blobMap = new Map<string, string>();
      for (const [logical, entry] of next) {
        blobMap.set(logical, entry.hash);
      }
      const newTree = persistTreeFromFlatBlobs({
        rootDir: options.rootDir,
        projectName: options.projectName,
        files: blobMap,
      });

      const author = resolveVersionAuthor({
        rootDir: options.rootDir,
        projectName: options.projectName,
        author: options.author,
      });
      const message =
        options.message ??
        `Revert "${firstLine(targetCommit.message)}"\n\n` +
          `This reverts Screen Spec commit ${target.commitHash}.`;
      const committedAt = options.committedAt ?? new Date().toISOString();
      const commitPayload: CommitObject = {
        formatVersion: '1.0',
        tree: newTree,
        parents: [head.commit],
        author,
        committer: author,
        committedAt,
        message,
      };
      assertCommitObject(commitPayload);

      const commitHash = writeVersionObject({
        rootDir: options.rootDir,
        projectName: options.projectName,
        type: 'commit',
        payload: commitPayload,
      }).hash;

      const index = readVersionIndex(options);
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

      const plan = buildMaterializePlan({
        rootDir: options.rootDir,
        projectName: options.projectName,
        treeHash: newTree,
      });
      fs.mkdirSync(nextRoot, { recursive: true });
      writeMaterializePlanToDirectory({
        rootDir: options.rootDir,
        destinationRoot: nextRoot,
        plan,
      });

      let journal: VersionTransactionJournal = {
        schemaVersion: '1.0',
        operationId,
        operation: 'revert',
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
        newIndex: { baseCommit: commitHash, tree: newTree },
        oldTree: head.tree,
        newTree,
        sourceSwap: true,
      };

      const adapters = options.adapters ?? {};
      const writeJournal =
        adapters.writeTransactionJournal ?? writeTransactionJournal;
      const updatePhase =
        adapters.updateTransactionPhase ?? updateTransactionPhase;
      const writeIndex = adapters.writeVersionIndex ?? writeVersionIndex;
      const casRef =
        adapters.compareAndSwapVersionRef ?? compareAndSwapVersionRef;
      const removeArtifacts =
        adapters.removeTransactionArtifacts ?? removeTransactionArtifacts;

      try {
        writeJournal({ ...options, journal });

        const specSrc = projectSpecSrc(options.rootDir, options.projectName);
        const pages = projectPages(options.rootDir, options.projectName);
        fs.mkdirSync(path.dirname(backupSpec), { recursive: true });
        if (fs.existsSync(specSrc)) renamePath(specSrc, backupSpec);
        if (fs.existsSync(pages)) renamePath(pages, backupPages);
        journal = updatePhase({
          ...options,
          journal,
          phase: 'source_backed_up',
        });

        const workSpec = path.join(
          nextRoot,
          'spec',
          options.projectName,
          'src',
        );
        const workPages = path.join(
          nextRoot,
          'src',
          options.projectName,
          'pages',
        );
        if (fs.existsSync(workSpec)) {
          if (fs.existsSync(specSrc)) {
            fs.rmSync(specSrc, { recursive: true, force: true });
          }
          renamePath(workSpec, specSrc);
        }
        if (fs.existsSync(workPages)) {
          fs.mkdirSync(path.dirname(pages), { recursive: true });
          if (fs.existsSync(pages)) {
            fs.rmSync(pages, { recursive: true, force: true });
          }
          renamePath(workPages, pages);
        }

        const installed = createWorkingSnapshot(options).rootTreeHash;
        if (installed !== newTree) {
          throw createVersionControlError(
            'SPEC_VERSION_CHECKOUT_FAILED',
            'revert source の snapshot hash が一致しません。',
          );
        }
        journal = updatePhase({
          ...options,
          journal,
          phase: 'source_installed',
        });

        const branchName = head.ref.slice('refs/heads/'.length);
        try {
          casRef({
            rootDir: options.rootDir,
            projectName: options.projectName,
            kind: 'heads',
            name: branchName,
            expectedOldHash: head.commit,
            newHash: commitHash,
          });
        } catch (refError) {
          // commit point 前: source を rollback
          if (fs.existsSync(specSrc)) {
            fs.rmSync(specSrc, { recursive: true, force: true });
          }
          if (fs.existsSync(backupSpec)) renamePath(backupSpec, specSrc);
          if (fs.existsSync(pages)) {
            fs.rmSync(pages, { recursive: true, force: true });
          }
          if (fs.existsSync(backupPages)) renamePath(backupPages, pages);
          removeArtifacts({ ...options, operationId });
          throw refError;
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
              baseCommit: commitHash,
              tree: newTree,
            },
            alreadyLocked: true,
          });
        } catch {
          throw createVersionControlError(
            'SPEC_VERSION_RECOVERY_REQUIRED',
            'revert の ref 更新後に index 更新が失敗しました。recovery が必要です。',
          );
        }
        journal = updatePhase({
          ...options,
          journal,
          phase: 'index_reset',
        });

        if (!removeDerivedBestEffort(options.rootDir, options.projectName)) {
          journal = updatePhase({
            ...options,
            journal,
            phase: 'cleanup_pending',
          });
          throw createVersionControlError(
            'SPEC_VERSION_RECOVERY_REQUIRED',
            'revert は完了しましたが derived 出力の整理に失敗しました。',
          );
        }

        journal = updatePhase({
          ...options,
          journal,
          phase: 'cleanup_pending',
        });
        removeArtifacts({ ...options, operationId });

        return {
          commitHash,
          treeHash: newTree,
          revertedCommit: target.commitHash,
          conflicts: [],
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
        if (
          error instanceof Error &&
          'code' in error &&
          String((error as { code: string }).code).startsWith('SPEC_VERSION_')
        ) {
          throw error;
        }
        throw createVersionControlError(
          'SPEC_VERSION_CHECKOUT_FAILED',
          'revert に失敗しました。',
        );
      }
    }),
  );
}
