import fs from 'node:fs';
import path from 'node:path';
import {
  createFileAtomic,
  writeFileAtomic,
} from '../util/write-file-atomic.js';
import { createReferenceImageError } from './errors.js';
import {
  REFERENCE_GENERATION_IMAGE_RE,
  referenceGenerationImageFileName,
} from './presets.js';
import type { ReferenceImageMetadata } from './types.js';
import { serializeReferenceImageMetadata } from './validate-metadata.js';

export type PersistReferenceHooks = {
  failImagePublish?: boolean;
  failMetaTempWrite?: boolean;
  failMetaAtomicReplace?: boolean;
  failMetaUnlink?: boolean;
  failCleanup?: boolean;
  writeFileAtomicFn?: typeof writeFileAtomic;
  createFileAtomicFn?: typeof createFileAtomic;
  unlinkSyncFn?: (p: string) => void;
};

function safeUnlink(p: string): void {
  try {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  } catch {
    // best-effort
  }
}

/**
 * generation PNG を原子的に公開する（同一内容なら exists で no-op）。
 */
export function publishReferenceGenerationImage(options: {
  referenceDir: string;
  imageRevision: string;
  pngBytes: Buffer;
  hooks?: PersistReferenceHooks;
}): { imageFile: string; imagePath: string; created: boolean } {
  const hex = options.imageRevision.slice('sha256:'.length);
  const imageFile = referenceGenerationImageFileName(hex);
  const imagePath = path.join(options.referenceDir, imageFile);
  fs.mkdirSync(options.referenceDir, { recursive: true });

  if (fs.existsSync(imagePath)) {
    return { imageFile, imagePath, created: false };
  }

  if (options.hooks?.failImagePublish) {
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_WRITE_FAILED',
      '画像の公開に失敗しました（テスト注入）。',
    );
  }

  const createFn = options.hooks?.createFileAtomicFn || createFileAtomic;
  const result = createFn(imagePath, options.pngBytes);
  if (result.status === 'exists') {
    return { imageFile, imagePath, created: false };
  }
  return { imageFile, imagePath, created: true };
}

export type CommitReferenceResult = {
  status: 'created' | 'updated' | 'unchanged';
  metadata: ReferenceImageMetadata;
  metaPath: string;
  imagePath: string;
  warnings: string[];
};

/**
 * meta.json の atomic 置換が commit point。
 */
export function commitReferenceImage(options: {
  referenceDir: string;
  metadata: ReferenceImageMetadata;
  pngBytes: Buffer;
  hooks?: PersistReferenceHooks;
}): CommitReferenceResult {
  const warnings: string[] = [];
  const metaPath = path.join(options.referenceDir, 'meta.json');
  const metaJson = serializeReferenceImageMetadata(options.metadata);

  if (fs.existsSync(metaPath)) {
    try {
      const existing = fs.readFileSync(metaPath, 'utf8');
      if (existing === metaJson) {
        return {
          status: 'unchanged',
          metadata: options.metadata,
          metaPath,
          imagePath: path.join(
            options.referenceDir,
            options.metadata.imageFile,
          ),
          warnings,
        };
      }
    } catch {
      // continue
    }
  }

  const existed = fs.existsSync(metaPath);

  let published: { imageFile: string; imagePath: string; created: boolean };
  try {
    published = publishReferenceGenerationImage({
      referenceDir: options.referenceDir,
      imageRevision: options.metadata.imageRevision,
      pngBytes: options.pngBytes,
      hooks: options.hooks,
    });
  } catch (err) {
    throw err;
  }

  if (options.hooks?.failMetaTempWrite) {
    if (published.created) {
      safeUnlink(published.imagePath);
    }
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_WRITE_FAILED',
      'metadata TEMP の書き込みに失敗しました（テスト注入）。',
    );
  }

  if (options.hooks?.failMetaAtomicReplace) {
    if (published.created) {
      safeUnlink(published.imagePath);
    }
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_WRITE_FAILED',
      'metadata の atomic 置換に失敗しました（テスト注入）。',
    );
  }

  const writeFn = options.hooks?.writeFileAtomicFn || writeFileAtomic;
  try {
    const result = writeFn(metaPath, metaJson);
    if (result.status === 'conflict') {
      if (published.created) {
        safeUnlink(published.imagePath);
      }
      throw createReferenceImageError(
        'SPEC_REFERENCE_IMAGE_WRITE_FAILED',
        'metadata の書き込みが競合しました。',
      );
    }
  } catch (err) {
    if (published.created) {
      safeUnlink(published.imagePath);
    }
    if (err instanceof Error && err.name === 'ReferenceImageError') {
      throw err;
    }
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_WRITE_FAILED',
      `metadata の書き込みに失敗しました。原因: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  try {
    if (options.hooks?.failCleanup) {
      throw new Error('cleanup 失敗（テスト注入）');
    }
    cleanupOrphanReferenceGenerationImages({
      referenceDir: options.referenceDir,
      keepImageFile: options.metadata.imageFile,
    });
  } catch (err) {
    warnings.push(
      `未参照画像の整理に失敗しました: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return {
    status: existed ? 'updated' : 'created',
    metadata: options.metadata,
    metaPath,
    imagePath: published.imagePath,
    warnings,
  };
}

/**
 * 正常 naming の generation PNG のうち、現 meta が参照しないものを削除。
 */
export function cleanupOrphanReferenceGenerationImages(options: {
  referenceDir: string;
  keepImageFile: string | null;
}): string[] {
  if (!fs.existsSync(options.referenceDir)) {
    return [];
  }
  const removed: string[] = [];
  for (const name of fs.readdirSync(options.referenceDir)) {
    if (!REFERENCE_GENERATION_IMAGE_RE.test(name)) {
      continue;
    }
    if (options.keepImageFile != null && name === options.keepImageFile) {
      continue;
    }
    const full = path.join(options.referenceDir, name);
    try {
      fs.unlinkSync(full);
      removed.push(name);
    } catch {
      // best-effort
    }
  }
  return removed;
}

/**
 * meta.json unlink が delete commit point。
 */
export function unlinkReferenceMeta(options: {
  metaPath: string;
  hooks?: PersistReferenceHooks;
}): void {
  if (options.hooks?.failMetaUnlink) {
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_WRITE_FAILED',
      'meta.json の削除に失敗しました（テスト注入）。',
    );
  }
  const unlinkFn = options.hooks?.unlinkSyncFn || fs.unlinkSync.bind(fs);
  try {
    unlinkFn(options.metaPath);
  } catch (err) {
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_WRITE_FAILED',
      `meta.json の削除に失敗しました。原因: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
