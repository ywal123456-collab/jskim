import { isValidScreenId } from '../util/screen-id.js';
import { projectBrowserSafeFeatureState } from './browser-safe-features.js';
import { createFeatureError } from './errors.js';
import {
  getScreenFeatureWorkingState,
  readFeaturesFileRevision,
} from './feature-revision.js';
import { withFeatureMutationLock } from './feature-mutation-lock.js';
import { persistScreenFeatures } from './persist-features.js';
import {
  MAX_DISPLAY_ORDER,
  MAX_FEATURE_DESCRIPTION_LENGTH,
  MAX_FEATURE_NAME_LENGTH,
  MIN_DISPLAY_ORDER,
  computeUngroupedScreenIds,
} from './validate-features.js';
import type {
  FeatureMutationResult,
  ScreenFeature,
  ScreenFeatureFile,
} from './types.js';

export type FeatureOperationContext = {
  rootDir: string;
  projectName: string;
  knownScreenIds: readonly string[];
};

function compareFeatures(a: ScreenFeature, b: ScreenFeature): number {
  if (a.displayOrder !== b.displayOrder) {
    return a.displayOrder - b.displayOrder;
  }
  if (a.featureId < b.featureId) return -1;
  if (a.featureId > b.featureId) return 1;
  return 0;
}

function assertExpectedRevisionPresent(
  expectedRevision: unknown,
): asserts expectedRevision is string | null {
  if (expectedRevision === undefined) {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      'expectedRevision は必須です。',
    );
  }
  if (expectedRevision !== null) {
    if (
      typeof expectedRevision !== 'string' ||
      !expectedRevision.startsWith('sha256:') ||
      expectedRevision.length <= 'sha256:'.length
    ) {
      throw createFeatureError(
        'SPEC_FEATURE_INVALID_INPUT',
        'expectedRevision の形式が不正です。',
      );
    }
  }
}

function verifyRevision(
  ctx: FeatureOperationContext,
  expectedRevision: string | null,
): void {
  const current = readFeaturesFileRevision(ctx.rootDir, ctx.projectName);
  if (expectedRevision !== current) {
    throw createFeatureError(
      'SPEC_FEATURE_REVISION_CONFLICT',
      'features.json は他の操作によって更新されています。最新状態を再読み込みしてください。',
      { expectedRevision, currentRevision: current },
    );
  }
}

function nextAppendDisplayOrder(features: readonly ScreenFeature[]): number {
  if (features.length === 0) {
    return MIN_DISPLAY_ORDER;
  }
  let max = MIN_DISPLAY_ORDER;
  for (const feature of features) {
    if (feature.displayOrder > max) {
      max = feature.displayOrder;
    }
  }
  const next = max + 10;
  if (next > MAX_DISPLAY_ORDER) {
    throw createFeatureError(
      'SPEC_FEATURE_DISPLAY_ORDER_LIMIT',
      `displayOrder の上限（${MAX_DISPLAY_ORDER}）に達しました。`,
    );
  }
  return next;
}

function reassignDisplayOrders(features: ScreenFeature[]): ScreenFeature[] {
  const out: ScreenFeature[] = [];
  let order = MIN_DISPLAY_ORDER;
  for (const feature of features) {
    if (order > MAX_DISPLAY_ORDER) {
      throw createFeatureError(
        'SPEC_FEATURE_DISPLAY_ORDER_LIMIT',
        `displayOrder の上限（${MAX_DISPLAY_ORDER}）に達しました。`,
      );
    }
    out.push({ ...feature, displayOrder: order });
    order += 10;
  }
  return out;
}

function normalizeName(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      `${label} は空でない文字列である必要があります。`,
    );
  }
  if (value.includes('\0')) {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      `${label} に NUL 文字は使用できません。`,
    );
  }
  if (value.length > MAX_FEATURE_NAME_LENGTH) {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      `${label} は${MAX_FEATURE_NAME_LENGTH}文字以内である必要があります。`,
    );
  }
  return value;
}

function normalizeDescription(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      'description は文字列である必要があります。',
    );
  }
  if (value.includes('\0')) {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      'description に NUL 文字は使用できません。',
    );
  }
  if (value.length > MAX_FEATURE_DESCRIPTION_LENGTH) {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      `description は${MAX_FEATURE_DESCRIPTION_LENGTH}文字以内である必要があります。`,
    );
  }
  return value;
}

