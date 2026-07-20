import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  VersionControlError,
  abortMergeVersion,
  checkoutVersion,
  commitVersion,
  continueMergeVersion,
  createVersionBranch,
  getVersionLog,
  getVersionStatus,
  inspectMergeVersion,
  mergeVersion,
  readVersionHead,
  stageProject,
  stageScreen,
} from '../../src/version-control/index.js';
import {
  cleanupTemps,
  currentHeadCommit,
  initialCommit,
  setupDivergedBranches,
  setupProject,
  writeScreen,
} from './merge-test-helpers.js';

afterEach(() => {
  cleanupTemps();
});

describe('mergeVersion', () => {
  it('already-up-to-date は HEAD を維持する', () => {
    const ctx = setupProject({ screens: ['a', 'b'] });
    const base = initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'topic', startPoint: base.commitHash });
    const result = mergeVersion({ ...ctx, target: base.commitHash });
    expect(result.outcome).toBe('already-up-to-date');
    if (result.outcome !== 'already-up-to-date') return;
    expect(result.commitHash).toBe(base.commitHash);
    expect(getVersionStatus(ctx).clean).toBe(true);
  });

  it('fast-forward merge は branch tip と working tree を進める', () => {
    const ctx = setupProject({ screens: ['a', 'b'] });
    const base = initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'topic' });
    checkoutVersion({ ...ctx, target: 'topic' });
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'topic');
    stageProject(ctx);
    const topicTip = commitVersion({
      ...ctx,
      message: 'topic',
      committedAt: '2026-07-20T01:00:00.000Z',
    });
    checkoutVersion({ ...ctx, target: 'main' });
    const result = mergeVersion({
      ...ctx,
      target: 'topic',
      committedAt: '2026-07-20T01:01:00.000Z',
    });
    expect(result.outcome).toBe('fast-forward');
    if (result.outcome !== 'fast-forward') return;
    expect(readVersionHead(ctx).commit).toBe(topicTip.commitHash);
    const data = JSON.parse(
      fs.readFileSync(
        path.join(ctx.rootDir, 'spec', ctx.projectName, 'src', 'data', 'a.json'),
        'utf8',
      ),
    ) as { screen: { name: string } };
    expect(data.screen.name).toBe('topic');
  });

  it('clean 2-parent merge commit を作成する', () => {
    const ctx = setupProject({ screens: ['a', 'b'] });
    setupDivergedBranches(ctx);
    const result = mergeVersion({
      ...ctx,
      target: 'topic',
      message: 'Merge topic into main',
      committedAt: '2026-07-20T02:00:00.000Z',
    });
    expect(result.outcome).toBe('merged');
    if (result.outcome !== 'merged') return;
    expect(result.parents).toHaveLength(2);
    expect(getVersionLog({ ...ctx, limit: 1 }).commits[0]?.hash).toBe(
      result.commitHash,
    );
    expect(inspectMergeVersion(ctx).inProgress).toBe(false);
  });

  it('conflict merge は merge state と working tree を残す', () => {
    const ctx = setupProject({ screens: ['a'] });
    const base = initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'topic', startPoint: base.commitHash });

    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'main');
    stageProject(ctx);
    commitVersion({
      ...ctx,
      message: 'main',
      committedAt: '2026-07-20T03:00:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'topic' });
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'topic');
    stageProject(ctx);
    commitVersion({
      ...ctx,
      message: 'topic',
      committedAt: '2026-07-20T03:01:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'main' });
    const result = mergeVersion({
      ...ctx,
      target: 'topic',
      committedAt: '2026-07-20T03:02:00.000Z',
    });
    expect(result.outcome).toBe('conflicts');
    if (result.outcome !== 'conflicts') return;
    expect(result.conflicts.length).toBeGreaterThan(0);
    const inspection = inspectMergeVersion(ctx);
    expect(inspection.inProgress).toBe(true);
    expect(inspection.unresolvedConflicts.length).toBeGreaterThan(0);
    expect(getVersionStatus(ctx).mergeInProgress).toBe(true);
  });

  it('部分解決後 stage すると resolvedPaths が更新される', () => {
    const ctx = setupProject({ screens: ['a'] });
    const base = initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'topic', startPoint: base.commitHash });

    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'main');
    stageProject(ctx);
    commitVersion({
      ...ctx,
      message: 'main',
      committedAt: '2026-07-20T04:00:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'topic' });
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'topic');
    stageProject(ctx);
    commitVersion({
      ...ctx,
      message: 'topic',
      committedAt: '2026-07-20T04:01:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'main' });
    const conflict = mergeVersion({
      ...ctx,
      target: 'topic',
      committedAt: '2026-07-20T04:02:00.000Z',
    });
    expect(conflict.outcome).toBe('conflicts');
    if (conflict.outcome !== 'conflicts') return;

    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'resolved');
    stageScreen({ ...ctx, screenId: 'a' });
    const partial = inspectMergeVersion(ctx);
    expect(partial.resolvedConflicts.length).toBe(1);
    expect(partial.unresolvedConflicts.length).toBe(0);
  });

  it('未解決のまま continue は拒否する', () => {
    const ctx = setupProject({ screens: ['a'] });
    const base = initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'topic', startPoint: base.commitHash });

    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'main');
    stageProject(ctx);
    commitVersion({
      ...ctx,
      message: 'main',
      committedAt: '2026-07-20T05:00:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'topic' });
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'topic');
    stageProject(ctx);
    commitVersion({
      ...ctx,
      message: 'topic',
      committedAt: '2026-07-20T05:01:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'main' });
    mergeVersion({
      ...ctx,
      target: 'topic',
      committedAt: '2026-07-20T05:02:00.000Z',
    });

    expect(() =>
      continueMergeVersion({
        ...ctx,
        message: 'finish',
        committedAt: '2026-07-20T05:03:00.000Z',
      }),
    ).toThrowError(/未解決|UNRESOLVED/);
  });

  it('全 conflict 解決後 continue で 2-parent commit 完了', () => {
    const ctx = setupProject({ screens: ['a'] });
    const base = initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'topic', startPoint: base.commitHash });

    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'main');
    stageProject(ctx);
    const mainTip = commitVersion({
      ...ctx,
      message: 'main',
      committedAt: '2026-07-20T06:00:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'topic' });
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'topic');
    stageProject(ctx);
    const topicTip = commitVersion({
      ...ctx,
      message: 'topic',
      committedAt: '2026-07-20T06:01:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'main' });
    mergeVersion({
      ...ctx,
      target: 'topic',
      committedAt: '2026-07-20T06:02:00.000Z',
    });

    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'resolved');
    stageScreen({ ...ctx, screenId: 'a' });
    const finished = continueMergeVersion({
      ...ctx,
      message: 'Merge topic into main',
      committedAt: '2026-07-20T06:03:00.000Z',
    });
    expect(finished.parents).toEqual([mainTip.commitHash, topicTip.commitHash]);
    expect(inspectMergeVersion(ctx).inProgress).toBe(false);
    expect(getVersionStatus(ctx).clean).toBe(true);
  });

  it('merge ready 状態では commitVersion でも merge commit できる', () => {
    const ctx = setupProject({ screens: ['a'] });
    const base = initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'topic', startPoint: base.commitHash });

    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'main');
    stageProject(ctx);
    const mainTip = commitVersion({
      ...ctx,
      message: 'main',
      committedAt: '2026-07-20T07:00:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'topic' });
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'topic');
    stageProject(ctx);
    const topicTip = commitVersion({
      ...ctx,
      message: 'topic',
      committedAt: '2026-07-20T07:01:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'main' });
    mergeVersion({
      ...ctx,
      target: 'topic',
      committedAt: '2026-07-20T07:02:00.000Z',
    });
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'resolved');
    stageScreen({ ...ctx, screenId: 'a' });

    const viaCommit = commitVersion({
      ...ctx,
      message: 'Merge via commit',
      committedAt: '2026-07-20T07:03:00.000Z',
    });
    expect(viaCommit.parents).toEqual([mainTip.commitHash, topicTip.commitHash]);
    expect(inspectMergeVersion(ctx).inProgress).toBe(false);
  });

  it('abort は merge 前状態へ戻す', () => {
    const ctx = setupProject({ screens: ['a'] });
    const base = initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'topic', startPoint: base.commitHash });

    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'main');
    stageProject(ctx);
    commitVersion({
      ...ctx,
      message: 'main',
      committedAt: '2026-07-20T08:00:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'topic' });
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'topic');
    stageProject(ctx);
    commitVersion({
      ...ctx,
      message: 'topic',
      committedAt: '2026-07-20T08:01:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'main' });
    const beforeHead = currentHeadCommit(ctx);
    mergeVersion({
      ...ctx,
      target: 'topic',
      committedAt: '2026-07-20T08:02:00.000Z',
    });

    const aborted = abortMergeVersion(ctx);
    expect(aborted.restoredTree).toBeTruthy();
    expect(readVersionHead(ctx).commit).toBe(beforeHead);
    expect(inspectMergeVersion(ctx).inProgress).toBe(false);
    expect(getVersionStatus(ctx).clean).toBe(true);
  });

  it('working tree 改変後の abort は unsafe', () => {
    const ctx = setupProject({ screens: ['a'] });
    const base = initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'topic', startPoint: base.commitHash });

    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'main');
    stageProject(ctx);
    commitVersion({
      ...ctx,
      message: 'main',
      committedAt: '2026-07-20T09:00:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'topic' });
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'topic');
    stageProject(ctx);
    commitVersion({
      ...ctx,
      message: 'topic',
      committedAt: '2026-07-20T09:01:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'main' });
    mergeVersion({
      ...ctx,
      target: 'topic',
      committedAt: '2026-07-20T09:02:00.000Z',
    });

    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'user edited during merge');
    expect(() => abortMergeVersion(ctx)).toThrowError(/abort|ABORT_UNSAFE/);
    try {
      abortMergeVersion(ctx);
    } catch (error) {
      if (!(error instanceof VersionControlError)) throw error;
      expect(error.code).toBe('SPEC_VERSION_MERGE_ABORT_UNSAFE');
    }
  });

  it('detached HEAD では merge を拒否する', () => {
    const ctx = setupProject({ screens: ['a'] });
    const base = initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'topic' });
    checkoutVersion({ ...ctx, target: base.commitHash });
    expect(() => mergeVersion({ ...ctx, target: 'topic' })).toThrowError(
      /detached|DETACHED/,
    );
  });

  it('unborn HEAD では merge を拒否する', () => {
    const ctx = setupProject({ screens: ['a'] });
    expect(() => mergeVersion({ ...ctx, target: 'main' })).toThrowError(
      /commit が無い|unborn|UNBORN/,
    );
  });

  it('dirty working tree では merge を拒否する', () => {
    const ctx = setupProject({ screens: ['a', 'b'] });
    initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'topic' });
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'dirty');
    expect(() => mergeVersion({ ...ctx, target: 'topic' })).toThrowError(
      /dirty|変更/,
    );
  });
});
