import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  VersionControlError,
  assertValidOperationId,
  checkoutVersion,
  commitVersion,
  createOperationId,
  createVersionBranch,
  createWorkingSnapshot,
  getVersionLog,
  getVersionStatus,
  initVersionRepository,
  inspectVersionRecovery,
  listIncompleteTransactions,
  persistVersionAuthorConfig,
  readVersionHead,
  readVersionIndex,
  recoverVersionRepository,
  revertVersionCommit,
  stageProject,
  transactionJournalPath,
  transactionWorktreeRoot,
  writeTransactionJournal,
} from '../../src/version-control/index.js';
import { toBrowserSafeReferenceSource } from '../../src/reference-image/browser-safe-source.js';

const temps: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-vc-tx-'));
  temps.push(root);
  return root;
}

afterEach(() => {
  while (temps.length > 0) {
    const root = temps.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const TINY_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function writeScreen(
  root: string,
  project: string,
  id: string,
  label = id,
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
    itemOrder: [],
    excludedItems: {},
    items: {},
  });
}

function setup(): { rootDir: string; projectName: string } {
  const rootDir = tempRoot();
  const projectName = 'demo';
  writeScreen(rootDir, projectName, 'a');
  writeScreen(rootDir, projectName, 'b');
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

function initialCommit(ctx: { rootDir: string; projectName: string }) {
  stageProject(ctx);
  return commitVersion({
    ...ctx,
    message: 'initial',
    committedAt: '2026-07-20T00:00:00.000Z',
  });
}

describe('journal path セキュリティ', () => {
  it('不正な operationId と path traversal を拒否する', () => {
    expect(() => assertValidOperationId('../evil')).toThrow(VersionControlError);
    expect(() => assertValidOperationId('a/b')).toThrow(VersionControlError);
    expect(() => assertValidOperationId('a\\b')).toThrow(VersionControlError);
    expect(() => assertValidOperationId('C:\\x')).toThrow(VersionControlError);
    expect(() => assertValidOperationId('abs\0id')).toThrow(VersionControlError);

    const ctx = setup();
    const outside = path.join(ctx.rootDir, 'outside-marker.txt');
    fs.writeFileSync(outside, 'safe');
    const id = createOperationId();
    const journalPath = transactionJournalPath(
      ctx.rootDir,
      ctx.projectName,
      id,
    );
    expect(journalPath.includes('..')).toBe(false);
    expect(
      path
        .resolve(journalPath)
        .startsWith(
          path.resolve(
            transactionWorktreeRoot(ctx.rootDir, ctx.projectName, id),
            '..',
            '..',
          ),
        ),
    ).toBe(true);
    expect(fs.readFileSync(outside, 'utf8')).toBe('safe');
  });
});

describe('commit transaction fault injection', () => {
  it('ref 更新後の index 失敗は RECOVERY_REQUIRED で、recover 後に重複 commit しない', () => {
    const ctx = setup();
    const first = initialCommit(ctx);
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'v2');
    stageProject(ctx);

    expect(() =>
      commitVersion({
        ...ctx,
        message: 'fail-index',
        committedAt: '2026-07-20T01:00:00.000Z',
        adapters: {
          writeVersionIndex: () => {
            throw new Error('injected index failure');
          },
        },
      }),
    ).toThrowError(/RECOVERY_REQUIRED|recovery/);

    const head = readVersionHead(ctx);
    expect(head.commit).not.toBe(first.commitHash);
    const index = readVersionIndex(ctx);
    expect(index.baseCommit).toBe(first.commitHash);
    expect(listIncompleteTransactions(ctx).length).toBe(1);

    try {
      stageProject(ctx);
      expect.fail('should throw');
    } catch (error) {
      if (!(error instanceof VersionControlError)) throw error;
      expect(error.code).toBe('SPEC_VERSION_RECOVERY_REQUIRED');
    }
    try {
      commitVersion({ ...ctx, message: 'retry' });
      expect.fail('should throw');
    } catch (error) {
      if (!(error instanceof VersionControlError)) throw error;
      expect(error.code).toBe('SPEC_VERSION_RECOVERY_REQUIRED');
    }

    const plan = inspectVersionRecovery(ctx).plans[0];
    expect(plan?.recommendedAction).toBe('complete');
    expect(plan?.headState).toBe('new');
    expect(plan?.indexState).toBe('old');

    recoverVersionRepository({ ...ctx, confirm: true });
    expect(listIncompleteTransactions(ctx)).toEqual([]);
    expect(readVersionIndex(ctx).baseCommit).toBe(head.commit);
    expect(getVersionStatus(ctx).stagedChanges).toEqual([]);

    const beforeRetry = getVersionLog({ ...ctx, limit: 5 }).commits.length;
    writeScreen(ctx.rootDir, ctx.projectName, 'b', 'extra');
    stageProject(ctx);
    commitVersion({
      ...ctx,
      message: 'after-recovery',
      committedAt: '2026-07-20T01:01:00.000Z',
    });
    expect(getVersionLog({ ...ctx, limit: 5 }).commits.length).toBe(
      beforeRetry + 1,
    );
  });

  it('detached HEAD でも同じ commit point 契約', () => {
    const ctx = setup();
    const first = initialCommit(ctx);
    checkoutVersion({ ...ctx, target: first.commitHash });
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'det');
    stageProject(ctx);

    expect(() =>
      commitVersion({
        ...ctx,
        message: 'detached-fail',
        committedAt: '2026-07-20T01:10:00.000Z',
        adapters: {
          writeVersionIndex: () => {
            throw new Error('injected');
          },
        },
      }),
    ).toThrowError(/RECOVERY_REQUIRED|recovery/);

    const head = readVersionHead(ctx);
    expect(head.ref).toBeNull();
    expect(head.commit).not.toBe(first.commitHash);
    recoverVersionRepository({ ...ctx, confirm: true });
    expect(readVersionIndex(ctx).baseCommit).toBe(head.commit);
  });

  it('ref 更新前の失敗は journal を掃除し old index を維持', () => {
    const ctx = setup();
    const first = initialCommit(ctx);
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'v3');
    stageProject(ctx);

    expect(() =>
      commitVersion({
        ...ctx,
        message: 'fail-ref',
        committedAt: '2026-07-20T01:20:00.000Z',
        adapters: {
          compareAndSwapVersionRef: () => {
            throw new VersionControlError(
              'SPEC_VERSION_REF_CONFLICT',
              'injected ref conflict',
            );
          },
        },
      }),
    ).toThrow(VersionControlError);

    expect(readVersionHead(ctx).commit).toBe(first.commitHash);
    expect(readVersionIndex(ctx).baseCommit).toBe(first.commitHash);
    expect(listIncompleteTransactions(ctx)).toEqual([]);
  });
});

