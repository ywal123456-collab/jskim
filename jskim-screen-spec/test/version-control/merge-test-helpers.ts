import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkoutVersion,
  commitVersion,
  createVersionBranch,
  initVersionRepository,
  mergeVersion,
  persistVersionAuthorConfig,
  readVersionHead,
  stageProject,
  writeVersionObject,
} from '../../src/version-control/index.js';
import type { CommitObject } from '../../src/version-control/types.js';
import { compareAndSwapVersionRef } from '../../src/version-control/refs.js';

export const temps: string[] = [];

export function tempRoot(prefix = 'jskim-vc-merge-'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(root);
  return root;
}

export function cleanupTemps(): void {
  while (temps.length > 0) {
    const root = temps.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
}

export function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeScreen(
  root: string,
  project: string,
  id: string,
  label = id,
  items: Record<string, Record<string, string>> = {},
): void {
  writeJson(path.join(root, 'src', project, 'pages', `${id}.spec.json`), {
    schemaVersion: '1.0',
    screen: { id, path: `/${id}` },
    states: [{ id: 'default', name: 'Default' }],
    interactions: [],
  });
  writeJson(path.join(root, 'spec', project, 'src', 'data', `${id}.json`), {
    schemaVersion: '1.2',
    screen: { id, name: label },
    itemOrder: Object.keys(items),
    excludedItems: {},
    items,
  });
}

export function writeFeatures(
  root: string,
  project: string,
  features: Array<{
    featureId: string;
    name: string;
    displayOrder: number;
    screenIds: string[];
    description?: string;
  }>,
): void {
  writeJson(path.join(root, 'spec', project, 'src', 'features.json'), {
    schemaVersion: '1.0',
    features,
  });
}

export function setupProject(
  options: {
    screens?: string[];
    features?: boolean;
    reference?: boolean;
  } = {},
): { rootDir: string; projectName: string } {
  const rootDir = tempRoot();
  const projectName = 'demo';
  const screens = options.screens ?? ['alpha', 'beta'];
  for (const id of screens) writeScreen(rootDir, projectName, id);
  if (options.features) {
    writeFeatures(rootDir, projectName, [
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: [screens[0]!],
      },
    ]);
  }
  initVersionRepository({ rootDir, projectName });
  persistVersionAuthorConfig({
    rootDir,
    projectName,
    config: {
      schemaVersion: '1.0',
      user: { name: 'Taro Yamada', email: 'taro@example.com' },
    },
  });
  return { rootDir, projectName };
}

export function initialCommit(ctx: { rootDir: string; projectName: string }) {
  stageProject(ctx);
  return commitVersion({
    ...ctx,
    message: 'initial',
    committedAt: '2026-07-20T00:00:00.000Z',
  });
}

export function writeRawCommit(
  ctx: { rootDir: string; projectName: string },
  options: {
    tree: string;
    parents: string[];
    message: string;
    committedAt?: string;
  },
): string {
  const payload: CommitObject = {
    formatVersion: '1.0',
    tree: options.tree,
    parents: options.parents,
    author: { name: 'Taro Yamada', email: 'taro@example.com' },
    committer: { name: 'Taro Yamada', email: 'taro@example.com' },
    committedAt: options.committedAt ?? '2026-07-20T12:00:00.000Z',
    message: options.message,
  };
  return writeVersionObject({
    ...ctx,
    type: 'commit',
    payload,
  }).hash;
}

export function setBranchTip(
  ctx: { rootDir: string; projectName: string },
  branch: string,
  commitHash: string,
  expectedOldHash: string | null = null,
): void {
  compareAndSwapVersionRef({
    ...ctx,
    kind: 'heads',
    name: branch,
    expectedOldHash,
    newHash: commitHash,
  });
}

export function commitOnBranch(
  ctx: { rootDir: string; projectName: string },
  branch: string,
  mutate: () => void,
  message: string,
  committedAt: string,
) {
  checkoutVersion({ ...ctx, target: branch });
  mutate();
  stageProject(ctx);
  return commitVersion({ ...ctx, message, committedAt });
}