function findFeatureIndex(
  features: readonly ScreenFeature[],
  featureId: string,
): number {
  return features.findIndex((f) => f.featureId === featureId);
}

function assertFeatureExists(
  features: readonly ScreenFeature[],
  featureId: string,
): ScreenFeature {
  const index = findFeatureIndex(features, featureId);
  if (index < 0) {
    throw createFeatureError(
      'SPEC_FEATURE_NOT_FOUND',
      `機能「${featureId}」は見つかりません。`,
    );
  }
  return features[index];
}

function assertKnownScreen(ctx: FeatureOperationContext, screenId: string): void {
  if (!ctx.knownScreenIds.includes(screenId)) {
    throw createFeatureError(
      'SPEC_FEATURE_UNKNOWN_SCREEN',
      `存在しない screenId です: ${screenId}`,
    );
  }
}

function buildMutationResult(
  ctx: FeatureOperationContext,
  status: FeatureMutationResult['status'],
  document: ScreenFeatureFile,
  revision: string | null,
  movedScreenIds?: string[],
): FeatureMutationResult {
  const features = document.features;
  return {
    status,
    revision,
    features,
    ungroupedScreenIds: computeUngroupedScreenIds(
      ctx.knownScreenIds,
      features,
    ),
    ...(movedScreenIds ? { movedScreenIds } : {}),
  };
}

function persistDocument(
  ctx: FeatureOperationContext,
  document: ScreenFeatureFile,
  expectedRevision: string | null,
): { persistStatus: 'created' | 'updated' | 'unchanged'; revision: string | null } {
  const result = persistScreenFeatures({
    rootDir: ctx.rootDir,
    projectName: ctx.projectName,
    knownScreenIds: ctx.knownScreenIds,
    document,
    expectedRevision,
  });
  return { persistStatus: result.status, revision: result.revision };
}

function documentsEqual(a: ScreenFeatureFile, b: ScreenFeatureFile): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cloneDocument(state: ScreenFeatureFile): ScreenFeatureFile {
  return {
    schemaVersion: '1.0',
    features: state.features.map((f) => ({
      featureId: f.featureId,
      name: f.name,
      ...(f.description !== undefined ? { description: f.description } : {}),
      displayOrder: f.displayOrder,
      screenIds: [...f.screenIds],
    })),
  };
}

function loadDocument(ctx: FeatureOperationContext): ScreenFeatureFile {
  const state = getScreenFeatureWorkingState(ctx);
  return cloneDocument({
    schemaVersion: '1.0',
    features: state.features,
  });
}

function runMutation(
  ctx: FeatureOperationContext,
  operation: string,
  expectedRevision: string | null,
  mutate: (document: ScreenFeatureFile) => {
    document: ScreenFeatureFile;
    status: FeatureMutationResult['status'];
    movedScreenIds?: string[];
  },
): Promise<FeatureMutationResult> {
  assertExpectedRevisionPresent(expectedRevision);
  return withFeatureMutationLock(ctx, operation, () => {
    verifyRevision(ctx, expectedRevision);
    const before = loadDocument(ctx);
    const { document, status, movedScreenIds } = mutate(before);
    if (documentsEqual(before, document)) {
      return buildMutationResult(
        ctx,
        'unchanged',
        document,
        readFeaturesFileRevision(ctx.rootDir, ctx.projectName),
        movedScreenIds,
      );
    }
    const { persistStatus, revision } = persistDocument(
      ctx,
      document,
      expectedRevision,
    );
    const finalStatus =
      persistStatus === 'unchanged'
        ? 'unchanged'
        : status === 'deleted'
          ? 'deleted'
          : persistStatus === 'created'
            ? 'created'
            : status;
    return buildMutationResult(ctx, finalStatus, document, revision, movedScreenIds);
  });
}

export function getScreenFeatureWorkingStatePublic(
  ctx: FeatureOperationContext,
) {
  return getScreenFeatureWorkingState(ctx);
}

export function projectFeatureMutationState(
  ctx: FeatureOperationContext,
  result: FeatureMutationResult,
) {
  return projectBrowserSafeFeatureState({
    revision: result.revision,
    sourceExists: result.revision !== null || result.features.length > 0,
    features: result.features,
    ungroupedScreenIds: result.ungroupedScreenIds,
  });
}

