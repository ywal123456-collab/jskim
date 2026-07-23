import { afterEach, describe, expect, it } from 'vitest';
import {
  VersionControlError,
  checkoutVersion,
  commitVersion,
  createVersionBranch,
  findMergeBase,
  mergeVersion,
  stageProject,
} from '../../src/version-control/index.js';
import {
  cleanupTemps,
  currentHeadCommit,
  initialCommit,
  setupAmbiguousMergeBase,
  setupDivergedBranches,
  setupProject,
  writeRawCommit,
  writeScreen,
} from './merge-test-helpers.js';

afterEach(() => {
  cleanupTemps();
});

describe('findMergeBase', () => {
  it('同一 commit は already-up-to-date', () => {
    const ctx = setupProject({ screens: ['a', 'b'] });
    const base = initialCommit(ctx);
    const result = findMergeBase({
      ...ctx,
      currentCommit: base.commitHash,
      targetCommit: base.commitHash,
    });
    expect(result.kind).toBe('already-up-to-date');
    expect(result.base).toBe(base.commitHash);
    expect(result.oursTree).toBe(result.theirsTree);
  });

  it('target が current の ancestor なら already-up-to-date', () => {
    const ctx = setupProject({ screens: ['a', 'b'] });
    const base = initialCommit(ctx);
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'v2');
    stageProject(ctx);
    const child = commitVersion({
      ...ctx,
      message: 'child',
      committedAt: '2026-07-20T01:00:00.000Z',
    });
    const result = findMergeBase({
      ...ctx,
      currentCommit: child.commitHash,
      targetCommit: base.commitHash,
    });
    expect(result.kind).toBe('already-up-to-date');
    expect(result.base).toBe(base.commitHash);
  });

  it('current が target の ancestor なら fast-forward', () => {
    const ctx = setupProject({ screens: ['a', 'b'] });
    const base = initialCommit(ctx);
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'v2');
    stageProject(ctx);
    const child = commitVersion({
      ...ctx,
      message: 'child',
      committedAt: '2026-07-20T01:00:00.000Z',
    });
    const result = findMergeBase({
      ...ctx,
      currentCommit: base.commitHash,
      targetCommit: child.commitHash,
    });
    expect(result.kind).toBe('fast-forward');
    expect(result.base).toBe(base.commitHash);
    expect(result.theirsTree).toBe(child.treeHash);
  });

  it('divergent branch は three-way base を返す', () => {
    const ctx = setupProject({ screens: ['a', 'b'] });
    const { base, mainTip, topicTip } = setupDivergedBranches(ctx);
    const result = findMergeBase({
      ...ctx,
      currentCommit: mainTip.commitHash,
      targetCommit: topicTip.commitHash,
    });
    expect(result.kind).toBe('three-way');
    expect(result.base).toBe(base.commitHash);
    expect(result.oursTree).toBe(mainTip.treeHash);
    expect(result.theirsTree).toBe(topicTip.treeHash);
    expect(result.baseTree).toBe(base.treeHash);
  });

  // 並列実行時の filesystem 競合で既定 5s を超えることがあるため、この複合 integration のみ明示する
  it(
    'merge commit を含む DAG でも three-way base を決定する',
    () => {
    const ctx = setupProject({ screens: ['a', 'b', 'c'] });
    const base = initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'feat' });

    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'main');
    stageProject(ctx);
    commitVersion({
      ...ctx,
      message: 'main',
      committedAt: '2026-07-20T02:00:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'feat' });
    writeScreen(ctx.rootDir, ctx.projectName, 'b', 'feat');
    stageProject(ctx);
    const featTip = commitVersion({
      ...ctx,
      message: 'feat',
      committedAt: '2026-07-20T02:01:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'main' });
    mergeVersion({
      ...ctx,
      target: 'feat',
      committedAt: '2026-07-20T02:02:00.000Z',
    });

    writeScreen(ctx.rootDir, ctx.projectName, 'c', 'after-merge');
    stageProject(ctx);
    const afterMerge = commitVersion({
      ...ctx,
      message: 'after merge',
      committedAt: '2026-07-20T02:03:00.000Z',
    });

    checkoutVersion({ ...ctx, target: 'feat' });
    writeScreen(ctx.rootDir, ctx.projectName, 'b', 'feat-2');
    stageProject(ctx);
    const feat2 = commitVersion({
      ...ctx,
      message: 'feat-2',
      committedAt: '2026-07-20T02:04:00.000Z',
    });

    const result = findMergeBase({
      ...ctx,
      currentCommit: afterMerge.commitHash,
      targetCommit: feat2.commitHash,
    });
    expect(result.kind).toBe('three-way');
    expect(result.base).not.toBe(afterMerge.commitHash);
    expect(result.base).not.toBe(feat2.commitHash);
  },
    10000,
  );

  it('共通 ancestor が無い場合は NOT_FOUND', () => {
    const ctx = setupProject({ screens: ['a'] });
    const base = initialCommit(ctx);
    const orphan = writeRawCommit(ctx, {
      tree: base.treeHash,
      parents: [],
      message: 'orphan root',
      committedAt: '2026-07-20T03:00:00.000Z',
    });
    expect(() =>
      findMergeBase({
        ...ctx,
        currentCommit: base.commitHash,
        targetCommit: orphan,
      }),
    ).toThrowError(/共通 ancestor|MERGE_BASE_NOT_FOUND/);
    try {
      findMergeBase({
        ...ctx,
        currentCommit: base.commitHash,
        targetCommit: orphan,
      });
    } catch (error) {
      if (!(error instanceof VersionControlError)) throw error;
      expect(error.code).toBe('SPEC_VERSION_MERGE_BASE_NOT_FOUND');
    }
  });

  it('独立した 2 つの merge commit は単一 three-way base に解決される', () => {
    const ctx = setupProject({ screens: ['a'] });
    const base = initialCommit(ctx);
    const left = writeRawCommit(ctx, {
      tree: base.treeHash,
      parents: [base.commitHash],
      message: 'left',
      committedAt: '2026-07-20T03:10:00.000Z',
    });
    const right = writeRawCommit(ctx, {
      tree: base.treeHash,
      parents: [base.commitHash],
      message: 'right',
      committedAt: '2026-07-20T03:11:00.000Z',
    });
    const mergeLeft = writeRawCommit(ctx, {
      tree: base.treeHash,
      parents: [left, right],
      message: 'merge-left',
      committedAt: '2026-07-20T03:12:00.000Z',
    });
    const mergeRight = writeRawCommit(ctx, {
      tree: base.treeHash,
      parents: [left, right],
      message: 'merge-right',
      committedAt: '2026-07-20T03:13:00.000Z',
    });

    const result = findMergeBase({
      ...ctx,
      currentCommit: mergeLeft,
      targetCommit: mergeRight,
    });
    expect(result.kind).toBe('three-way');
    expect(result.base).toBe(base.commitHash);
  });

  it(
    'criss-cross merge 後も three-way base を返す',
    () => {
      const ctx = setupProject({ screens: ['alpha', 'beta'] });
      const graph = setupAmbiguousMergeBase(ctx);
      const result = findMergeBase({
        ...ctx,
        currentCommit: graph.leftTip.commitHash,
        targetCommit: graph.rightTip.commitHash,
      });
      expect(result.kind).toBe('three-way');
      expect(result.base).toBeTruthy();
    },
    20_000,
  );

  it('AMBIGUOUS エラー code が定義されている', () => {
    const err = new VersionControlError(
      'SPEC_VERSION_MERGE_BASE_AMBIGUOUS',
      '複数の merge base が見つかりました。',
    );
    expect(err.code).toBe('SPEC_VERSION_MERGE_BASE_AMBIGUOUS');
  });
});
