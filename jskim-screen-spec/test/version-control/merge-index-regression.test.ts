import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  VersionControlError,
  abortMergeVersion,
  assertFsckClean,
  checkoutVersion,
  commitVersion,
  continueMergeVersion,
  createVersionBranch,
  createVersionControlError,
  fsckVersionRepository,
  getVersionStatus,
  inspectMergeVersion,
  inspectVersionRecovery,
  listIncompleteTransactions,
  mergeVersion,
  readVersionHead,
  readVersionIndex,
  readVersionMergeState,
  readVersionObject,
  stageProject,
  stageScreen,
} from '../../src/version-control/index.js';
import { flattenVersionTree } from '../../src/version-control/status.js';
import {
  mergeStatePath,
  writeVersionMergeState,
} from '../../src/version-control/merge-state.js';
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

function setupAbcBeforeMerge(ctx: { rootDir: string; projectName: string }) {
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

  return {
    beforeHead: currentHeadCommit(ctx),
    beforeIndex: readVersionIndex(ctx),
  };
}

function setupAbcConflict(ctx: { rootDir: string; projectName: string }) {
  const { beforeHead: mainHeadBeforeMerge } = setupAbcBeforeMerge(ctx);
  const mergeResult = mergeVersion({
    ...ctx,
    target: 'topic',
    committedAt: '2026-07-20T10:02:00.000Z',
  });
  return { mergeResult, mainHeadBeforeMerge };
}

