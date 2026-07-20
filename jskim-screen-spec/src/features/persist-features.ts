import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../util/write-file-atomic.js';
import { createFeatureError } from './errors.js';
import { featuresFilePath, featuresRelativePath } from './paths.js';
import {
  formatScreenFeatureFile,
  validateScreenFeatureFile,
} from './validate-features.js';
import type {
  PersistScreenFeaturesOptions,
  PersistScreenFeaturesResult,
} from './types.js';

/**
 * 検証済み Feature file を atomic に書き込む。
 * 読み込み時に自動 rewrite はしない（明示 persist のみ）。
 */
export function persistScreenFeatures(
  options: PersistScreenFeaturesOptions,
): PersistScreenFeaturesResult {
  const document = validateScreenFeatureFile(options.document, {
    knownScreenIds: options.knownScreenIds,
  });
  const content = formatScreenFeatureFile(document);
  const filePath = featuresFilePath(options.rootDir, options.projectName);
  const relativePath = featuresRelativePath(options.projectName);
  const existed = fs.existsSync(filePath);

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const result = writeFileAtomic(filePath, content);
    if (result.status === 'unchanged') {
      return { status: 'unchanged', relativePath };
    }
    return {
      status: existed ? 'updated' : 'created',
      relativePath,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EPERM' || code === 'EACCES') {
      throw createFeatureError(
        'SPEC_FEATURE_WRITE_FAILED',
        'features.json に書き込めませんでした。',
      );
    }
    throw createFeatureError(
      'SPEC_FEATURE_WRITE_FAILED',
      'features.json の書き込みに失敗しました。',
    );
  }
}
