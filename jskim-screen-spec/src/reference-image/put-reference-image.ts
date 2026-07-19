import { computeContentRevision } from '../util/write-file-atomic.js';
import { createReferenceImageError } from './errors.js';
import {
  referenceImageLockKey,
  withReferenceImageLock,
} from './key-lock.js';
import { referenceViewportDir } from './paths.js';
import {
  commitReferenceImage,
  type PersistReferenceHooks,
} from './persist-reference.js';
import { assertReferencePngBuffer } from './png-validate.js';
import {
  getViewportPreset,
  isViewportId,
  referenceGenerationImageFileName,
} from './presets.js';
import { assertReferenceImageScreenExists } from './screen-exists.js';
import { getReferenceImageStatus } from './status.js';
import type {
  PutReferenceImageOptions,
  PutReferenceImageResult,
  ReferenceImageMetadata,
  ReferenceImageSource,
} from './types.js';

export type PutReferenceImageInternalHooks = PersistReferenceHooks & {
  now?: () => string;
};

function isSameSource(
  a: ReferenceImageSource,
  b: ReferenceImageSource,
): boolean {
  if (a.type === 'upload' && b.type === 'upload') {
    return true;
  }
  if (a.type === 'figma' && b.type === 'figma') {
    // importedAt は比較しない（同一 PNG + 同一 Frame 識別子なら unchanged）
    return (
      a.fileKey === b.fileKey &&
      a.nodeId === b.nodeId &&
      a.frameName === b.frameName &&
      a.exportScale === b.exportScale
    );
  }
  return false;
}

function isSameReferenceContent(
  existing: ReferenceImageMetadata,
  next: Omit<ReferenceImageMetadata, 'uploadedAt'>,
): boolean {
  return (
    existing.imageRevision === next.imageRevision &&
    existing.viewport.id === next.viewport.id &&
    existing.viewport.width === next.viewport.width &&
    existing.viewport.height === next.viewport.height &&
    existing.format === next.format &&
    existing.imageFile === next.imageFile &&
    existing.imageWidth === next.imageWidth &&
    existing.imageHeight === next.imageHeight &&
    existing.schemaVersion === next.schemaVersion &&
    existing.screenId === next.screenId &&
    isSameSource(existing.source, next.source)
  );
}

function resolveSource(
  options: PutReferenceImageOptions,
  uploadedAt: string,
): ReferenceImageSource {
  if (!options.source) {
    return { type: 'upload' };
  }
  if (options.source.type === 'upload') {
    return { type: 'upload' };
  }
  return {
    type: 'figma',
    fileKey: options.source.fileKey,
    nodeId: options.source.nodeId,
    frameName: options.source.frameName,
    importedAt: options.source.importedAt || uploadedAt,
    exportScale: 1,
  };
}

async function putReferenceImageOwned(
  options: PutReferenceImageOptions & {
    hooks?: PutReferenceImageInternalHooks;
  },
): Promise<PutReferenceImageResult> {
  if (!isViewportId(options.viewport)) {
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_INVALID_VIEWPORT',
      `viewport が不正です: ${String(options.viewport)}`,
    );
  }

  assertReferenceImageScreenExists(options);

  const dims = assertReferencePngBuffer(options.imageBytes);
  const imageRevision = computeContentRevision(options.imageBytes);
  const hex = imageRevision.slice('sha256:'.length);
  const imageFile = referenceGenerationImageFileName(hex);
  const preset = getViewportPreset(options.viewport);

  const statusResult = getReferenceImageStatus(options);

  if (statusResult.status === 'invalid') {
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_INVALID',
      '参照画像の metadata または画像が破損しているため更新できません。',
    );
  }

  const uploadedAt =
    options.hooks?.now?.() || new Date().toISOString();
  const source = resolveSource(options, uploadedAt);

  if (statusResult.status === 'missing') {
    if (
      options.expectedImageRevision !== undefined &&
      options.expectedImageRevision !== null
    ) {
      throw createReferenceImageError(
        'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT',
        '参照画像が未登録のため expectedImageRevision は指定できません。',
      );
    }
  } else {
    // current
    if (
      options.expectedImageRevision === undefined ||
      options.expectedImageRevision === null
    ) {
      throw createReferenceImageError(
        'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT',
        '既存の参照画像を置き換えるには expectedImageRevision が必要です。',
      );
    }
    if (
      options.expectedImageRevision !== statusResult.metadata!.imageRevision
    ) {
      throw createReferenceImageError(
        'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT',
        '参照画像の revision が一致しません。最新を再読込してください。',
      );
    }

    const nextWithoutDate: Omit<ReferenceImageMetadata, 'uploadedAt'> = {
      schemaVersion: '1.0',
      screenId: options.screenId,
      viewport: {
        id: preset.id,
        width: preset.width,
        height: preset.height,
      },
      format: 'png',
      imageFile,
      imageRevision,
      imageWidth: dims.width,
      imageHeight: dims.height,
      source,
    };

    if (isSameReferenceContent(statusResult.metadata!, nextWithoutDate)) {
      return {
        result: 'unchanged',
        screenId: options.screenId,
        viewport: options.viewport,
        imageRevision: statusResult.metadata!.imageRevision,
        imageWidth: statusResult.metadata!.imageWidth,
        imageHeight: statusResult.metadata!.imageHeight,
        uploadedAt: statusResult.metadata!.uploadedAt,
      };
    }
  }

  const metadata: ReferenceImageMetadata = {
    schemaVersion: '1.0',
    screenId: options.screenId,
    viewport: {
      id: preset.id,
      width: preset.width,
      height: preset.height,
    },
    format: 'png',
    imageFile,
    imageRevision,
    imageWidth: dims.width,
    imageHeight: dims.height,
    uploadedAt,
    source,
  };

  const referenceDir = referenceViewportDir(options);

  const committed = commitReferenceImage({
    referenceDir,
    metadata,
    pngBytes: options.imageBytes,
    hooks: options.hooks,
  });

  return {
    result: committed.status,
    screenId: options.screenId,
    viewport: options.viewport,
    imageRevision: committed.metadata.imageRevision,
    imageWidth: committed.metadata.imageWidth,
    imageHeight: committed.metadata.imageHeight,
    uploadedAt: committed.metadata.uploadedAt,
    ...(committed.warnings.length > 0
      ? { warnings: committed.warnings }
      : {}),
  };
}

/**
 * Reference Image を upload / replace する（HTTP なし）。
 */
export function putReferenceImage(
  options: PutReferenceImageOptions & {
    hooks?: PutReferenceImageInternalHooks;
  },
): Promise<PutReferenceImageResult> {
  const key = referenceImageLockKey({
    projectName: options.projectName,
    screenId: options.screenId,
    viewport: options.viewport,
  });
  return withReferenceImageLock(key, () => putReferenceImageOwned(options));
}
