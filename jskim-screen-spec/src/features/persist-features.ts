import fs from 'node:fs';
import path from 'node:path';
import {
  computeContentRevision,
  writeFileAtomic,
} from '../util/write-file-atomic.js';
import { createFeatureError } from './errors.js';
import { featuresFilePath, featuresRelativePath } from './paths.js';
import { readFeaturesFileRevision } from './feature-revision.js';
import {
  formatScreenFeatureFile,
  validateScreenFeatureFile,
} from './validate-features.js';
import type {
  PersistScreenFeaturesOptions,
  PersistScreenFeaturesResult,
} from './types.js';

function revisionConflict(
  expectedRevision: string | null,
  currentRevision: string | null,
): never {
  throw createFeatureError(
    'SPEC_FEATURE_REVISION_CONFLICT',
    'features.json は他の操作によって更新されています。最新状態を再読み込みしてください。',
    { expectedRevision, currentRevision },
  );
}

/**
 * 検証済み Feature file を atomic に書き込む。
 * expectedRevision 指定時は optimistic concurrency を適用する。
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

  if (Object.prototype.hasOwnProperty.call(options, 'expectedRevision')) {
    const expected = options.expectedRevision ?? null;
    const current = readFeaturesFileRevision(
      options.rootDir,
      options.projectName,
    );
    if (expected !== current) {
      revisionConflict(expected, current);
    }
  }

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const writeOptions =
      Object.prototype.hasOwnProperty.call(options, 'expectedRevision') &&
      options.expectedRevision != null
        ? { expectedRevision: options.expectedRevision }
        : {};
    const result = writeFileAtomic(filePath, content, writeOptions);
    if (result.status === 'conflict') {
      revisionConflict(result.expectedRevision, result.currentRevision);
    }
    const revision = computeContentRevision(content);
    if (result.status === 'unchanged') {
      return { status: 'unchanged', relativePath, revision };
    }
    return {
      status: existed ? 'updated' : 'created',
      relativePath,
      revision,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'FeatureError') {
      throw err;
    }
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