export function setupDivergedBranches(ctx: {
  rootDir: string;
  projectName: string;
}) {
  const base = initialCommit(ctx);
  createVersionBranch({ ...ctx, name: 'topic' });

  writeScreen(ctx.rootDir, ctx.projectName, 'alpha', 'main-side');
  stageProject(ctx);
  const mainTip = commitVersion({
    ...ctx,
    message: 'main change',
    committedAt: '2026-07-20T01:00:00.000Z',
  });

  checkoutVersion({ ...ctx, target: 'topic' });
  writeScreen(ctx.rootDir, ctx.projectName, 'beta', 'topic-side');
  stageProject(ctx);
  const topicTip = commitVersion({
    ...ctx,
    message: 'topic change',
    committedAt: '2026-07-20T01:01:00.000Z',
  });

  checkoutVersion({ ...ctx, target: 'main' });
  return { base, mainTip, topicTip };
}

/** criss-cross merge で ambiguous merge base を作る。 */
export function setupAmbiguousMergeBase(ctx: {
  rootDir: string;
  projectName: string;
}) {
  const base = initialCommit(ctx);
  createVersionBranch({ ...ctx, name: 'left' });
  createVersionBranch({ ...ctx, name: 'right', startPoint: base.commitHash });

  const left1 = commitOnBranch(
    ctx,
    'left',
    () => writeScreen(ctx.rootDir, ctx.projectName, 'alpha', 'left-1'),
    'left-1',
    '2026-07-20T02:00:00.000Z',
  );
  const right1 = commitOnBranch(
    ctx,
    'right',
    () => writeScreen(ctx.rootDir, ctx.projectName, 'beta', 'right-1'),
    'right-1',
    '2026-07-20T02:01:00.000Z',
  );

  checkoutVersion({ ...ctx, target: 'left' });
  const mergeOnLeft = mergeVersion({
    ...ctx,
    target: right1.commitHash,
    message: 'merge right into left',
    committedAt: '2026-07-20T02:02:00.000Z',
  });
  if (mergeOnLeft.outcome !== 'merged') {
    throw new Error(`mergeOnLeft expected merged, got ${mergeOnLeft.outcome}`);
  }

  checkoutVersion({ ...ctx, target: 'right' });
  const mergeOnRight = mergeVersion({
    ...ctx,
    target: left1.commitHash,
    message: 'merge left into right',
    committedAt: '2026-07-20T02:03:00.000Z',
  });
  if (mergeOnRight.outcome !== 'merged') {
    throw new Error(`mergeOnRight expected merged, got ${mergeOnRight.outcome}`);
  }

  const leftTip = commitOnBranch(
    ctx,
    'left',
    () => writeScreen(ctx.rootDir, ctx.projectName, 'alpha', 'left-2'),
    'left-2',
    '2026-07-20T02:04:00.000Z',
  );
  const rightTip = commitOnBranch(
    ctx,
    'right',
    () => writeScreen(ctx.rootDir, ctx.projectName, 'beta', 'right-2'),
    'right-2',
    '2026-07-20T02:05:00.000Z',
  );

  checkoutVersion({ ...ctx, target: 'main' });
  return {
    base,
    left1,
    right1,
    mergeOnLeft:
      mergeOnLeft.outcome === 'merged'
        ? { commitHash: mergeOnLeft.commitHash, treeHash: mergeOnLeft.treeHash }
        : null,
    mergeOnRight:
      mergeOnRight.outcome === 'merged'
        ? { commitHash: mergeOnRight.commitHash, treeHash: mergeOnRight.treeHash }
        : null,
    leftTip,
    rightTip,
  };
}

export function currentHeadCommit(ctx: {
  rootDir: string;
  projectName: string;
}): string {
  const head = readVersionHead(ctx);
  if (!head.commit) {
    throw new Error('HEAD commit がありません');
  }
  return head.commit;
}