export function createScreenFeature(
  ctx: FeatureOperationContext,
  input: {
    featureId: unknown;
    name: unknown;
    description?: unknown;
    expectedRevision: unknown;
  },
): Promise<FeatureMutationResult> {
  assertExpectedRevisionPresent(input.expectedRevision);
  if (typeof input.featureId !== 'string' || !isValidScreenId(input.featureId)) {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      'featureId が不正です。半角英小文字・数字・ハイフンで指定してください。',
    );
  }
  const name = normalizeName(input.name, 'name');
  const description = normalizeDescription(input.description);
  return runMutation(ctx, 'create-feature', input.expectedRevision, (doc) => {
    if (findFeatureIndex(doc.features, input.featureId as string) >= 0) {
      throw createFeatureError(
        'SPEC_FEATURE_DUPLICATE_ID',
        `featureId が重複しています: ${input.featureId}`,
      );
    }
    const next: ScreenFeature = {
      featureId: input.featureId as string,
      name,
      displayOrder: nextAppendDisplayOrder(doc.features),
      screenIds: [],
      ...(description !== undefined ? { description } : {}),
    };
    return {
      document: {
        schemaVersion: '1.0',
        features: [...doc.features, next],
      },
      status: 'created',
    };
  });
}

export function updateScreenFeature(
  ctx: FeatureOperationContext,
  featureId: string,
  input: {
    name: unknown;
    description?: unknown;
    expectedRevision: unknown;
  },
): Promise<FeatureMutationResult> {
  assertExpectedRevisionPresent(input.expectedRevision);
  const name = normalizeName(input.name, 'name');
  const hasDescriptionField = Object.prototype.hasOwnProperty.call(
    input,
    'description',
  );
  const description = hasDescriptionField
    ? normalizeDescription(input.description)
    : undefined;
  return runMutation(ctx, 'update-feature', input.expectedRevision, (doc) => {
    const index = findFeatureIndex(doc.features, featureId);
    if (index < 0) {
      throw createFeatureError(
        'SPEC_FEATURE_NOT_FOUND',
        `機能「${featureId}」は見つかりません。`,
      );
    }
    const current = doc.features[index];
    const nextFeature: ScreenFeature = {
      featureId: current.featureId,
      name,
      displayOrder: current.displayOrder,
      screenIds: [...current.screenIds],
    };
    if (hasDescriptionField) {
      if (description !== undefined) {
        nextFeature.description = description;
      }
    } else if (current.description !== undefined) {
      nextFeature.description = current.description;
    }
    if (
      current.name === nextFeature.name &&
      current.description === nextFeature.description
    ) {
      return { document: doc, status: 'unchanged' };
    }
    const features = doc.features.slice();
    features[index] = nextFeature;
    return { document: { schemaVersion: '1.0', features }, status: 'updated' };
  });
}

export function deleteScreenFeature(
  ctx: FeatureOperationContext,
  featureId: string,
  expectedRevision: unknown,
): Promise<FeatureMutationResult> {
  assertExpectedRevisionPresent(expectedRevision);
  return runMutation(ctx, 'delete-feature', expectedRevision, (doc) => {
    const index = findFeatureIndex(doc.features, featureId);
    if (index < 0) {
      throw createFeatureError(
        'SPEC_FEATURE_NOT_FOUND',
        `機能「${featureId}」は見つかりません。`,
      );
    }
    const removed = doc.features[index];
    const features = doc.features.filter((f) => f.featureId !== featureId);
    return {
      document: { schemaVersion: '1.0', features },
      status: 'deleted',
      movedScreenIds: [...removed.screenIds],
    };
  });
}

export function reorderScreenFeatures(
  ctx: FeatureOperationContext,
  input: {
    orderedFeatureIds: unknown;
    expectedRevision: unknown;
  },
): Promise<FeatureMutationResult> {
  assertExpectedRevisionPresent(input.expectedRevision);
  if (!Array.isArray(input.orderedFeatureIds)) {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      'orderedFeatureIds は配列である必要があります。',
    );
  }
  const ordered = input.orderedFeatureIds;
  if (ordered.some((id) => typeof id !== 'string')) {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      'orderedFeatureIds の要素は文字列である必要があります。',
    );
  }
  return runMutation(ctx, 'reorder-features', input.expectedRevision, (doc) => {
    if (ordered.length !== doc.features.length) {
      throw createFeatureError(
        'SPEC_FEATURE_INVALID_INPUT',
        'orderedFeatureIds は現在の機能一覧と同じ件数である必要があります。',
      );
    }
    const seen = new Set<string>();
    const byId = new Map(doc.features.map((f) => [f.featureId, f]));
    const reordered: ScreenFeature[] = [];
    for (const id of ordered) {
      if (seen.has(id)) {
        throw createFeatureError(
          'SPEC_FEATURE_INVALID_INPUT',
          `orderedFeatureIds に重複があります: ${id}`,
        );
      }
      const feature = byId.get(id);
      if (!feature) {
        throw createFeatureError(
          'SPEC_FEATURE_NOT_FOUND',
          `未知の featureId です: ${id}`,
        );
      }
      seen.add(id);
      reordered.push(feature);
    }
    const nextFeatures = reassignDisplayOrders(reordered);
    const sameOrder = doc.features.every(
      (f, i) => f.featureId === nextFeatures[i]?.featureId,
    );
    if (sameOrder) {
      return { document: doc, status: 'unchanged' };
    }
    return {
      document: { schemaVersion: '1.0', features: nextFeatures },
      status: 'updated',
    };
  });
}

