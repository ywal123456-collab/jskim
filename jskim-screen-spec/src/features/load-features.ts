import fs from 'node:fs';
import { createFeatureError } from './errors.js';
import { featuresFilePath } from './paths.js';
import {
  computeUngroupedScreenIds,
  validateScreenFeatureFile,
} from './validate-features.js';
import type { LoadScreenFeaturesResult } from './types.js';

export type LoadScreenFeaturesOptions = {
  rootDir: string;
  projectName: string;
  knownScreenIds: readonly string[];
};

/**
 * features.json を読む。無い場合は全画面 Ungrouped（エラーにしない）。
 * 存在するが不正な場合は明示エラー（Ungrouped へ黙って fallback しない）。
 */
export function loadScreenFeatures(
  options: LoadScreenFeaturesOptions,
): LoadScreenFeaturesResult {
  const filePath = featuresFilePath(options.rootDir, options.projectName);
  if (!fs.existsSync(filePath)) {
    return {
      sourceExists: false,
      features: [],
      ungroupedScreenIds: [...options.knownScreenIds],
      document: { schemaVersion: '1.0', features: [] },
    };
  }

  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_FORMAT',
      'features.json を読み取れませんでした。',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw createFeatureError(
      'SPEC_FEATURE_INVALID_FORMAT',
      'features.json が不正な JSON です。',
    );
  }

  const document = validateScreenFeatureFile(parsed, {
    knownScreenIds: options.knownScreenIds,
  });

  return {
    sourceExists: true,
    features: document.features,
    ungroupedScreenIds: computeUngroupedScreenIds(
      options.knownScreenIds,
      document.features,
    ),
    document,
  };
}