describe('checkout transaction fault injection', () => {
  it('source_installed + HEAD old は safe rollback', () => {
    const ctx = setup();
    const c1 = initialCommit(ctx);
    writeScreen(ctx.rootDir, ctx.projectName, 'c');
    stageProject(ctx);
    const c2 = commitVersion({
      ...ctx,
      message: 'add c',
      committedAt: '2026-07-20T02:00:00.000Z',
    });
    createVersionBranch({
      ...ctx,
      name: 'old',
      startPoint: c1.commitHash,
    });

    let phaseHits = 0;
    expect(() =>
      checkoutVersion({
        ...ctx,
        target: 'old',
        adapters: {
          updateTransactionPhase: (options) => {
            const next = {
              ...options.journal,
              phase: options.phase,
            };
            writeTransactionJournal({
              rootDir: options.rootDir,
              projectName: options.projectName,
              journal: next,
            });
            phaseHits += 1;
            if (options.phase === 'source_installed') {
              throw new Error('crash after source_installed');
            }
            return next;
          },
        },
      }),
    ).toThrow();

    // catch 内 rollback で source/index が old に戻るか、journal が残る
    const head = readVersionHead(ctx);
    expect(head.commit).toBe(c2.commitHash);
    const working = createWorkingSnapshot(ctx).rootTreeHash;
    // rollback 成功時は c2 tree、失敗して journal 残りなら recovery
    const incomplete = listIncompleteTransactions(ctx);
    if (incomplete.length > 0) {
      const plan = inspectVersionRecovery(ctx).plans[0];
      expect(plan?.recommendedAction).toBe('rollback');
      recoverVersionRepository({ ...ctx, confirm: true });
    }
    expect(createWorkingSnapshot(ctx).rootTreeHash).toBe(working);
    expect(readVersionHead(ctx).commit).toBe(c2.commitHash);
    expect(phaseHits).toBeGreaterThan(0);
    expect(getVersionStatus(ctx).clean).toBe(true);
  });

  it('HEAD new + index old は forward recovery', () => {
    const ctx = setup();
    const c1 = initialCommit(ctx);
    writeScreen(ctx.rootDir, ctx.projectName, 'c');
    stageProject(ctx);
    commitVersion({
      ...ctx,
      message: 'add c',
      committedAt: '2026-07-20T02:10:00.000Z',
    });
    createVersionBranch({
      ...ctx,
      name: 'old',
      startPoint: c1.commitHash,
    });

    expect(() =>
      checkoutVersion({
        ...ctx,
        target: 'old',
        adapters: {
          writeVersionIndex: () => {
            throw new Error('injected index');
          },
        },
      }),
    ).toThrowError(/RECOVERY_REQUIRED|recovery/);

    const plan = inspectVersionRecovery(ctx).plans[0];
    expect(plan?.headState).toBe('new');
    expect(plan?.indexState).toBe('old');
    expect(plan?.recommendedAction).toBe('complete');

    recoverVersionRepository({ ...ctx, confirm: true });
    expect(readVersionHead(ctx).commit).toBe(c1.commitHash);
    expect(readVersionIndex(ctx).baseCommit).toBe(c1.commitHash);
    expect(getVersionStatus(ctx).clean).toBe(true);
  });

  it('crash 後にユーザーが source を改変すると unsafe', () => {
    const ctx = setup();
    const c1 = initialCommit(ctx);
    writeScreen(ctx.rootDir, ctx.projectName, 'c');
    stageProject(ctx);
    const c2 = commitVersion({
      ...ctx,
      message: 'add c',
      committedAt: '2026-07-20T02:20:00.000Z',
    });
    createVersionBranch({
      ...ctx,
      name: 'old',
      startPoint: c1.commitHash,
    });

    // 残留 journal を掃除してから、改変済み source の incomplete 状態を手書きする
    for (const leftover of listIncompleteTransactions(ctx)) {
      const jp = transactionJournalPath(
        ctx.rootDir,
        ctx.projectName,
        leftover.operationId,
      );
      if (fs.existsSync(jp)) fs.unlinkSync(jp);
    }

    const id = createOperationId();
    const oldTree = c2.treeHash;
    const head = readVersionHead(ctx);
    const index = readVersionIndex(ctx);
    writeTransactionJournal({
      ...ctx,
      journal: {
        schemaVersion: '1.0',
        operationId: id,
        operation: 'checkout',
        phase: 'source_installed',
        oldHead: {
          mode: 'symbolic',
          ref: 'refs/heads/main',
          commit: c2.commitHash,
        },
        newHead: {
          mode: 'symbolic',
          ref: 'refs/heads/old',
          commit: c1.commitHash,
        },
        oldIndex: {
          exists: true,
          revision: index.revision,
          baseCommit: index.baseCommit,
          tree: index.tree,
        },
        newIndex: {
          baseCommit: c1.commitHash,
          tree: c1.treeHash,
        },
        oldTree,
        newTree: c1.treeHash,
        sourceSwap: true,
      },
    });
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'user-edited-after-crash');

    const plan = inspectVersionRecovery(ctx).plans[0];
    expect(plan?.sourceState).toBe('other');
    expect(plan?.recommendedAction).toBe('unsafe');
    try {
      recoverVersionRepository({ ...ctx, confirm: true });
      expect.fail('should throw');
    } catch (error) {
      if (!(error instanceof VersionControlError)) throw error;
      expect(error.code).toBe('SPEC_VERSION_RECOVERY_UNSAFE');
    }
    expect(readVersionHead(ctx).commit).toBe(head.commit);
  });
});

