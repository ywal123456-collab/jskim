import { MAX_COMMIT_MESSAGE_LENGTH } from './constants.js';
import { resolveVersionAuthor } from './author-config.js';
import { createVersionControlError } from './errors.js';
import {
  assertHeadMatchesExpected,
  readVersionHead,
  writeVersionHeadDetached,
} from './head.js';
import { withMutationLock } from './mutation-lock.js';
import { writeVersionObject } from './object-store.js';
import { compareAndSwapVersionRef } from './refs.js';
import { diffVersionTrees } from './status.js';
import {
  assertNoIncompleteTransaction,
  createOperationId,
  headSnapshotFromVersionHead,
  removeTransactionArtifacts,
  updateTransactionPhase,
  writeTransactionJournal,
  type VersionTransactionJournal,
} from './transaction.js';
import type { CommitObject, VersionPerson } from './types.js';
import { assertCommitObject } from './validate-object.js';
import {
  computeIndexRevision,
  readVersionIndex,
  withIndexLock,
  writeVersionIndex,
} from './version-index.js';

export type CommitTransactionAdapters = {
  writeTransactionJournal?: typeof writeTransactionJournal;
  updateTransactionPhase?: typeof updateTransactionPhase;
  writeVersionIndex?: typeof writeVersionIndex;
  compareAndSwapVersionRef?: typeof compareAndSwapVersionRef;
  writeVersionHeadDetached?: typeof writeVersionHeadDetached;
  removeTransactionArtifacts?: typeof removeTransactionArtifacts;
};

export type CommitVersionOptions = {
  rootDir: string;
  projectName: string;
  message: string;
  author?: VersionPerson;
  committedAt?: string;
  expectedHead?: string | null;
  expectedIndexRevision?: string;
  /** fault injection / test 用 filesystem・書き込み adapter */
  adapters?: CommitTransactionAdapters;
};

export type CommitVersionResult = {
  commitHash: string;
  treeHash: string;
  parents: string[];
  message: string;
  author: VersionPerson;
  committedAt: string;
  headRef: string | null;
  detached: boolean;
};

const ISO_UTC_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function assertCommitMessage(message: string): string {
  if (
    typeof message !== 'string' ||
    message.trim() === '' ||
    message.length > MAX_COMMIT_MESSAGE_LENGTH ||
    message.includes('\0')
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_COMMIT_MESSAGE_INVALID',
      'commit message が不正です。',
    );
  }
  return message;
}

function assertCommittedAt(value: string | undefined): string {
  const committedAt = value ?? new Date().toISOString();
  if (!ISO_UTC_RE.test(committedAt)) {
    throw createVersionControlError(
      'SPEC_VERSION_COMMIT_MESSAGE_INVALID',
      'committedAt は UTC ISO-8601 である必要があります。',
    );
  }
  const ms = Date.parse(committedAt);
  if (!Number.isFinite(ms)) {
    throw createVersionControlError(
      'SPEC_VERSION_COMMIT_MESSAGE_INVALID',
      'committedAt が不正な日時です。',
    );
  }
  const canonical = new Date(ms).toISOString();
  if (
    committedAt !== canonical &&
    committedAt !== canonical.replace('.000Z', 'Z')
  ) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(committedAt)) {
      throw createVersionControlError(
        'SPEC_VERSION_COMMIT_MESSAGE_INVALID',
        'committedAt の形式が不正です。',
      );
    }
  }
  return committedAt.includes('.')
    ? committedAt
    : new Date(ms).toISOString();
}

function branchNameFromRef(ref: string | null): string | null {
  if (!ref || !ref.startsWith('refs/heads/')) return null;
  return ref.slice('refs/heads/'.length);
}

/**
 * staged index tree を commit する。
 * ref/HEAD update を commit point とし、その後の index 失敗は journal を残して RECOVERY_REQUIRED。
 */
