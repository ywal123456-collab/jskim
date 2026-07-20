import fs from 'node:fs';
import { computeContentRevision } from '../util/write-file-atomic.js';
import { loadScreenFeatures } from './load-features.js';
import { featuresFilePath } from './paths.js';
import type { ScreenFeature } from './types.js';

/** working tree 上の Feature 状態（mutation API / optimistic concurrency 用） */
export type ScreenFeatureWorkingState = {
  revision: string | null;
  sourceExists: boolean;
  features: ScreenFeature[];
  ungroupedScreenIds: string[];
};

/**
 * 永続化済み features.json の実 bytes から revision を計算する。
 * ファイルが無い場合は null。
 */
export function readFeaturesFileRevision(
  rootDir: string,
  projectName: string,
): string | null {
  const filePath = featuresFilePath(rootDir, projectName);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const bytes = fs.readFileSync(filePath);
  return computeContentRevision(bytes);
}

export function getScreenFeatureWorkingState(options: {
  rootDir: string;
  projectName: string;
  knownScreenIds: readonly string[];
}): ScreenFeatureWorkingState {
  const loaded = loadScreenFeatures(options);
  const revision = loaded.sourceExists
    ? readFeaturesFileRevision(options.rootDir, options.projectName)
    : null;
  return {
    revision,
    sourceExists: loaded.sourceExists,
    features: loaded.features,
    ungroupedScreenIds: loaded.ungroupedScreenIds,
  };
}
