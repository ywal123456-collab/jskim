/**
 * Reference Image PUT/DELETE 後の manifest reload 待ち（full page reload 跨ぎ）。
 * Device Capture pending key とは分離する。
 */

import {
  isReferenceViewport,
  type ReferenceViewport,
} from './preview-provider.js';

export const PENDING_REFERENCE_IMAGE_PREFIX =
  'jskim-spec-pending-reference-image:';

export type PendingReferenceImage =
  | {
      operation: 'upload';
      screenId: string;
      viewport: ReferenceViewport;
      /** Dialog 開始時の expected（初回 upload は null） */
      expectedImageRevision: string | null;
      resultImageRevision: string;
    }
  | {
      operation: 'delete';
      screenId: string;
      viewport: ReferenceViewport;
      expectedImageRevision: string;
      expectedMissing: true;
    };

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === 'undefined') {
      return null;
    }
    return sessionStorage;
  } catch {
    return null;
  }
}

export function pendingReferenceImageKey(projectName: string): string {
  return `${PENDING_REFERENCE_IMAGE_PREFIX}${projectName}`;
}

export function setPendingReferenceImage(
  projectName: string,
  value: PendingReferenceImage,
): void {
  try {
    storage()?.setItem(
      pendingReferenceImageKey(projectName),
      JSON.stringify(value),
    );
  } catch {
    // ignore
  }
}

export function peekPendingReferenceImage(
  projectName: string,
): PendingReferenceImage | null {
  try {
    const raw = storage()?.getItem(pendingReferenceImageKey(projectName));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PendingReferenceImage;
    if (
      !parsed ||
      typeof parsed.screenId !== 'string' ||
      !isReferenceViewport(parsed.viewport)
    ) {
      return null;
    }
    if (parsed.operation === 'upload') {
      if (
        typeof parsed.resultImageRevision !== 'string' ||
        !parsed.resultImageRevision.startsWith('sha256:')
      ) {
        return null;
      }
      if (
        parsed.expectedImageRevision != null &&
        (typeof parsed.expectedImageRevision !== 'string' ||
          !parsed.expectedImageRevision.startsWith('sha256:'))
      ) {
        return null;
      }
      return parsed;
    }
    if (parsed.operation === 'delete') {
      if (
        parsed.expectedMissing !== true ||
        typeof parsed.expectedImageRevision !== 'string' ||
        !parsed.expectedImageRevision.startsWith('sha256:')
      ) {
        return null;
      }
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearPendingReferenceImage(projectName: string): void {
  try {
    storage()?.removeItem(pendingReferenceImageKey(projectName));
  } catch {
    // ignore
  }
}

export function referenceImageKey(
  screenId: string,
  viewport: ReferenceViewport,
): string {
  return `${screenId}\0${viewport}`;
}
