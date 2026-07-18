/**
 * Reference Image 内部の PC/SP 選択（Device Capture の PC/SP とは別）。
 * project 単位で sessionStorage に保持する。
 */

import {
  isReferenceViewport,
  type ReferenceViewport,
} from './preview-provider.js';
import type { ReferenceImageManifestEntry } from '../types.js';

const STORAGE_PREFIX = 'jskim-spec-reference-viewport:';

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

export function referenceViewportStorageKey(projectName: string): string {
  return `${STORAGE_PREFIX}${projectName}`;
}

/** 壊れた値は PC にフォールバック */
export function normalizeReferenceViewport(value: unknown): ReferenceViewport {
  return isReferenceViewport(value) ? value : 'pc';
}

export function readReferenceViewport(projectName: string): ReferenceViewport {
  try {
    const raw = storage()?.getItem(referenceViewportStorageKey(projectName));
    if (raw == null) {
      return 'pc';
    }
    return normalizeReferenceViewport(raw);
  } catch {
    return 'pc';
  }
}

export function writeReferenceViewport(
  projectName: string,
  viewport: ReferenceViewport,
): void {
  if (!isReferenceViewport(viewport)) {
    return;
  }
  try {
    storage()?.setItem(referenceViewportStorageKey(projectName), viewport);
  } catch {
    // ignore
  }
}

export function hasStoredReferenceViewport(projectName: string): boolean {
  try {
    return storage()?.getItem(referenceViewportStorageKey(projectName)) != null;
  } catch {
    return false;
  }
}

/**
 * 保存値が無い read-only DESIGN_ONLY で SP のみ current/invalid なら SP を初期選択。
 */
export function resolveInitialReferenceViewport(options: {
  projectName: string;
  editable: boolean;
  referenceImages?: {
    pc: ReferenceImageManifestEntry;
    sp: ReferenceImageManifestEntry;
  };
}): ReferenceViewport {
  if (hasStoredReferenceViewport(options.projectName)) {
    return readReferenceViewport(options.projectName);
  }
  if (options.editable || !options.referenceImages) {
    return 'pc';
  }
  const pc = options.referenceImages.pc;
  const sp = options.referenceImages.sp;
  const pcVisible = pc.status === 'current' || pc.status === 'invalid';
  const spVisible = sp.status === 'current' || sp.status === 'invalid';
  if (!pcVisible && spVisible) {
    return 'sp';
  }
  return 'pc';
}
