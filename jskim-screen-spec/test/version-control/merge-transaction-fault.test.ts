import { afterEach, describe, expect, it } from 'vitest';
import {
  VersionControlError,
  abortMergeVersion,
  continueMergeVersion,
  checkoutVersion,
  commitVersion,
  createVersionBranch,
  getVersionLog,
  getVersionStatus,
  inspectVersionRecovery,
  listIncompleteTransactions,
  mergeVersion,
  readVersionHead,
  readVersionIndex,
  readVersionMergeState,
  recoverVersionRepository,
  stageProject,
  stageScreen,
} from '../../src/version-control/index.js';
import { flattenVersionTree } from '../../src/version-control/status.js';
import { readVersionObject } from '../../src/version-control/object-store.js';
import {
  cleanupTemps,
  currentHeadCommit,
  initialCommit,
  setupProject,
  writeScreen,
} from './merge-test-helpers.js';

afterEach(() => {
  cleanupTemps();
});

function screenLabel(
  ctx: { rootDir: string; projectName: string },
  treeHash: string,
  screenId: string,
): string | null {
  const flat = flattenVersionTree(ctx, treeHash);
  const entry = flat.get(`screens/${screenId}/description.json`);
  if (!entry) return null;
  const obj = readVersionObject({
    ...ctx,
    hash: entry.hash,
    expectedType: 'blob',
  });
  const parsed = JSON.parse(obj.payload.toString('utf8')) as {
    screen?: { name?: string };
  };
  return parsed.screen?.name ?? null;
}

function setupAbcConflict(ctx: { rootDir: string; projectName: string }) {
  initialCommit(ctx);
  createVersionBranch({ ...ctx, name: 'topic' });
  checkoutVersion({ ...ctx, target: 'topic' });
  writeScreen(ctx.rootDir, ctx.projectName, 'a', 'theirs-a');
  writeScreen(ctx.rootDir, ctx.projectName, 'c', 'theirs-c');
  stageProject(ctx);
  commitVersion({
    ...ctx,
    message: 'topic',
    committedAt: '2026-07-20T10:00:00.000Z',
  });

  checkoutVersion({ ...ctx, target: 'main' });
  writeScreen(ctx.rootDir, ctx.projectName, 'a', 'ours-a');
  writeScreen(ctx.rootDir, ctx.projectName, 'b', 'ours-b');
  stageProject(ctx);
  commitVersion({
    ...ctx,
    message: 'main',
    committedAt: '2026-07-20T10:01:00.000Z',
  });

  const beforeHead = currentHeadCommit(ctx);
  const beforeIndex = readVersionIndex(ctx);
  return { beforeHead, beforeIndex };
}

function resolveAllConflicts(
  ctx: { rootDir: string; projectName: string },
  label = 'resolved-a',
) {
  writeScreen(ctx.rootDir, ctx.projectName, 'a', label);
  stageScreen({ ...ctx, screenId: 'a' });
}