export function moveScreenToFeature(
  ctx: FeatureOperationContext,
  input: {
    screenId: unknown;
    targetFeatureId: unknown;
    targetIndex?: unknown;
    expectedRevision: unknown;
  },
): Promise<FeatureMutationResult> {
  assertExpectedRevisionPresent(input.expectedRevision);
  if (typeof input.screenId !== 'string') {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      'screenId が不正です。',
    );
  }
  assertKnownScreen(ctx, input.screenId);
  if (
    input.targetFeatureId !== null &&
    (typeof input.targetFeatureId !== 'string' ||
      !isValidScreenId(input.targetFeatureId))
  ) {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      'targetFeatureId が不正です。',
    );
  }
  let targetIndex: number | undefined;
  if (input.targetIndex !== undefined && input.targetIndex !== null) {
    if (
      typeof input.targetIndex !== 'number' ||
      !Number.isInteger(input.targetIndex) ||
      input.targetIndex < 0
    ) {
      throw createFeatureError(
        'SPEC_FEATURE_INVALID_INPUT',
        'targetIndex が不正です。',
      );
    }
    targetIndex = input.targetIndex;
  }

  return runMutation(ctx, 'move-screen', input.expectedRevision, (doc) => {
    const features = doc.features.map((f) => ({
      ...f,
      screenIds: f.screenIds.filter((id) => id !== input.screenId),
    }));

    if (input.targetFeatureId === null) {
      const alreadyUngrouped = !doc.features.some((f) =>
        f.screenIds.includes(input.screenId as string),
      );
      if (alreadyUngrouped) {
        return { document: doc, status: 'unchanged' };
      }
      return {
        document: { schemaVersion: '1.0', features },
        status: 'updated',
      };
    }

    const targetIdx = findFeatureIndex(features, input.targetFeatureId as string);
    if (targetIdx < 0) {
      throw createFeatureError(
        'SPEC_FEATURE_NOT_FOUND',
        `機能「${input.targetFeatureId}」は見つかりません。`,
      );
    }
    const target = features[targetIdx];
    const without = target.screenIds.filter((id) => id !== input.screenId);
    const insertAt =
      targetIndex === undefined ? without.length : targetIndex;
    if (insertAt < 0 || insertAt > without.length) {
      throw createFeatureError(
        'SPEC_FEATURE_INVALID_INPUT',
        'targetIndex が範囲外です。',
      );
    }
    const nextIds = without.slice();
    nextIds.splice(insertAt, 0, input.screenId as string);
    if (
      doc.features[targetIdx]?.screenIds.join('\0') === nextIds.join('\0') &&
      !doc.features.some(
        (f, i) => i !== targetIdx && f.screenIds.includes(input.screenId as string),
      )
    ) {
      return { document: doc, status: 'unchanged' };
    }
    features[targetIdx] = { ...target, screenIds: nextIds };
    return {
      document: { schemaVersion: '1.0', features },
      status: 'updated',
    };
  });
}

