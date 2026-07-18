import fs from 'node:fs';
import path from 'node:path';
import { referenceMetaPath } from './paths.js';
import type { ViewportId } from './presets.js';
import { getReferenceImageStatus } from './status.js';
import type { ReferenceImageStatus } from './types.js';
import { validatePersistedReferenceImage } from './validate-metadata.js';

export type ReferenceImagePublicInfo = {
  status: ReferenceImageStatus;
  imageRevision?: string;
  uploadedAt?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageFile?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  reason?: string;
};

/**
 * manifest 向けの安全な Reference Image 公開情報。
 * 絶対 path は含めない。
 */
export function getReferenceImagePublicInfo(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
  viewport: ViewportId;
}): ReferenceImagePublicInfo {
  const statusResult = getReferenceImageStatus(options);
  if (statusResult.status === 'missing') {
    return { status: 'missing' };
  }

  const metaPath = referenceMetaPath(options);
  const validated = validatePersistedReferenceImage({
    metaPath,
    expectedScreenId: options.screenId,
    expectedViewport: options.viewport,
  });

  if (!validated.ok || statusResult.status === 'invalid') {
    return {
      status: 'invalid',
      reason: validated.ok
        ? statusResult.reason
        : validated.reason || statusResult.reason,
    };
  }

  const { metadata } = validated;
  return {
    status: 'current',
    imageRevision: metadata.imageRevision,
    uploadedAt: metadata.uploadedAt,
    imageWidth: metadata.imageWidth,
    imageHeight: metadata.imageHeight,
    imageFile: metadata.imageFile,
    viewportWidth: metadata.viewport.width,
    viewportHeight: metadata.viewport.height,
  };
}

export function viewerReferenceImagePath(options: {
  screenId: string;
  viewport: ViewportId;
  imageFile: string;
}): string {
  return [
    'reference-images',
    options.screenId,
    options.viewport,
    options.imageFile,
  ].join('/');
}

export function readSourceReferenceImageBytes(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
  viewport: ViewportId;
  imageFile: string;
}): Buffer | null {
  const metaPath = referenceMetaPath(options);
  const full = path.join(path.dirname(metaPath), options.imageFile);
  if (!fs.existsSync(full)) {
    return null;
  }
  try {
    return fs.readFileSync(full);
  } catch {
    return null;
  }
}
