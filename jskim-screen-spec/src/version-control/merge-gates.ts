import { createVersionControlError } from './errors.js';
import { readVersionHead } from './head.js';
import {
  hasVersionMergeState,
  readVersionMergeState,
  type VersionMergeState,
} from './merge-state.js';
import { getVersionStatus } from './status.js';
import { assertNoIncompleteTransaction } from './transaction.js';
import { readVersionIndex } from './version-index.js';

/**
 * merge 開始前の前提条件を検証する。
 * - clean working tree / index
 * - symbolic HEAD with commit
 * - merge state なし
 * - 未完了 transaction なし
 */
export function assertMergeCanStart(options: {
  rootDir: string;
  projectName: string;
}): void {
  assertNoIncompleteTransaction(options);

  if (hasVersionMergeState(options)) {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_IN_PROGRESS',
      '進行中の merge があるため新しい merge を開始できません。',
    );
  }

  const head = readVersionHead(options);
  if (head.unborn || !head.commit || !head.ref) {
    if (head.unborn || !head.commit) {
      throw createVersionControlError(
        'SPEC_VERSION_MERGE_UNBORN_HEAD',
        'commit が無い branch では merge できません。',
      );
    }
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_DETACHED_HEAD',
      'detached HEAD では merge できません。',
    );
  }

  const index = readVersionIndex(options);
  if (head.commit !== index.baseCommit) {
    throw createVersionControlError(
      'SPEC_VERSION_HEAD_CHANGED',
      'HEAD が index の base から変更されています。',
    );
  }

  const status = getVersionStatus(options);
  if (!status.clean) {
    throw createVersionControlError(
      'SPEC_VERSION_WORKING_TREE_DIRTY',
      'staged または unstaged の変更があるため merge できません。',
    );
  }
}

export function assertNoMergeInProgress(options: {
  rootDir: string;
  projectName: string;
}): void {
  if (hasVersionMergeState(options)) {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_IN_PROGRESS',
      '進行中の merge があります。',
    );
  }
}

export function assertMergeInProgress(options: {
  rootDir: string;
  projectName: string;
}): VersionMergeState {
  const state = readVersionMergeState(options);
  if (!state) {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_NOT_IN_PROGRESS',
      '進行中の merge がありません。',
    );
  }
  return state;
}
