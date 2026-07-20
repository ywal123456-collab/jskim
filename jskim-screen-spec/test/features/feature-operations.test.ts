import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FeatureError,
  createScreenFeature,
  deleteScreenFeature,
  featureMutationLockPath,
  getScreenFeatureWorkingState,
  moveFeatureDirection,
  moveScreenToFeature,
  readFeaturesFileRevision,
  reorderFeatureScreens,
  reorderScreenFeatures,
  resetFeatureMutationLocksForTest,
  updateScreenFeature,
} from '../../src/features/index.js';
import type { FeatureOperationContext } from '../../src/features/index.js';

const knownScreenIds = ['screen-a', 'screen-b', 'screen-c', 'screen-d'] as const;

const temps: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-feat-op-'));
  temps.push(dir);
  return dir;
}

function makeCtx(root: string): FeatureOperationContext {
  return {
    rootDir: root,
    projectName: 'demo',
    knownScreenIds: [...knownScreenIds],
  };
}

function featuresPath(root: string): string {
  return path.join(root, 'spec', 'demo', 'src', 'features.json');
}

function featureErrorCode(err: unknown): string | undefined {
  return err instanceof FeatureError ? err.code : undefined;
}

async function expectFeatureErrorCode(
  fn: () => unknown | Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await fn();
    expect.fail('should throw');
  } catch (err) {
    expect(featureErrorCode(err)).toBe(code);
  }
}

