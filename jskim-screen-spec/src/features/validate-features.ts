import { isValidScreenId } from '../util/screen-id.js';
import { createFeatureError } from './errors.js';
import type { ScreenFeature, ScreenFeatureFile } from './types.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ROOT_KEYS = new Set(['schemaVersion', 'features']);
const FEATURE_KEYS = new Set([
  'featureId',
  'name',
  'description',
  'displayOrder',
  'screenIds',
]);

export const MAX_FEATURE_NAME_LENGTH = 200;
export const MAX_FEATURE_DESCRIPTION_LENGTH = 10000;
export const MIN_DISPLAY_ORDER = 1;
export const MAX_DISPLAY_ORDER = 1_000_000;

export type ValidateScreenFeatureFileOptions = {
  knownScreenIds: readonly string[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertNoForbiddenKeys(
  keys: string[],
  label: string,
): void {
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw createFeatureError(
        'SPEC_FEATURE_INVALID_FORMAT',
        `${label} に禁止されたキーが含まれています。`,
      );
    }
  }
}

function compareFeatures(a: ScreenFeature, b: ScreenFeature): number {
  if (a.displayOrder !== b.displayOrder) {
    return a.displayOrder - b.displayOrder;
  }
  if (a.featureId < b.featureId) return -1;
  if (a.featureId > b.featureId) return 1;
  return 0;
}

/**
 * Feature file を検証し、ソート済みの正規化 document を返す。
 * 呼び出し元が渡した knownScreenIds に無い screenId 参照はエラー。
 */