// 並列 filesystem 競合で既定 5s を超える場合があるため、この merge index suite 全体に明示する
describe(
  'merge index regression',
  { timeout: 10_000 },
  () => {
  it('conflict setup で index に auto-merge された B/C を含める', () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c'] });
    const { mergeResult } = setupAbcConflict(ctx);
    expect(mergeResult.outcome).toBe('conflicts');

    const index = readVersionIndex(ctx);
    const mergeState = readVersionMergeState(ctx);
    expect(mergeState).not.toBeNull();
    expect(index.tree).toBe(mergeState!.mergeIndexTree);
    expect(screenLabel(ctx, index.tree, 'b')).toBe('ours-b');
    expect(screenLabel(ctx, index.tree, 'c')).toBe('theirs-c');
    expect(screenLabel(ctx, index.tree, 'a')).toBe('ours-a');
  });

  it('A conflict / B ours / C theirs で add --screen A + continue 後 merge commit に A/B/C を含める', () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c'] });
    setupAbcConflict(ctx);

    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'resolved-a');
    stageScreen({ ...ctx, screenId: 'a' });
    const finished = continueMergeVersion({
      ...ctx,
      message: 'finish merge',
      committedAt: '2026-07-20T10:03:00.000Z',
    });

    expect(finished.parents).toHaveLength(2);
    expect(screenLabel(ctx, finished.treeHash, 'a')).toBe('resolved-a');
    expect(screenLabel(ctx, finished.treeHash, 'b')).toBe('ours-b');
    expect(screenLabel(ctx, finished.treeHash, 'c')).toBe('theirs-c');
    expect(readVersionIndex(ctx).tree).toBe(finished.treeHash);
    expect(getVersionStatus(ctx).clean).toBe(true);
  });

  it('同 scenario で commitVersion も 2-parent merge commit を作る', () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c'] });
    setupAbcConflict(ctx);

    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'resolved-via-commit');
    stageScreen({ ...ctx, screenId: 'a' });
    const viaCommit = commitVersion({
      ...ctx,
      message: 'Merge via commit',
      committedAt: '2026-07-20T10:04:00.000Z',
    });

    expect(viaCommit.parents).toHaveLength(2);
    expect(screenLabel(ctx, viaCommit.treeHash, 'c')).toBe('theirs-c');
    expect(getVersionStatus(ctx).clean).toBe(true);
  });

  it(
    'A/D conflict で A のみ stage した continue は拒否し B/C index を維持する',
    () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c', 'd'] });
    initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'topic' });
    checkoutVersion({ ...ctx, target: 'topic' });
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'theirs-a');
    writeScreen(ctx.rootDir, ctx.projectName, 'd', 'theirs-d');
    writeScreen(ctx.rootDir, ctx.projectName, 'c', 'theirs-c');
    stageProject(ctx);
    commitVersion({
      ...ctx,
      message: 'topic',
      committedAt: '2026-07-20T11:00:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'main' });
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'ours-a');
    writeScreen(ctx.rootDir, ctx.projectName, 'b', 'ours-b');
    writeScreen(ctx.rootDir, ctx.projectName, 'd', 'ours-d');
    stageProject(ctx);
    commitVersion({
      ...ctx,
      message: 'main',
      committedAt: '2026-07-20T11:01:00.000Z',
    });

    mergeVersion({
      ...ctx,
      target: 'topic',
      committedAt: '2026-07-20T11:02:00.000Z',
    });

    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'resolved-a');
    stageScreen({ ...ctx, screenId: 'a' });
    const indexAfterPartial = readVersionIndex(ctx);
    expect(screenLabel(ctx, indexAfterPartial.tree, 'b')).toBe('ours-b');
    expect(screenLabel(ctx, indexAfterPartial.tree, 'c')).toBe('theirs-c');

    expect(() =>
      continueMergeVersion({
        ...ctx,
        message: 'too early',
        committedAt: '2026-07-20T11:03:00.000Z',
      }),
    ).toThrowError(/未解決|UNRESOLVED/);

    writeScreen(ctx.rootDir, ctx.projectName, 'd', 'resolved-d');
    stageScreen({ ...ctx, screenId: 'd' });
    const finished = continueMergeVersion({
      ...ctx,
      message: 'done',
      committedAt: '2026-07-20T11:04:00.000Z',
    });
    expect(screenLabel(ctx, finished.treeHash, 'b')).toBe('ours-b');
    expect(screenLabel(ctx, finished.treeHash, 'c')).toBe('theirs-c');
    expect(getVersionStatus(ctx).clean).toBe(true);
  },
    20000,
  );

  it('conflict setup 直後 abort は ours へ戻す', () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c'] });
    const { mainHeadBeforeMerge } = setupAbcConflict(ctx);

    abortMergeVersion(ctx);
    expect(readVersionHead(ctx).commit).toBe(mainHeadBeforeMerge);
    expect(inspectMergeVersion(ctx).inProgress).toBe(false);
    expect(readVersionIndex(ctx).tree).toBe(readVersionHead(ctx).tree);
    expect(getVersionStatus(ctx).clean).toBe(true);
  });

  it('auto-merged index 状態で内容変更なし stage 後も abort できる', () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c'] });
    const { mainHeadBeforeMerge } = setupAbcConflict(ctx);

    stageScreen({ ...ctx, screenId: 'a' });
    abortMergeVersion(ctx);
    expect(readVersionHead(ctx).commit).toBe(mainHeadBeforeMerge);
    expect(getVersionStatus(ctx).clean).toBe(true);
  });

  it('working edit 後 abort は unsafe', () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c'] });
    setupAbcConflict(ctx);
    writeScreen(ctx.rootDir, ctx.projectName, 'b', 'user edited b');
    expect(() => abortMergeVersion(ctx)).toThrow(VersionControlError);
    try {
      abortMergeVersion(ctx);
    } catch (error) {
      if (!(error instanceof VersionControlError)) throw error;
      expect(error.code).toBe('SPEC_VERSION_MERGE_ABORT_UNSAFE');
    }
  });

  it('MERGE_STATE 書き込み失敗時は ours source/index を維持する', () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c'] });
    const { beforeHead, beforeIndex } = setupAbcBeforeMerge(ctx);

    expect(() =>
      mergeVersion({
        ...ctx,
        target: 'topic',
        committedAt: '2026-07-20T12:02:00.000Z',
        adapters: {
          writeVersionMergeState: () => {
            throw createVersionControlError(
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

  it('merge 完了後 recovery inspect は read-only', () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c'] });
    setupAbcConflict(ctx);
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'resolved-a');
    stageScreen({ ...ctx, screenId: 'a' });
    continueMergeVersion({
      ...ctx,
      message: 'done',
      committedAt: '2026-07-20T12:03:00.000Z',
    });
    expect(listIncompleteTransactions(ctx)).toEqual([]);
    expect(inspectVersionRecovery(ctx).recoveryRequired).toBe(false);
  });

  it('fsck は resolvedPaths subset 違反と mergeIndexTree 欠落を error とする', () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c'] });
    setupAbcConflict(ctx);
    const state = readVersionMergeState(ctx);
    expect(state).not.toBeNull();
    if (!state) return;

    fs.writeFileSync(
      mergeStatePath(ctx.rootDir, ctx.projectName),
      `${JSON.stringify({
        ...state,
        resolvedPaths: ['screens/missing/description.json'],
      })}\n`,
    );
    const badSubset = fsckVersionRepository(ctx);
    expect(
      badSubset.errors.some(
        (e) => e.includes('resolvedPaths') || e.includes('MERGE_STATE'),
      ),
    ).toBe(true);

    fs.writeFileSync(
      mergeStatePath(ctx.rootDir, ctx.projectName),
      `${JSON.stringify({
        ...state,
        resolvedPaths: [],
        mergeIndexTree: '0'.repeat(64),
      })}\n`,
    );
    const badTree = fsckVersionRepository(ctx);
    expect(
      badTree.errors.some((e) => e.includes('mergeIndexTree')),
    ).toBe(true);

    writeVersionMergeState({ ...ctx, state });
    assertFsckClean(ctx);
  });
  },
);