export function reorderFeatureScreens(
  ctx: FeatureOperationContext,
  featureId: string,
  input: {
    orderedScreenIds: unknown;
    expectedRevision: unknown;
  },
): Promise<FeatureMutationResult> {
  assertExpectedRevisionPresent(input.expectedRevision);
  if (!Array.isArray(input.orderedScreenIds)) {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      'orderedScreenIds は配列である必要があります。',
    );
  }
  const ordered = input.orderedScreenIds;
  if (ordered.some((id) => typeof id !== 'string')) {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      'orderedScreenIds の要素は文字列である必要があります。',
    );
  }

  return runMutation(
    ctx,
    'reorder-feature-screens',
    input.expectedRevision,
    (doc) => {
      const index = findFeatureIndex(doc.features, featureId);
      if (index < 0) {
        throw createFeatureError(
          'SPEC_FEATURE_NOT_FOUND',
          `機能「${featureId}」は見つかりません。`,
        );
      }
      const current = doc.features[index];
      if (ordered.length !== current.screenIds.length) {
        throw createFeatureError(
          'SPEC_FEATURE_INVALID_INPUT',
          'orderedScreenIds は当該機能の画面一覧と同じ件数である必要があります。',
        );
      }
      const seen = new Set<string>();
      const currentSet = new Set(current.screenIds);
      for (const id of ordered) {
        if (seen.has(id)) {
          throw createFeatureError(
            'SPEC_FEATURE_INVALID_INPUT',
            `orderedScreenIds に重複があります: ${id}`,
          );
        }
        if (!currentSet.has(id)) {
          throw createFeatureError(
            'SPEC_FEATURE_INVALID_INPUT',
            `orderedScreenIds に未知または他機能の screenId があります: ${id}`,
          );
        }
        seen.add(id);
      }
      if (current.screenIds.every((id, i) => id === ordered[i])) {
        return { document: doc, status: 'unchanged' };
      }
      const features = doc.features.slice();
      features[index] = { ...current, screenIds: [...ordered] };
      return {
        document: { schemaVersion: '1.0', features },
        status: 'updated',
      };
    },
  );
}

export function moveScreenFeatureDirection(
  ctx: FeatureOperationContext,
  featureId: string,
  input: {
    screenId: unknown;
    direction: unknown;
    expectedRevision: unknown;
  },
): Promise<FeatureMutationResult> {
  assertExpectedRevisionPresent(input.expectedRevision);
  if (typeof input.screenId !== 'string') {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      'screenId が不正です。',
    );
  }
  if (input.direction !== 'up' && input.direction !== 'down') {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      'direction は up または down である必要があります。',
    );
  }
  return runMutation(
    ctx,
    'move-feature-screen-step',
    input.expectedRevision,
    (doc) => {
      const feature = assertFeatureExists(doc.features, featureId);
      const index = feature.screenIds.indexOf(input.screenId as string);
      if (index < 0) {
        throw createFeatureError(
          'SPEC_FEATURE_UNKNOWN_SCREEN',
          `機能「${featureId}」に screenId がありません: ${input.screenId}`,
        );
      }
      const target =
        input.direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= feature.screenIds.length) {
        return { document: doc, status: 'unchanged' };
      }
      const nextIds = feature.screenIds.slice();
      const tmp = nextIds[index];
      nextIds[index] = nextIds[target];
      nextIds[target] = tmp;
      const features = doc.features.map((f) =>
        f.featureId === featureId ? { ...f, screenIds: nextIds } : f,
      );
      return {
        document: { schemaVersion: '1.0', features },
        status: 'updated',
      };
    },
  );
}

export function moveFeatureDirection(
  ctx: FeatureOperationContext,
  input: {
    featureId: unknown;
    direction: unknown;
    expectedRevision: unknown;
  },
): Promise<FeatureMutationResult> {
  assertExpectedRevisionPresent(input.expectedRevision);
  if (typeof input.featureId !== 'string') {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      'featureId が不正です。',
    );
  }
  if (input.direction !== 'up' && input.direction !== 'down') {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_INPUT',
      'direction は up または down である必要があります。',
    );
  }
  return runMutation(ctx, 'move-feature-step', input.expectedRevision, (doc) => {
    const sorted = [...doc.features].sort(compareFeatures);
    const index = sorted.findIndex((f) => f.featureId === input.featureId);
    if (index < 0) {
      throw createFeatureError(
        'SPEC_FEATURE_NOT_FOUND',
        `機能「${input.featureId}」は見つかりません。`,
      );
    }
    const target = input.direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= sorted.length) {
      return { document: doc, status: 'unchanged' };
    }
    const swapped = sorted.slice();
    const tmp = swapped[index];
    swapped[index] = swapped[target];
    swapped[target] = tmp;
    const nextFeatures = reassignDisplayOrders(swapped);
    return {
      document: { schemaVersion: '1.0', features: nextFeatures },
      status: 'updated',
    };
  });
}
