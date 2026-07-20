import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  VersionControlError,
  abortMergeVersion,
  checkoutVersion,
  commitVersion,
  continueMergeVersion,
  createOperationId,
  createVersionBranch,
  getVersionStatus,
  inspectVersionRecovery,
  listIncompleteTransactions,
  mergeVersion,
  readVersionHead,
  readVersionIndex,
  recoverVersionRepository,
  stageProject,
  stageScreen,
  transactionJournalPath,
  writeTransactionJournal,
} from '../../src/version-control/index.js';
import {
  cleanupTemps,
  initialCommit,
  setupDivergedBranches,
  setupProject,
  writeScreen,
} from './merge-test-helpers.js';

afterEach(() => {
  cleanupTemps();
});

function setupConflictMerge(ctx: { rootDir: string; projectName: string }) {
  const base = initialCommit(ctx);
  createVersionBranch({ ...ctx, name: 'topic', startPoint: base.commitHash });

  writeScreen(ctx.rootDir, ctx.projectName, 'a', 'main');
  stageProject(ctx);
  commitVersionSafe(ctx, 'main', '2026-07-20T10:00:00.000Z');

  checkoutTopic(ctx);
  writeScreen(ctx.rootDir, ctx.projectName, 'a', 'topic');
  stageProject(ctx);
  commitVersionSafe(ctx, 'topic', '2026-07-20T10:01:00.000Z');

  checkoutMain(ctx);
  return mergeVersion({
    ...ctx,
    target: 'topic',
    committedAt: '2026-07-20T10:02:00.000Z',
  });
}

function checkoutMain(ctx: { rootDir: string; projectName: string }) {
  checkoutVersion({ ...ctx, target: 'main' });
}

function checkoutTopic(ctx: { rootDir: string; projectName: string }) {
  checkoutVersion({ ...ctx, target: 'topic' });
}

function commitVersionSafe(
  ctx: { rootDir: string; projectName: string },
  message: string,
  committedAt: string,
) {
  return commitVersion({ ...ctx, message, committedAt });
}

describe('merge transaction atomicity', () => {
  it('未完了 transaction があると merge を拒否する', () => {
    const ctx = setupProject({ screens: ['a', 'b'] });
    const base = initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'topic' });
    const index = readVersionIndex(ctx);
    const id = createOperationId();
    writeTransactionJournal({
      ...ctx,
      journal: {
        schemaVersion: '1.0',
        operationId: id,
        operation: 'merge',
        phase: 'ref_updated',
        oldHead: {
          mode: 'symbolic',
          ref: 'refs/heads/main',
          commit: base.commitHash,
        },
        newHead: {
          mode: 'symbolic',
          ref: 'refs/heads/main',
          commit: base.commitHash,
        },
        oldIndex: {
          exists: true,
          revision: index.revision,
          baseCommit: index.baseCommit,
          tree: index.tree,
        },
        newIndex: {
          baseCommit: base.commitHash,
          tree: index.tree,
        },
        oldTree: index.tree,
        newTree: index.tree,
        sourceSwap: false,
      },
    });

    expect(() =>
      mergeVersion({ ...ctx, target: 'topic' }),
    ).toThrow(VersionControlError);
    try {
      mergeVersion({ ...ctx, target: 'topic' });
    } catch (error) {
      if (!(error instanceof VersionControlError)) throw error;
      expect(error.code).toBe('SPEC_VERSION_RECOVERY_REQUIRED');
    }
    const jp = transactionJournalPath(ctx.rootDir, ctx.projectName, id);
    if (fs.existsSync(jp)) fs.unlinkSync(jp);
  });

  it('fast-forward merge 成功後は journal を残さない', () => {
    const ctx = setupProject({ screens: ['a', 'b'] });
    initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'topic' });
    checkoutVersion({ ...ctx, target: 'topic' });
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'topic');
    stageProject(ctx);
    commitVersionSafe(ctx, 'topic', '2026-07-20T11:00:00.000Z');
    checkoutMain(ctx);

    const result = mergeVersion({
      ...ctx,
      target: 'topic',
      committedAt: '2026-07-20T11:01:00.000Z',
    });
    expect(result.outcome).toBe('fast-forward');
    expect(listIncompleteTransactions(ctx)).toEqual([]);
    expect(getVersionStatus(ctx).clean).toBe(true);
  });

  it('clean merge 成功後は HEAD/index/working tree が一致する', () => {
    const ctx = setupProject({ screens: ['a', 'b'] });
    setupDivergedBranches(ctx);
    const beforeHead = readVersionHead(ctx).commit;
    const result = mergeVersion({
      ...ctx,
      target: 'topic',
      committedAt: '2026-07-20T11:10:00.000Z',
    });
    expect(result.outcome).toBe('merged');
    if (result.outcome !== 'merged') return;
    expect(readVersionHead(ctx).commit).toBe(result.commitHash);
    expect(readVersionIndex(ctx).baseCommit).toBe(result.commitHash);
    expect(readVersionHead(ctx).commit).not.toBe(beforeHead);
    expect(listIncompleteTransactions(ctx)).toEqual([]);
  });

  it('conflict setup 後も merge state と working tree hash を保持する', () => {
    const ctx = setupProject({ screens: ['a'] });
    const result = setupConflictMerge(ctx);
    expect(result.outcome).toBe('conflicts');
    if (result.outcome !== 'conflicts') return;
    expect(result.mergeState.workingTreeHash).toBeTruthy();
    expect(getVersionStatus(ctx).mergeInProgress).toBe(true);
    expect(listIncompleteTransactions(ctx)).toEqual([]);
  });

  it('continue 成功後は merge state を除去する', () => {
    const ctx = setupProject({ screens: ['a'] });
    setupConflictMerge(ctx);
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'resolved');
    stageScreen({ ...ctx, screenId: 'a' });
    continueMergeVersion({
      ...ctx,
      message: 'finish merge',
      committedAt: '2026-07-20T11:20:00.000Z',
    });
    expect(getVersionStatus(ctx).mergeInProgress).toBe(false);
    expect(listIncompleteTransactions(ctx)).toEqual([]);
  });

  it('abort 成功後は ours tree へ戻し merge state を除去する', () => {
    const ctx = setupProject({ screens: ['a'] });
    initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'topic', startPoint: readVersionHead(ctx).commit! });

    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'main');
    stageProject(ctx);
    commitVersionSafe(ctx, 'main', '2026-07-20T11:15:00.000Z');
    const beforeHead = readVersionHead(ctx).commit;

    checkoutTopic(ctx);
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'topic');
    stageProject(ctx);
    commitVersionSafe(ctx, 'topic', '2026-07-20T11:16:00.000Z');

    checkoutMain(ctx);
    mergeVersion({
      ...ctx,
      target: 'topic',
      committedAt: '2026-07-20T11:17:00.000Z',
    });

    abortMergeVersion(ctx);
    expect(readVersionHead(ctx).commit).toBe(beforeHead);
    expect(getVersionStatus(ctx).mergeInProgress).toBe(false);
    expect(listIncompleteTransactions(ctx)).toEqual([]);
  });

  it('recover inspect は merge 後も read-only', () => {
    const ctx = setupProject({ screens: ['a', 'b'] });
    setupDivergedBranches(ctx);
    mergeVersion({
      ...ctx,
      target: 'topic',
      committedAt: '2026-07-20T11:30:00.000Z',
    });
    const inspection = inspectVersionRecovery(ctx);
    expect(inspection.recoveryRequired).toBe(false);
    expect(() =>
      recoverVersionRepository({ ...ctx, confirm: false }),
    ).toThrow(VersionControlError);
  });
});
