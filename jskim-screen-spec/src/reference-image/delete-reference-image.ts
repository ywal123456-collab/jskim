import { createReferenceImageError } from './errors.js';
import {
  referenceImageLockKey,
  withReferenceImageLock,
} from './key-lock.js';
import { referenceMetaPath, referenceViewportDir } from './paths.js';
import {
  cleanupOrphanReferenceGenerationImages,
  unlinkReferenceMeta,
  type PersistReferenceHooks,
} from './persist-reference.js';
import { isViewportId } from './presets.js';
import { assertReferenceImageScreenExists } from './screen-exists.js';
import { getReferenceImageStatus } from './status.js';
import type {
  DeleteReferenceImageOptions,
  DeleteReferenceImageResult,
} from './types.js';

export type DeleteReferenceImageInternalHooks = PersistReferenceHooks;

async function deleteReferenceImageOwned(
  options: DeleteReferenceImageOptions & {
    hooks?: DeleteReferenceImageInternalHooks;
  },
): Promise<DeleteReferenceImageResult> {
  if (!isViewportId(options.viewport)) {
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_INVALID_VIEWPORT',
      `viewport が不正です: ${String(options.viewport)}`,
    );
  }

  assertReferenceImageScreenExists(options);

  if (
    typeof options.expectedImageRevision !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(options.expectedImageRevision)
  ) {
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT',
      'expectedImageRevision が不正です。',
    );
  }

  const statusResult = getReferenceImageStatus(options);

  if (statusResult.status === 'missing') {
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_NOT_FOUND',
      '参照画像がありません。',
    );
  }

  if (statusResult.status === 'invalid') {
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_INVALID',
      '参照画像の metadata または画像が破損しているため削除できません。',
    );
  }

  if (options.expectedImageRevision !== statusResult.metadata!.imageRevision) {
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT',
      '参照画像の revision が一致しません。最新を再読込してください。',
    );
  }

  const metaPath = referenceMetaPath(options);
  const referenceDir = referenceViewportDir(options);
  const keepImageFile = statusResult.metadata!.imageFile;

  unlinkReferenceMeta({ metaPath, hooks: options.hooks });

  const warnings: string[] = [];
  try {
    if (options.hooks?.failCleanup) {
      throw new Error('cleanup 失敗（テスト注入）');
    }
    cleanupOrphanReferenceGenerationImages({
      referenceDir,
      keepImageFile: null,
    });
  } catch (err) {
    warnings.push(
      `未参照画像の整理に失敗しました: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    // keepImageFile は削除済み meta のため orphan 扱い。失敗しても delete 成功。
    void keepImageFile;
  }

  return {
    result: 'deleted',
    screenId: options.screenId,
    viewport: options.viewport,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Reference Image を削除する（HTTP なし）。
 * meta.json unlink が commit point。
 */
export function deleteReferenceImage(
  options: DeleteReferenceImageOptions & {
    hooks?: DeleteReferenceImageInternalHooks;
  },
): Promise<DeleteReferenceImageResult> {
  const key = referenceImageLockKey({
    projectName: options.projectName,
    screenId: options.screenId,
    viewport: options.viewport,
  });
  return withReferenceImageLock(key, () => deleteReferenceImageOwned(options));
}