describe('revert transaction fault injection', () => {
  it('source install 後の ref 失敗は old source へ rollback', () => {
    const ctx = setup();
    initialCommit(ctx);
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'v2');
    stageProject(ctx);
    const c2 = commitVersion({
      ...ctx,
      message: 'change',
      committedAt: '2026-07-20T03:00:00.000Z',
    });
    const before = createWorkingSnapshot(ctx).rootTreeHash;

    expect(() =>
      revertVersionCommit({
        ...ctx,
        target: c2.commitHash,
        committedAt: '2026-07-20T03:01:00.000Z',
        adapters: {
          compareAndSwapVersionRef: () => {
            throw new VersionControlError(
              'SPEC_VERSION_REF_CONFLICT',
              'injected',
            );
          },
        },
      }),
    ).toThrow(VersionControlError);

    expect(readVersionHead(ctx).commit).toBe(c2.commitHash);
    expect(createWorkingSnapshot(ctx).rootTreeHash).toBe(before);
    expect(listIncompleteTransactions(ctx)).toEqual([]);
  });

  it('ref 成功後の index 失敗は forward recovery', () => {
    const ctx = setup();
    initialCommit(ctx);
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'v2');
    stageProject(ctx);
    const c2 = commitVersion({
      ...ctx,
      message: 'change',
      committedAt: '2026-07-20T03:10:00.000Z',
    });

    expect(() =>
      revertVersionCommit({
        ...ctx,
        target: c2.commitHash,
        committedAt: '2026-07-20T03:11:00.000Z',
        adapters: {
          writeVersionIndex: () => {
            throw new Error('injected');
          },
        },
      }),
    ).toThrowError(/RECOVERY_REQUIRED|recovery/);

    const plan = inspectVersionRecovery(ctx).plans[0];
    expect(plan?.recommendedAction).toBe('complete');
    recoverVersionRepository({ ...ctx, confirm: true });
    expect(getVersionStatus(ctx).clean).toBe(true);
    expect(readVersionHead(ctx).commit).not.toBe(c2.commitHash);
  });
});

