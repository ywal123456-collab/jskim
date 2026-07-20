import { afterEach, describe, expect, it } from 'vitest';
import { mergeFeaturesDocument } from '../../src/version-control/merge-features.js';
import { canonicalizeJsonBytes } from '../../src/version-control/canonical-json.js';
import {
  cleanupTemps,
  setupProject,
  writeFeatures,
  writeScreen,
} from './merge-test-helpers.js';

afterEach(() => {
  cleanupTemps();
});

const knownScreenIds = ['alpha', 'beta', 'gamma'] as const;

function featuresBytes(
  features: Array<{
    featureId: string;
    name: string;
    displayOrder: number;
    screenIds: string[];
    description?: string;
  }>,
): Buffer {
  return canonicalizeJsonBytes({
    schemaVersion: '1.0',
    features,
  });
}

describe('mergeFeaturesDocument', () => {
  it('base から片側のみ feature 追加なら採用する', () => {
    const ctx = setupProject({ screens: [...knownScreenIds] });
    writeFeatures(ctx.rootDir, ctx.projectName, [
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
    ]);
    const base = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
    ]);
    const ours = base;
    const theirs = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
      {
        featureId: 'sub',
        name: 'サブ',
        displayOrder: 2,
        screenIds: ['beta'],
      },
    ]);

    const result = mergeFeaturesDocument({
      knownScreenIds,
      base,
      ours,
      theirs,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.features.map((f) => f.featureId)).toEqual([
      'main',
      'sub',
    ]);
  });

  it('feature 名の両側変更は conflict', () => {
    const base = featuresBytes([
      {
        featureId: 'main',
        name: '旧名',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
    ]);
    const ours = featuresBytes([
      {
        featureId: 'main',
        name: 'ours名',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
    ]);
    const theirs = featuresBytes([
      {
        featureId: 'main',
        name: 'theirs名',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
    ]);
    const result = mergeFeaturesDocument({
      knownScreenIds,
      base,
      ours,
      theirs,
    });
    expect(result.ok).toBe(false);
  });

  it('displayOrder の両側変更は reorder conflict', () => {
    const base = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
    ]);
    const ours = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 10,
        screenIds: ['alpha'],
      },
    ]);
    const theirs = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 20,
        screenIds: ['alpha'],
      },
    ]);
    expect(
      mergeFeaturesDocument({ knownScreenIds, base, ours, theirs }).ok,
    ).toBe(false);
  });

  it('screenIds の両側変更は conflict', () => {
    const base = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
    ]);
    const ours = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha', 'beta'],
      },
    ]);
    const theirs = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha', 'gamma'],
      },
    ]);
    expect(
      mergeFeaturesDocument({ knownScreenIds, base, ours, theirs }).ok,
    ).toBe(false);
  });

  it('画面の競合する move（二重所属）は conflict', () => {
    const base = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
      {
        featureId: 'sub',
        name: 'サブ',
        displayOrder: 2,
        screenIds: ['beta'],
      },
    ]);
    const ours = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha', 'beta'],
      },
      {
        featureId: 'sub',
        name: 'サブ',
        displayOrder: 2,
        screenIds: [],
      },
    ]);
    const theirs = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
      {
        featureId: 'sub',
        name: 'サブ',
        displayOrder: 2,
        screenIds: ['beta', 'gamma'],
      },
    ]);
    expect(
      mergeFeaturesDocument({ knownScreenIds, base, ours, theirs }).ok,
    ).toBe(false);
  });

  it('片側削除・片側変更は conflict', () => {
    const base = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
      {
        featureId: 'legacy',
        name: '旧機能',
        displayOrder: 2,
        screenIds: ['beta'],
      },
    ]);
    const ours = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
    ]);
    const theirs = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
      {
        featureId: 'legacy',
        name: '旧機能改',
        displayOrder: 2,
        screenIds: ['beta', 'gamma'],
      },
    ]);
    expect(
      mergeFeaturesDocument({ knownScreenIds, base, ours, theirs }).ok,
    ).toBe(false);
  });

  it('description の両側変更は conflict', () => {
    const base = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        description: 'base',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
    ]);
    const ours = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        description: 'ours',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
    ]);
    const theirs = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        description: 'theirs',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
    ]);
    expect(
      mergeFeaturesDocument({ knownScreenIds, base, ours, theirs }).ok,
    ).toBe(false);
  });

  it('features.json path merge は clean 3-way を合成する', () => {
    const ctx = setupProject({ screens: [...knownScreenIds], features: true });
    writeFeatures(ctx.rootDir, ctx.projectName, [
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
      {
        featureId: 'sub',
        name: 'サブ',
        displayOrder: 2,
        screenIds: [],
      },
    ]);
    writeScreen(ctx.rootDir, ctx.projectName, 'gamma', 'gamma');
    const base = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
    ]);
    const ours = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha', 'beta'],
      },
    ]);
    const theirs = featuresBytes([
      {
        featureId: 'main',
        name: 'メイン',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
      {
        featureId: 'sub',
        name: 'サブ',
        displayOrder: 2,
        screenIds: ['gamma'],
      },
    ]);
    const result = mergeFeaturesDocument({
      knownScreenIds,
      base,
      ours,
      theirs,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.features.map((f) => f.featureId)).toEqual([
      'main',
      'sub',
    ]);
    expect(
      result.document.features.find((f) => f.featureId === 'main')?.screenIds,
    ).toEqual(['alpha', 'beta']);
    expect(
      result.document.features.find((f) => f.featureId === 'sub')?.screenIds,
    ).toEqual(['gamma']);
  });
});