afterEach(() => {
  resetFeatureMutationLocksForTest();
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('Feature operations (Phase 7E-5)', () => {
  it('features.json が無い状態で最初の機能を作成できる（expectedRevision null）', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    expect(getScreenFeatureWorkingState(ctx).revision).toBeNull();
    expect(fs.existsSync(featuresPath(root))).toBe(false);

    const result = await createScreenFeature(ctx, {
      featureId: 'inquiry',
      name: 'お問い合わせ',
      expectedRevision: null,
    });

    expect(result.status).toBe('created');
    expect(result.revision).toMatch(/^sha256:/);
    expect(result.features).toHaveLength(1);
    expect(result.features[0]).toMatchObject({
      featureId: 'inquiry',
      name: 'お問い合わせ',
      displayOrder: 1,
      screenIds: [],
    });
    expect(result.ungroupedScreenIds).toEqual([...knownScreenIds]);
    expect(fs.existsSync(featuresPath(root))).toBe(true);
  });

  it('重複 featureId を拒否する', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    let revision = (
      await createScreenFeature(ctx, {
        featureId: 'inquiry',
        name: 'A',
        expectedRevision: null,
      })
    ).revision;

    await expect(
      createScreenFeature(ctx, {
        featureId: 'inquiry',
        name: 'B',
        expectedRevision: revision,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return featureErrorCode(err) === 'SPEC_FEATURE_DUPLICATE_ID';
    });
  });

  it('不正な featureId / name を拒否する', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);

    await expectFeatureErrorCode(
      () =>
        createScreenFeature(ctx, {
          featureId: 'Invalid_ID',
          name: 'A',
          expectedRevision: null,
        }),
      'SPEC_FEATURE_INVALID_INPUT',
    );

    await expectFeatureErrorCode(
      () =>
        createScreenFeature(ctx, {
          featureId: 'valid-id',
          name: '   ',
          expectedRevision: null,
        }),
      'SPEC_FEATURE_INVALID_INPUT',
    );
  });

  it('作成時 displayOrder を末尾に追加する', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    const first = await createScreenFeature(ctx, {
      featureId: 'alpha',
      name: 'Alpha',
      expectedRevision: null,
    });
    const second = await createScreenFeature(ctx, {
      featureId: 'beta',
      name: 'Beta',
      expectedRevision: first.revision,
    });

    expect(first.features[0].displayOrder).toBe(1);
    expect(second.features.map((f) => f.featureId)).toEqual(['alpha', 'beta']);
    expect(second.features[1].displayOrder).toBe(11);
  });

  it('機能名・説明を更新し、同一内容は unchanged', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    let revision = (
      await createScreenFeature(ctx, {
        featureId: 'inquiry',
        name: '旧名称',
        description: '旧説明',
        expectedRevision: null,
      })
    ).revision;

    const updated = await updateScreenFeature(ctx, 'inquiry', {
      name: '新名称',
      description: '新説明',
      expectedRevision: revision,
    });
    expect(updated.status).toBe('updated');
    expect(updated.features[0]).toMatchObject({
      name: '新名称',
      description: '新説明',
    });
    revision = updated.revision;

    const unchanged = await updateScreenFeature(ctx, 'inquiry', {
      name: '新名称',
      description: '新説明',
      expectedRevision: revision,
    });
    expect(unchanged.status).toBe('unchanged');
    expect(unchanged.revision).toBe(revision);
  });

  it('機能削除で所属画面を Ungrouped へ戻す', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    let revision = (
      await createScreenFeature(ctx, {
        featureId: 'inquiry',
        name: 'お問い合わせ',
        expectedRevision: null,
      })
    ).revision;
    revision = (
      await moveScreenToFeature(ctx, {
        screenId: 'screen-a',
        targetFeatureId: 'inquiry',
        expectedRevision: revision,
      })
    ).revision;
    revision = (
      await moveScreenToFeature(ctx, {
        screenId: 'screen-b',
        targetFeatureId: 'inquiry',
        expectedRevision: revision,
      })
    ).revision;

    const deleted = await deleteScreenFeature(ctx, 'inquiry', revision);
    expect(deleted.status).toBe('deleted');
    expect(deleted.features).toEqual([]);
    expect(deleted.movedScreenIds).toEqual(['screen-a', 'screen-b']);
    expect(deleted.ungroupedScreenIds).toEqual([...knownScreenIds]);
  });

  it('最後の機能を削除しても空の features.json を残す', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    const revision = (
      await createScreenFeature(ctx, {
        featureId: 'only',
        name: 'Only',
        expectedRevision: null,
      })
    ).revision;

    const deleted = await deleteScreenFeature(ctx, 'only', revision);
    expect(deleted.status).toBe('deleted');
    expect(deleted.features).toEqual([]);
    expect(fs.existsSync(featuresPath(root))).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(featuresPath(root), 'utf8')) as {
      schemaVersion: string;
      features: unknown[];
    };
    expect(parsed.schemaVersion).toBe('1.0');
    expect(parsed.features).toEqual([]);
  });

  it('orderedFeatureIds で機能順を並べ替える', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    let revision = (
      await createScreenFeature(ctx, {
        featureId: 'alpha',
        name: 'Alpha',
        expectedRevision: null,
      })
    ).revision;
    revision = (
      await createScreenFeature(ctx, {
        featureId: 'beta',
        name: 'Beta',
        expectedRevision: revision,
      })
    ).revision;
    revision = (
      await createScreenFeature(ctx, {
        featureId: 'gamma',
        name: 'Gamma',
        expectedRevision: revision,
      })
    ).revision;

    const reordered = await reorderScreenFeatures(ctx, {
      orderedFeatureIds: ['gamma', 'alpha', 'beta'],
      expectedRevision: revision,
    });
    expect(reordered.status).toBe('updated');
    expect(reordered.features.map((f) => f.featureId)).toEqual([
      'gamma',
      'alpha',
      'beta',
    ]);
    expect(reordered.features.map((f) => f.displayOrder)).toEqual([1, 11, 21]);
  });

  it('不正な orderedFeatureIds を拒否する', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    let revision = (
      await createScreenFeature(ctx, {
        featureId: 'alpha',
        name: 'Alpha',
        expectedRevision: null,
      })
    ).revision;
    revision = (
      await createScreenFeature(ctx, {
        featureId: 'beta',
        name: 'Beta',
        expectedRevision: revision,
      })
    ).revision;

    await expect(
      reorderScreenFeatures(ctx, {
        orderedFeatureIds: ['alpha'],
        expectedRevision: revision,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return featureErrorCode(err) === 'SPEC_FEATURE_INVALID_INPUT';
    });

    await expect(
      reorderScreenFeatures(ctx, {
        orderedFeatureIds: ['alpha', 'alpha'],
        expectedRevision: revision,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return featureErrorCode(err) === 'SPEC_FEATURE_INVALID_INPUT';
    });

    await expect(
      reorderScreenFeatures(ctx, {
        orderedFeatureIds: ['alpha', 'missing'],
        expectedRevision: revision,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return featureErrorCode(err) === 'SPEC_FEATURE_NOT_FOUND';
    });
  });

  it('Ungrouped→機能、機能→機能、機能→Ungrouped を移動する', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    let revision = (
      await createScreenFeature(ctx, {
        featureId: 'src',
        name: 'Src',
        expectedRevision: null,
      })
    ).revision;
    revision = (
      await createScreenFeature(ctx, {
        featureId: 'dst',
        name: 'Dst',
        expectedRevision: revision,
      })
    ).revision;

    revision = (
      await moveScreenToFeature(ctx, {
        screenId: 'screen-a',
        targetFeatureId: 'src',
        expectedRevision: revision,
      })
    ).revision;
    expect(
      getScreenFeatureWorkingState(ctx).features.find((f) => f.featureId === 'src')
        ?.screenIds,
    ).toEqual(['screen-a']);

    revision = (
      await moveScreenToFeature(ctx, {
        screenId: 'screen-a',
        targetFeatureId: 'dst',
        expectedRevision: revision,
      })
    ).revision;
    expect(
      getScreenFeatureWorkingState(ctx).features.find((f) => f.featureId === 'dst')
        ?.screenIds,
    ).toEqual(['screen-a']);

    revision = (
      await moveScreenToFeature(ctx, {
        screenId: 'screen-a',
        targetFeatureId: null,
        expectedRevision: revision,
      })
    ).revision;
    expect(getScreenFeatureWorkingState(ctx).ungroupedScreenIds).toEqual([
      ...knownScreenIds,
    ]);
    expect(revision).toMatch(/^sha256:/);
  });

  it('同一配置への移動は unchanged', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    let revision = (
      await createScreenFeature(ctx, {
        featureId: 'inquiry',
        name: 'Inquiry',
        expectedRevision: null,
      })
    ).revision;
    revision = (
      await moveScreenToFeature(ctx, {
        screenId: 'screen-a',
        targetFeatureId: 'inquiry',
        expectedRevision: revision,
      })
    ).revision;

    const sameFeature = await moveScreenToFeature(ctx, {
      screenId: 'screen-a',
      targetFeatureId: 'inquiry',
      expectedRevision: revision,
    });
    expect(sameFeature.status).toBe('unchanged');

    revision = (
      await moveScreenToFeature(ctx, {
        screenId: 'screen-a',
        targetFeatureId: null,
        expectedRevision: revision,
      })
    ).revision;

    const sameUngrouped = await moveScreenToFeature(ctx, {
      screenId: 'screen-a',
      targetFeatureId: null,
      expectedRevision: revision,
    });
    expect(sameUngrouped.status).toBe('unchanged');
  });

  it('targetIndex で機能内の挿入位置を指定する', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    let revision = (
      await createScreenFeature(ctx, {
        featureId: 'inquiry',
        name: 'Inquiry',
        expectedRevision: null,
      })
    ).revision;
    revision = (
      await moveScreenToFeature(ctx, {
        screenId: 'screen-a',
        targetFeatureId: 'inquiry',
        expectedRevision: revision,
      })
    ).revision;
    revision = (
      await moveScreenToFeature(ctx, {
        screenId: 'screen-b',
        targetFeatureId: 'inquiry',
        expectedRevision: revision,
      })
    ).revision;

    const moved = await moveScreenToFeature(ctx, {
      screenId: 'screen-c',
      targetFeatureId: 'inquiry',
      targetIndex: 0,
      expectedRevision: revision,
    });
    expect(moved.status).toBe('updated');
    expect(
      moved.features.find((f) => f.featureId === 'inquiry')?.screenIds,
    ).toEqual(['screen-c', 'screen-a', 'screen-b']);
  });

  it('機能内 screenIds を並べ替える', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    let revision = (
      await createScreenFeature(ctx, {
        featureId: 'inquiry',
        name: 'Inquiry',
        expectedRevision: null,
      })
    ).revision;
    for (const screenId of ['screen-a', 'screen-b', 'screen-c'] as const) {
      revision = (
        await moveScreenToFeature(ctx, {
          screenId,
          targetFeatureId: 'inquiry',
          expectedRevision: revision,
        })
      ).revision;
    }

    const reordered = await reorderFeatureScreens(ctx, 'inquiry', {
      orderedScreenIds: ['screen-c', 'screen-a', 'screen-b'],
      expectedRevision: revision,
    });
    expect(reordered.status).toBe('updated');
    expect(
      reordered.features.find((f) => f.featureId === 'inquiry')?.screenIds,
    ).toEqual(['screen-c', 'screen-a', 'screen-b']);
  });

  it('未知の screenId / featureId を拒否する', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    const revision = (
      await createScreenFeature(ctx, {
        featureId: 'inquiry',
        name: 'Inquiry',
        expectedRevision: null,
      })
    ).revision;

    await expectFeatureErrorCode(
      () =>
        moveScreenToFeature(ctx, {
          screenId: 'missing-screen',
          targetFeatureId: 'inquiry',
          expectedRevision: revision,
        }),
      'SPEC_FEATURE_UNKNOWN_SCREEN',
    );

    await expectFeatureErrorCode(
      () =>
        updateScreenFeature(ctx, 'missing-feature', {
          name: 'X',
          expectedRevision: revision,
        }),
      'SPEC_FEATURE_NOT_FOUND',
    );
  });

  it('revision 不一致は SPEC_FEATURE_REVISION_CONFLICT', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    await createScreenFeature(ctx, {
      featureId: 'inquiry',
      name: 'Inquiry',
      expectedRevision: null,
    });

    await expect(
      createScreenFeature(ctx, {
        featureId: 'other',
        name: 'Other',
        expectedRevision: null,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof FeatureError &&
        err.code === 'SPEC_FEATURE_REVISION_CONFLICT'
      );
    });
  });

  it('expectedRevision 未指定は SPEC_FEATURE_INVALID_INPUT', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);

    await expectFeatureErrorCode(
      () =>
        createScreenFeature(ctx, {
          featureId: 'inquiry',
          name: 'Inquiry',
          expectedRevision: undefined,
        }),
      'SPEC_FEATURE_INVALID_INPUT',
    );
  });

  it('並行 mutation は直列化されるか IN_PROGRESS になる', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    const lockPath = featureMutationLockPath(root, 'demo');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      `${JSON.stringify({
        schemaVersion: '1.0',
        operation: 'held-lock',
        pid: process.pid,
        startedAt: new Date().toISOString(),
        operationId: 'test-lock',
      })}\n`,
      { flag: 'wx' },
    );

    await expect(
      createScreenFeature(ctx, {
        featureId: 'blocked',
        name: 'Blocked',
        expectedRevision: null,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return featureErrorCode(err) === 'SPEC_FEATURE_IN_PROGRESS';
    });

    fs.unlinkSync(lockPath);

    const [first, second] = await Promise.allSettled([
      createScreenFeature(ctx, {
        featureId: 'parallel-a',
        name: 'A',
        expectedRevision: null,
      }),
      createScreenFeature(ctx, {
        featureId: 'parallel-b',
        name: 'B',
        expectedRevision: null,
      }),
    ]);

    const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
    const rejected = [first, second].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0].status === 'rejected') {
      expect(featureErrorCode(rejected[0].reason)).toBe(
        'SPEC_FEATURE_REVISION_CONFLICT',
      );
    }
  });

  it('書き込み失敗時は既存 features.json を保持する', async (context) => {
    if (process.platform === 'win32') {
      context.skip();
      return;
    }

    const root = tempRoot();
    const ctx = makeCtx(root);
    const revision = (
      await createScreenFeature(ctx, {
        featureId: 'inquiry',
        name: 'Inquiry',
        expectedRevision: null,
      })
    ).revision;
    const filePath = featuresPath(root);
    const before = fs.readFileSync(filePath);

    try {
      fs.chmodSync(filePath, 0o444);
    } catch {
      context.skip();
      return;
    }

    try {
      await expectFeatureErrorCode(
        () =>
          updateScreenFeature(ctx, 'inquiry', {
            name: 'Updated',
            expectedRevision: revision,
          }),
        'SPEC_FEATURE_WRITE_FAILED',
      );
      expect(Buffer.compare(before, fs.readFileSync(filePath))).toBe(0);
    } finally {
      fs.chmodSync(filePath, 0o644);
    }
  });

  it('getScreenFeatureWorkingState は browser-safe 投影に使える working state を返す', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    expect(getScreenFeatureWorkingState(ctx)).toMatchObject({
      revision: null,
      sourceExists: false,
      features: [],
      ungroupedScreenIds: [...knownScreenIds],
    });

    let revision = (
      await createScreenFeature(ctx, {
        featureId: 'inquiry',
        name: 'お問い合わせ',
        description: '説明',
        expectedRevision: null,
      })
    ).revision;
    revision = (
      await moveScreenToFeature(ctx, {
        screenId: 'screen-a',
        targetFeatureId: 'inquiry',
        expectedRevision: revision,
      })
    ).revision;

    const state = getScreenFeatureWorkingState(ctx);
    expect(state.sourceExists).toBe(true);
    expect(state.revision).toBe(readFeaturesFileRevision(root, 'demo'));
    expect(state.features[0]).toMatchObject({
      featureId: 'inquiry',
      name: 'お問い合わせ',
      description: '説明',
      screenIds: ['screen-a'],
    });
    expect(state.ungroupedScreenIds).toEqual([
      'screen-b',
      'screen-c',
      'screen-d',
    ]);

    const browserSafeFeatures = state.features.map(
      ({ featureId, name, displayOrder, screenIds }) => ({
        featureId,
        name,
        displayOrder,
        screenIds: [...screenIds],
      }),
    );
    expect(browserSafeFeatures[0]).not.toHaveProperty('description');
    expect(browserSafeFeatures[0]).toEqual({
      featureId: 'inquiry',
      name: 'お問い合わせ',
      displayOrder: 1,
      screenIds: ['screen-a'],
    });
  });

  it('moveFeatureDirection で機能順を1段階移動する', async () => {
    const root = tempRoot();
    const ctx = makeCtx(root);
    let revision = (
      await createScreenFeature(ctx, {
        featureId: 'alpha',
        name: 'Alpha',
        expectedRevision: null,
      })
    ).revision;
    revision = (
      await createScreenFeature(ctx, {
        featureId: 'beta',
        name: 'Beta',
        expectedRevision: revision,
      })
    ).revision;

    const moved = await moveFeatureDirection(ctx, {
      featureId: 'beta',
      direction: 'up',
      expectedRevision: revision,
    });
    expect(moved.status).toBe('updated');
    expect(moved.features.map((f) => f.featureId)).toEqual(['beta', 'alpha']);
  });
});
