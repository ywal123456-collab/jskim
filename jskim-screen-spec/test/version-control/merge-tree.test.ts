import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkoutVersion,
  commitVersion,
  mergeLogicalTrees,
  mergeProjectDocument,
  readVersionObject,
  stageProject,
} from '../../src/version-control/index.js';
import { canonicalizeJsonBytes } from '../../src/version-control/canonical-json.js';
import {
  cleanupTemps,
  initialCommit,
  setupDivergedBranches,
  setupProject,
  writeScreen as writeScreenHelper,
} from './merge-test-helpers.js';

afterEach(() => {
  cleanupTemps();
});

function blobText(
  ctx: { rootDir: string; projectName: string },
  hash: string,
): string {
  return readVersionObject({
    ...ctx,
    hash,
    expectedType: 'blob',
  }).payload.toString('utf8');
}

describe('mergeLogicalTrees', () => {
  it('片側のみ変更なら自動採用する', () => {
    const ctx = setupProject({ screens: ['a', 'b'] });
    const { base, mainTip, topicTip } = setupDivergedBranches(ctx);
    const result = mergeLogicalTrees({
      ...ctx,
      baseTree: base.treeHash,
      oursTree: mainTip.treeHash,
      theirsTree: topicTip.treeHash,
    });
    expect(result.conflicts).toEqual([]);
    const oursAlpha = blobText(
      ctx,
      result.mergedFiles.get('screens/alpha/description.json')!.hash,
    );
    const theirsBeta = blobText(
      ctx,
      result.mergedFiles.get('screens/beta/description.json')!.hash,
    );
    expect(oursAlpha).toContain('main-side');
    expect(theirsBeta).toContain('topic-side');
  });

  it('両側が同じ path を変更すると content conflict', () => {
    const ctx = setupProject({ screens: ['a'] });
    const base = initialCommit(ctx);

    writeScreenHelper(ctx.rootDir, ctx.projectName, 'a', 'ours');
    stageProject(ctx);
    const ours = commitVersion({
      ...ctx,
      message: 'ours',
      committedAt: '2026-07-20T01:00:00.000Z',
    });

    checkoutVersion({ ...ctx, target: base.commitHash });
    writeScreenHelper(ctx.rootDir, ctx.projectName, 'a', 'theirs');
    stageProject(ctx);
    const theirs = commitVersion({
      ...ctx,
      message: 'theirs',
      committedAt: '2026-07-20T01:01:00.000Z',
    });

    const result = mergeLogicalTrees({
      ...ctx,
      baseTree: base.treeHash,
      oursTree: ours.treeHash,
      theirsTree: theirs.treeHash,
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.path).toBe('screens/a/description.json');
    expect(result.conflicts[0]?.kind).toBe('content');
  });

  it('add/add で内容が異なれば conflict', () => {
    const ctx = setupProject({ screens: ['a'] });
    const base = initialCommit(ctx);

    writeScreenHelper(ctx.rootDir, ctx.projectName, 'b');
    stageProject(ctx);
    const ours = commitVersion({
      ...ctx,
      message: 'ours add screen',
      committedAt: '2026-07-20T02:00:00.000Z',
    });

    checkoutVersion({ ...ctx, target: base.commitHash });
    writeScreenHelper(ctx.rootDir, ctx.projectName, 'b', 'theirs-label');
    stageProject(ctx);
    const theirs = commitVersion({
      ...ctx,
      message: 'theirs add screen',
      committedAt: '2026-07-20T02:01:00.000Z',
    });

    const result = mergeLogicalTrees({
      ...ctx,
      baseTree: base.treeHash,
      oursTree: ours.treeHash,
      theirsTree: theirs.treeHash,
    });
    const addAdd = result.conflicts.filter((c) => c.kind === 'add-add');
    expect(addAdd.length).toBeGreaterThan(0);
  });

  it('delete/modify conflict を検出する', () => {
    const ctx = setupProject({ screens: ['a'] });
    const base = initialCommit(ctx);

    fs.rmSync(
      path.join(
        ctx.rootDir,
        'spec',
        ctx.projectName,
        'src',
        'data',
        'a.json',
      ),
    );
    fs.rmSync(
      path.join(ctx.rootDir, 'src', ctx.projectName, 'pages', 'a.spec.json'),
    );
    stageProject(ctx);
    const ours = commitVersion({
      ...ctx,
      message: 'ours delete',
      committedAt: '2026-07-20T03:00:00.000Z',
    });

    checkoutVersion({ ...ctx, target: base.commitHash });
    writeScreenHelper(ctx.rootDir, ctx.projectName, 'a', 'modified');
    stageProject(ctx);
    const theirs = commitVersion({
      ...ctx,
      message: 'theirs modify',
      committedAt: '2026-07-20T03:01:00.000Z',
    });

    const result = mergeLogicalTrees({
      ...ctx,
      baseTree: base.treeHash,
      oursTree: ours.treeHash,
      theirsTree: theirs.treeHash,
    });
    const deleteModify = result.conflicts.filter(
      (c) => c.kind === 'delete-modify',
    );
    expect(deleteModify.length).toBeGreaterThan(0);
  });

  it('project.json の screenOrder 競合は screenOrder conflict', () => {
    const baseDoc = {
      schemaVersion: '1.0',
      projectName: 'demo',
      screenOrder: ['a', 'b', 'c'],
    };
    const baseBytes = canonicalizeJsonBytes(baseDoc);
    const result = mergeProjectDocument({
      projectName: 'demo',
      knownScreenIds: ['a', 'b', 'c'],
      base: baseBytes,
      ours: canonicalizeJsonBytes({
        ...baseDoc,
        screenOrder: ['b', 'a', 'c'],
      }),
      theirs: canonicalizeJsonBytes({
        ...baseDoc,
        screenOrder: ['c', 'a', 'b'],
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('screenOrder');
  });

  it('projectName 変更は mergeProjectDocument で projectName conflict', () => {
    const baseDoc = {
      schemaVersion: '1.0',
      projectName: 'demo',
      screenOrder: ['a'],
    };
    const baseBytes = canonicalizeJsonBytes(baseDoc);
    const result = mergeProjectDocument({
      projectName: 'demo',
      knownScreenIds: ['a'],
      base: baseBytes,
      ours: canonicalizeJsonBytes({
        ...baseDoc,
        projectName: 'demo-ours',
      }),
      theirs: canonicalizeJsonBytes({
        ...baseDoc,
        projectName: 'demo-theirs',
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('projectName');
  });
});