export function validateScreenFeatureFile(
  value: unknown,
  options: ValidateScreenFeatureFileOptions,
): ScreenFeatureFile {
  if (!isPlainObject(value)) {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_FORMAT',
      'features.json のルートはオブジェクトである必要があります。',
    );
  }

  const keys = Object.keys(value);
  assertNoForbiddenKeys(keys, 'features.json');
  for (const key of keys) {
    if (!ROOT_KEYS.has(key)) {
      throw createFeatureError(
        'SPEC_FEATURE_INVALID_FORMAT',
        `features.json に未対応のフィールドがあります: ${key}`,
      );
    }
  }

  if (value.schemaVersion !== '1.0') {
    throw createFeatureError(
      'SPEC_FEATURE_UNSUPPORTED_SCHEMA',
      '未対応の features schemaVersion です。"1.0" を指定してください。',
    );
  }

  if (!Array.isArray(value.features)) {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_FORMAT',
      'features は配列である必要があります。',
    );
  }

  const known = new Set(options.knownScreenIds);
  const seenFeatureIds = new Set<string>();
  const seenOrders = new Set<number>();
  const seenScreens = new Set<string>();
  const features: ScreenFeature[] = [];

  for (let i = 0; i < value.features.length; i += 1) {
    const raw = value.features[i];
    if (!isPlainObject(raw)) {
      throw createFeatureError(
        'SPEC_FEATURE_INVALID_FORMAT',
        `features[${i}] はオブジェクトである必要があります。`,
      );
    }
    const fKeys = Object.keys(raw);
    assertNoForbiddenKeys(fKeys, `features[${i}]`);
    for (const key of fKeys) {
      if (!FEATURE_KEYS.has(key)) {
        throw createFeatureError(
          'SPEC_FEATURE_INVALID_FORMAT',
          `features[${i}] に未対応のフィールドがあります: ${key}`,
        );
      }
    }

    if (!isValidScreenId(raw.featureId)) {
      throw createFeatureError(
        'SPEC_FEATURE_INVALID_FORMAT',
        `features[${i}].featureId が不正です。`,
      );
    }
    const featureId = raw.featureId;
    if (seenFeatureIds.has(featureId)) {
      throw createFeatureError(
        'SPEC_FEATURE_DUPLICATE_ID',
        `featureId が重複しています: ${featureId}`,
      );
    }
    seenFeatureIds.add(featureId);

    if (typeof raw.name !== 'string' || raw.name.trim() === '') {
      throw createFeatureError(
        'SPEC_FEATURE_INVALID_FORMAT',
        `features[${i}].name は空でない文字列である必要があります。`,
      );
    }
    if (raw.name.length > MAX_FEATURE_NAME_LENGTH) {
      throw createFeatureError(
        'SPEC_FEATURE_INVALID_FORMAT',
        `features[${i}].name は${MAX_FEATURE_NAME_LENGTH}文字以内である必要があります。`,
      );
    }

    let description: string | undefined;
    if (raw.description !== undefined) {
      if (typeof raw.description !== 'string') {
        throw createFeatureError(
          'SPEC_FEATURE_INVALID_FORMAT',
          `features[${i}].description は文字列である必要があります。`,
        );
      }
      if (raw.description.length > MAX_FEATURE_DESCRIPTION_LENGTH) {
        throw createFeatureError(
          'SPEC_FEATURE_INVALID_FORMAT',
          `features[${i}].description は${MAX_FEATURE_DESCRIPTION_LENGTH}文字以内である必要があります。`,
        );
      }
      description = raw.description;
    }

    if (
      typeof raw.displayOrder !== 'number' ||
      !Number.isSafeInteger(raw.displayOrder) ||
      raw.displayOrder < MIN_DISPLAY_ORDER ||
      raw.displayOrder > MAX_DISPLAY_ORDER
    ) {
      throw createFeatureError(
        'SPEC_FEATURE_INVALID_FORMAT',
        `features[${i}].displayOrder は ${MIN_DISPLAY_ORDER}〜${MAX_DISPLAY_ORDER} の整数である必要があります。`,
      );
    }
    const displayOrder = raw.displayOrder;
    if (seenOrders.has(displayOrder)) {
      throw createFeatureError(
        'SPEC_FEATURE_ORDER_CONFLICT',
        `displayOrder が重複しています: ${displayOrder}`,
      );
    }
    seenOrders.add(displayOrder);

    if (!Array.isArray(raw.screenIds)) {
      throw createFeatureError(
        'SPEC_FEATURE_INVALID_FORMAT',
        `features[${i}].screenIds は配列である必要があります。`,
      );
    }

    const screenIds: string[] = [];
    const localScreens = new Set<string>();
    for (let j = 0; j < raw.screenIds.length; j += 1) {
      const sid = raw.screenIds[j];
      if (!isValidScreenId(sid)) {
        throw createFeatureError(
          'SPEC_FEATURE_INVALID_FORMAT',
          `features[${i}].screenIds[${j}] が不正です。`,
        );
      }
      if (localScreens.has(sid)) {
        throw createFeatureError(
          'SPEC_FEATURE_DUPLICATE_MEMBERSHIP',
          `同一機能内で screenId が重複しています: ${sid}`,
        );
      }
      if (seenScreens.has(sid)) {
        throw createFeatureError(
          'SPEC_FEATURE_DUPLICATE_MEMBERSHIP',
          `同じ画面が複数の機能グループに属しています: ${sid}`,
        );
      }
      if (!known.has(sid)) {
        throw createFeatureError(
          'SPEC_FEATURE_UNKNOWN_SCREEN',
          `存在しない screenId が参照されています: ${sid}`,
        );
      }
      localScreens.add(sid);
      seenScreens.add(sid);
      screenIds.push(sid);
    }

    const feature: ScreenFeature = {
      featureId,
      name: raw.name,
      displayOrder,
      screenIds,
    };
    if (description !== undefined) {
      feature.description = description;
    }
    features.push(feature);
  }

  features.sort(compareFeatures);

  return {
    schemaVersion: '1.0',
    features,
  };
}

export function computeUngroupedScreenIds(
  knownScreenIds: readonly string[],
  features: readonly ScreenFeature[],
): string[] {
  const assigned = new Set<string>();
  for (const feature of features) {
    for (const id of feature.screenIds) {
      assigned.add(id);
    }
  }
  return knownScreenIds.filter((id) => !assigned.has(id));
}

/** 人が読む features.json 用（2 スペース・末尾 LF）。semantic は validate 後の並び。 */
export function formatScreenFeatureFile(document: ScreenFeatureFile): string {
  const sorted = {
    schemaVersion: document.schemaVersion,
    features: [...document.features].sort(compareFeatures).map((f) => {
      const row: Record<string, unknown> = {
        featureId: f.featureId,
        name: f.name,
        displayOrder: f.displayOrder,
        screenIds: f.screenIds,
      };
      if (f.description !== undefined) {
        row.description = f.description;
      }
      return row;
    }),
  };
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