describe('same-commit HEAD mode と Capture/Figma round-trip', () => {
  it('tree が同じでも HEAD mode/ref が違えば transaction する', () => {
    const ctx = setup();
    const c1 = initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'review' });
    const switched = checkoutVersion({ ...ctx, target: 'review' });
    expect(switched.noop).toBe(false);
    expect(readVersionHead(ctx).ref).toBe('refs/heads/review');

    const detached = checkoutVersion({ ...ctx, target: c1.commitHash });
    expect(detached.headKind).toBe('detached');
    expect(detached.noop).toBe(false);

    const back = checkoutVersion({ ...ctx, target: 'main' });
    expect(back.headKind).toBe('symbolic');
    expect(readVersionHead(ctx).ref).toBe('refs/heads/main');
  });

  it('Device Capture PNG/meta と Figma source fileKey/nodeId を round-trip する', () => {
    const ctx = setup();
    const hex = crypto.createHash('sha256').update(TINY_PNG).digest('hex');
    const captureDir = path.join(
      ctx.rootDir,
      'spec',
      ctx.projectName,
      'src',
      'captures',
      'a',
      'default',
      'pc',
    );
    fs.mkdirSync(captureDir, { recursive: true });
    fs.writeFileSync(path.join(captureDir, `capture-${hex}.png`), TINY_PNG);
    writeJson(path.join(captureDir, 'meta.json'), {
      schemaVersion: '1.0',
      screenId: 'a',
      stateId: 'default',
      viewport: { id: 'pc', width: 1, height: 1 },
      format: 'png',
      fullPage: true,
      deviceScaleFactor: 1,
      inputRevision: `sha256:${hex}`,
      imageFile: `capture-${hex}.png`,
      imageRevision: `sha256:${hex}`,
      imageWidth: 1,
      imageHeight: 1,
      capturedAt: '2026-07-20T04:00:00.000Z',
    });

    const refDir = path.join(
      ctx.rootDir,
      'spec',
      ctx.projectName,
      'src',
      'references',
      'a',
      'pc',
    );
    fs.mkdirSync(refDir, { recursive: true });
    fs.writeFileSync(path.join(refDir, `reference-${hex}.png`), TINY_PNG);
    const figmaSource = {
      type: 'figma' as const,
      fileKey: 'FIGMAFILEKEY123',
      nodeId: '1:2',
      frameName: 'Frame',
      importedAt: '2026-07-20T04:00:00.000Z',
      exportScale: 1 as const,
    };
    writeJson(path.join(refDir, 'meta.json'), {
      schemaVersion: '1.0',
      screenId: 'a',
      viewport: { id: 'pc', width: 1, height: 1 },
      format: 'png',
      imageFile: `reference-${hex}.png`,
      imageRevision: `sha256:${hex}`,
      imageWidth: 1,
      imageHeight: 1,
      uploadedAt: '2026-07-20T04:00:00.000Z',
      source: figmaSource,
    });

    const snap = createWorkingSnapshot(ctx);
    expect(
      snap.logicalPaths.some((p) => p.includes('/captures/default/pc/')),
    ).toBe(true);
    stageProject(ctx);
    const committed = commitVersion({
      ...ctx,
      message: 'media',
      committedAt: '2026-07-20T04:01:00.000Z',
    });

    writeScreen(ctx.rootDir, ctx.projectName, 'b', 'touch');
    stageProject(ctx);
    commitVersion({
      ...ctx,
      message: 'touch',
      committedAt: '2026-07-20T04:02:00.000Z',
    });

    checkoutVersion({ ...ctx, target: committed.commitHash });
    const restoredCapture = JSON.parse(
      fs.readFileSync(path.join(captureDir, 'meta.json'), 'utf8'),
    ) as { imageRevision: string };
    expect(restoredCapture.imageRevision).toBe(`sha256:${hex}`);
    expect(fs.existsSync(path.join(captureDir, `capture-${hex}.png`))).toBe(
      true,
    );

    const restoredRef = JSON.parse(
      fs.readFileSync(path.join(refDir, 'meta.json'), 'utf8'),
    ) as {
      source: {
        type: string;
        fileKey?: string;
        nodeId?: string;
      };
    };
    expect(restoredRef.source.fileKey).toBe('FIGMAFILEKEY123');
    expect(restoredRef.source.nodeId).toBe('1:2');
    const browserSafe = toBrowserSafeReferenceSource(restoredRef.source);
    expect(browserSafe).not.toHaveProperty('fileKey');
    expect(browserSafe).not.toHaveProperty('nodeId');
  });
});