export function commitVersion(options: CommitVersionOptions): CommitVersionResult {
  return withMutationLock(options, 'commit', () =>
    withIndexLock(options, () => {
      assertNoIncompleteTransaction(options);

      const head = readVersionHead(options);
      const index = readVersionIndex(options);

      if (head.commit !== index.baseCommit) {
        throw createVersionControlError(
          'SPEC_VERSION_HEAD_CHANGED',
          'HEAD が index の base から変更されています。',
        );
      }
      assertHeadMatchesExpected(head, options.expectedHead);
      if (
        options.expectedIndexRevision !== undefined &&
        options.expectedIndexRevision !== index.revision
      ) {
        throw createVersionControlError(
          'SPEC_VERSION_INDEX_CONFLICT',
          'index が期待した revision から変更されています。',
        );
      }

      const staged = diffVersionTrees({
        rootDir: options.rootDir,
        projectName: options.projectName,
        oldTreeHash: head.tree,
        newTreeHash: index.tree,
      });
      if (staged.length === 0) {
        throw createVersionControlError(
          'SPEC_VERSION_NOTHING_TO_COMMIT',
          'commit する staged 変更がありません。',
        );
      }

      const message = assertCommitMessage(options.message);
      const author = resolveVersionAuthor({
        rootDir: options.rootDir,
        projectName: options.projectName,
        author: options.author,
      });
      const committedAt = assertCommittedAt(options.committedAt);
      const parents = head.unborn || !head.commit ? [] : [head.commit];
      const payload: CommitObject = {
        formatVersion: '1.0',
        tree: index.tree,
        parents,
        author,
        committer: author,
        committedAt,
        message,
      };
      assertCommitObject(payload);

      let commitHash: string;
      try {
        commitHash = writeVersionObject({
          rootDir: options.rootDir,
          projectName: options.projectName,
          type: 'commit',
          payload,
        }).hash;
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          String((error as { code: string }).code).startsWith('SPEC_VERSION_')
        ) {
          throw error;
        }
        throw createVersionControlError(
          'SPEC_VERSION_COMMIT_FAILED',
          'commit オブジェクトの書き込みに失敗しました。',
        );
      }

      const detached = head.ref === null;
      const branchName = branchNameFromRef(head.ref);
      const oldHead = headSnapshotFromVersionHead(head);
      const newHead = detached
        ? ({ mode: 'detached', ref: null, commit: commitHash } as const)
        : ({
            mode: head.unborn ? 'symbolic' : 'symbolic',
            ref: head.ref,
            commit: commitHash,
          } as const);

      const newIndex = {
        baseCommit: commitHash,
        tree: index.tree,
      };
      const operationId = createOperationId();
      let journal: VersionTransactionJournal = {
        schemaVersion: '1.0',
        operationId,
        operation: 'commit',
        phase: 'prepared',
        oldHead,
        newHead,
        oldIndex: {
          exists: !index.virtual,
          revision: index.revision,
          baseCommit: index.baseCommit,
          tree: index.tree,
        },
        newIndex,
        oldTree: head.tree,
        newTree: index.tree,
        sourceSwap: false,
      };

      const adapters = options.adapters ?? {};
      const writeJournal =
        adapters.writeTransactionJournal ?? writeTransactionJournal;
      const updatePhase =
        adapters.updateTransactionPhase ?? updateTransactionPhase;
      const writeIndex = adapters.writeVersionIndex ?? writeVersionIndex;
      const casRef =
        adapters.compareAndSwapVersionRef ?? compareAndSwapVersionRef;
      const writeDetached =
        adapters.writeVersionHeadDetached ?? writeVersionHeadDetached;
      const removeArtifacts =
        adapters.removeTransactionArtifacts ?? removeTransactionArtifacts;

      try {
        writeJournal({ ...options, journal });

        if (detached) {
          writeDetached({
            rootDir: options.rootDir,
            projectName: options.projectName,
            hash: commitHash,
          });
        } else if (branchName) {
          casRef({
            rootDir: options.rootDir,
            projectName: options.projectName,
            kind: 'heads',
            name: branchName,
            expectedOldHash: head.commit,
            newHash: commitHash,
          });
        } else {
          throw createVersionControlError(
            'SPEC_VERSION_HEAD_CORRUPT',
            'HEAD の branch 参照が不正です。',
          );
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
              baseCommit: newIndex.baseCommit,
              tree: newIndex.tree,
            },
            alreadyLocked: true,
          });
        } catch {
          // commit point 後: journal を残して recovery 必須
          throw createVersionControlError(
            'SPEC_VERSION_RECOVERY_REQUIRED',
            'commit の ref 更新後に index 更新が失敗しました。recovery が必要です。',
          );
        }

        journal = updatePhase({
          ...options,
          journal,
          phase: 'index_reset',
        });
        journal = updatePhase({
          ...options,
          journal,
          phase: 'cleanup_pending',
        });
        removeArtifacts({
          ...options,
          operationId,
        });

        return {
          commitHash,
          treeHash: index.tree,
          parents,
          message,
          author,
          committedAt,
          headRef: head.ref,
          detached,
        };
      } catch (error) {
        // ref 更新前なら journal を掃除（dangling commit は許容）
        const code =
          error instanceof Error && 'code' in error
            ? String((error as { code: string }).code)
            : '';
        if (code === 'SPEC_VERSION_RECOVERY_REQUIRED') {
          throw error;
        }
        try {
          const current = readVersionHead(options);
          const refIsNew =
            (detached && current.commit === commitHash) ||
            (!detached &&
              current.commit === commitHash &&
              current.ref === head.ref);
          if (!refIsNew) {
            removeArtifacts({ ...options, operationId });
          }
        } catch {
          // journal 残置の可能性あり → 次操作で RECOVERY_REQUIRED
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
          'commit に失敗しました。',
        );
      }
    }),
  );
}

/** recovery 用: new index の revision を計算する。 */
export function expectedCommitIndexRevision(options: {
  baseCommit: string;
  tree: string;
}): string {
  return computeIndexRevision({
    schemaVersion: '1.0',
    baseCommit: options.baseCommit,
    tree: options.tree,
  });
}