describe('merge transaction fault injection', () => {
  it('conflict setup: source install 後の index 失敗は ours source/index へ rollback する', () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c'] });
    const { beforeHead, beforeIndex } = setupAbcConflict(ctx);

    expect(() =>
      mergeVersion({
        ...ctx,
        target: 'topic',
        committedAt: '2026-07-20T10:02:00.000Z',
        adapters: {
          writeVersionIndex: () => {
            throw new Error('injected index failure');
          },
        },
      }),
    ).toThrowError(/COMMIT_FAILED|index 更新/);

    expect(readVersionMergeState(ctx)).toBeNull();
    expect(readVersionHead(ctx).commit).toBe(beforeHead);
    expect(readVersionIndex(ctx).tree).toBe(beforeIndex.tree);
    expect(listIncompleteTransactions(ctx)).toEqual([]);
    expect(screenLabel(ctx, readVersionHead(ctx).tree!, 'b')).toBe('ours-b');
    expect(screenLabel(ctx, readVersionHead(ctx).tree!, 'c')).not.toBe(
      'theirs-c',
    );
  });

  it('conflict setup: MERGE_STATE 失敗は ours source/index を維持し journal を掃除する', () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c'] });
    const { beforeHead, beforeIndex } = setupAbcConflict(ctx);

    expect(() =>
      mergeVersion({
        ...ctx,
        target: 'topic',
        committedAt: '2026-07-20T10:02:00.000Z',
        adapters: {
          writeVersionMergeState: () => {
            throw new VersionControlError(
              'SPEC_VERSION_MERGE_IN_PROGRESS',
              'injected merge state failure',
            );
          },
        },
      }),
    ).toThrow();

    expect(readVersionMergeState(ctx)).toBeNull();
    expect(readVersionHead(ctx).commit).toBe(beforeHead);
    expect(readVersionIndex(ctx).tree).toBe(beforeIndex.tree);
    expect(listIncompleteTransactions(ctx)).toEqual([]);
    expect(screenLabel(ctx, readVersionHead(ctx).tree!, 'b')).toBe('ours-b');
  });

  it('conflict setup: MERGE_STATE 成功後の journal cleanup 失敗は merge-in-progress を維持する', () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c'] });
    const { beforeHead } = setupAbcConflict(ctx);

    expect(() =>
      mergeVersion({
        ...ctx,
        target: 'topic',
        committedAt: '2026-07-20T10:02:00.000Z',
        adapters: {
          removeTransactionArtifacts: () => {
            throw new Error('injected cleanup failure');
          },
        },
      }),
    ).toThrowError(/RECOVERY_REQUIRED|recovery/);

    const mergeState = readVersionMergeState(ctx);
    expect(mergeState).not.toBeNull();
    expect(readVersionHead(ctx).commit).toBe(beforeHead);
    expect(readVersionIndex(ctx).tree).toBe(mergeState!.mergeIndexTree);
    expect(screenLabel(ctx, readVersionIndex(ctx).tree, 'c')).toBe('theirs-c');
    expect(listIncompleteTransactions(ctx).length).toBe(1);

    const plan = inspectVersionRecovery(ctx).plans[0];
    expect(plan?.recommendedAction).toBe('cleanup');
    expect(plan?.headState).toBe('old');
    expect(plan?.indexState).toBe('new');

    recoverVersionRepository({ ...ctx, confirm: true });
    expect(listIncompleteTransactions(ctx)).toEqual([]);
    expect(readVersionMergeState(ctx)).not.toBeNull();
    expect(getVersionStatus(ctx).mergeInProgress).toBe(true);
    expect(readVersionIndex(ctx).tree).toBe(mergeState!.mergeIndexTree);
  });

  it('continue: ref 更新後の index 失敗は forward recovery で merge commit を完了する', () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c'] });
    setupAbcConflict(ctx);
    mergeVersion({
      ...ctx,
      target: 'topic',
      committedAt: '2026-07-20T10:02:00.000Z',
    });
    resolveAllConflicts(ctx);

    expect(() =>
      continueMergeVersion({
        ...ctx,
        message: 'finish',
        committedAt: '2026-07-20T10:03:00.000Z',
        adapters: {
          writeVersionIndex: () => {
            throw new Error('injected continue index failure');
          },
        },
      }),
    ).toThrowError(/RECOVERY_REQUIRED|recovery/);

    const head = readVersionHead(ctx);
    expect(head.commit).not.toBeNull();
    expect(readVersionMergeState(ctx)).not.toBeNull();
    expect(listIncompleteTransactions(ctx).length).toBe(1);

    const plan = inspectVersionRecovery(ctx).plans[0];
    expect(plan?.recommendedAction).toBe('complete');
    expect(plan?.headState).toBe('new');
    expect(plan?.indexState).toBe('old');

    recoverVersionRepository({ ...ctx, confirm: true });
    expect(listIncompleteTransactions(ctx)).toEqual([]);
    expect(readVersionMergeState(ctx)).toBeNull();
    expect(readVersionIndex(ctx).baseCommit).toBe(head.commit);
    expect(getVersionStatus(ctx).clean).toBe(true);
    const latest = getVersionLog({ ...ctx, limit: 1 }).commits[0];
    expect(latest?.parents.length).toBe(2);
    expect(
      getVersionLog({ ...ctx, limit: 20 }).commits.filter(
        (c) => c.parents.length === 2,
      ).length,
    ).toBe(1);
  });

  it('continue: ref 更新前の失敗は ours HEAD と merge state を維持する', () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c'] });
    const { beforeHead } = setupAbcConflict(ctx);
    mergeVersion({
      ...ctx,
      target: 'topic',
      committedAt: '2026-07-20T10:02:00.000Z',
    });
    resolveAllConflicts(ctx);
    const indexBefore = readVersionIndex(ctx);

    expect(() =>
      continueMergeVersion({
        ...ctx,
        message: 'fail-ref',
        committedAt: '2026-07-20T10:03:00.000Z',
        adapters: {
          compareAndSwapVersionRef: () => {
            throw new VersionControlError(
              'SPEC_VERSION_REF_CONFLICT',
              'injected ref failure',
            );
          },
        },
      }),
    ).toThrow(VersionControlError);

    expect(readVersionHead(ctx).commit).toBe(beforeHead);
    expect(readVersionMergeState(ctx)).not.toBeNull();
    expect(readVersionIndex(ctx).tree).toBe(indexBefore.tree);
    expect(listIncompleteTransactions(ctx)).toEqual([]);

    const finished = continueMergeVersion({
      ...ctx,
      message: 'retry',
      committedAt: '2026-07-20T10:04:00.000Z',
    });
    expect(finished.parents).toHaveLength(2);
    expect(getVersionStatus(ctx).clean).toBe(true);
  });

  it('abort: MERGE_STATE cleanup 前の失敗は journal cleanup で ours へ戻す', () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c'] });
    const { beforeHead } = setupAbcConflict(ctx);
    mergeVersion({
      ...ctx,
      target: 'topic',
      committedAt: '2026-07-20T10:02:00.000Z',
    });

    expect(() =>
      abortMergeVersion({
        ...ctx,
        adapters: {
          removeVersionMergeState: () => {
            throw new Error('injected merge state cleanup failure');
          },
        },
      }),
    ).toThrowError(/RECOVERY_REQUIRED|recovery/);

    expect(readVersionMergeState(ctx)).not.toBeNull();
    expect(readVersionHead(ctx).commit).toBe(beforeHead);
    expect(listIncompleteTransactions(ctx).length).toBe(1);

    const plan = inspectVersionRecovery(ctx).plans[0];
    expect(plan?.recommendedAction).toBe('cleanup');

    recoverVersionRepository({ ...ctx, confirm: true });
    expect(readVersionMergeState(ctx)).toBeNull();
    expect(readVersionHead(ctx).commit).toBe(beforeHead);
    expect(readVersionIndex(ctx).tree).toBe(readVersionHead(ctx).tree);
    expect(listIncompleteTransactions(ctx)).toEqual([]);
    expect(getVersionStatus(ctx).clean).toBe(true);
  });
});