describe('incomplete transaction gate', () => {
  it('mutation を拒否し read-only は許可する', () => {
    const ctx = setup();
    const c1 = initialCommit(ctx);
    const id = createOperationId();
    const index = readVersionIndex(ctx);
    writeTransactionJournal({
      ...ctx,
      journal: {
        schemaVersion: '1.0',
        operationId: id,
        operation: 'commit',
        phase: 'ref_updated',
        oldHead: {
          mode: 'symbolic',
          ref: 'refs/heads/main',
          commit: c1.commitHash,
        },
        newHead: {
          mode: 'symbolic',
          ref: 'refs/heads/main',
          commit: c1.commitHash,
        },
        oldIndex: {
          exists: true,
          revision: index.revision,
          baseCommit: index.baseCommit,
          tree: index.tree,
        },
        newIndex: {
          baseCommit: c1.commitHash,
          tree: index.tree,
        },
        oldTree: index.tree,
        newTree: index.tree,
        sourceSwap: false,
      },
    });

    try {
      stageProject(ctx);
      expect.fail('should throw');
    } catch (error) {
      if (!(error instanceof VersionControlError)) throw error;
      expect(error.code).toBe('SPEC_VERSION_RECOVERY_REQUIRED');
    }
    try {
      createVersionBranch({ ...ctx, name: 'x' });
      expect.fail('should throw');
    } catch (error) {
      if (!(error instanceof VersionControlError)) throw error;
      expect(error.code).toBe('SPEC_VERSION_RECOVERY_REQUIRED');
    }
    expect(getVersionLog({ ...ctx, limit: 1 }).commits.length).toBe(1);
    expect(inspectVersionRecovery(ctx).recoveryRequired).toBe(true);
  });
});
