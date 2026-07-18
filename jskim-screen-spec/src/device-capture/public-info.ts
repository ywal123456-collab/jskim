import fs from 'node:fs';
import path from 'node:path';
import { captureMetaPath } from './paths.js';
import type { ViewportId } from './presets.js';
import type { DeviceCaptureStatus } from './types.js';
import { getDeviceCaptureStatus } from './status.js';
import { validatePersistedCapture } from './validate-metadata.js';

export type DeviceCapturePublicInfo = {
  status: DeviceCaptureStatus;
  inputRevision?: string;
  imageRevision?: string;
  capturedAt?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageFile?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  reason?: string;
};

/**
 * API / manifest 向けの安全な Capture 公開情報。
 * 絶対 path は含めない。
 */
export function getDeviceCapturePublicInfo(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
  stateId: string;
  viewport: ViewportId;
}): DeviceCapturePublicInfo {
  const statusResult = getDeviceCaptureStatus(options);
  if (statusResult.status === 'missing') {
    return { status: 'missing' };
  }

  const metaPath = captureMetaPath(options);
  const validated = validatePersistedCapture({
    metaPath,
    expectedScreenId: options.screenId,
    expectedStateId: options.stateId,
    expectedViewport: options.viewport,
  });

  if (!validated.ok) {
    return {
      status: 'invalid',
      reason: validated.reason || statusResult.reason,
    };
  }

  const { metadata } = validated;
  if (statusResult.status === 'invalid') {
    return {
      status: 'invalid',
      reason: statusResult.reason,
    };
  }

  return {
    status: statusResult.status,
    inputRevision: metadata.inputRevision,
    imageRevision: metadata.imageRevision,
    capturedAt: metadata.capturedAt,
    imageWidth: metadata.imageWidth,
    imageHeight: metadata.imageHeight,
    imageFile: metadata.imageFile,
    viewportWidth: metadata.viewport.width,
    viewportHeight: metadata.viewport.height,
  };
}

/**
 * Viewer 出力用の相対 imagePath（data/ 配下）。
 * current / stale のみ。
 */
export function viewerDeviceCaptureImagePath(options: {
  screenId: string;
  stateId: string;
  viewport: ViewportId;
  imageFile: string;
}): string {
  return [
    'device-captures',
    options.screenId,
    options.stateId,
    options.viewport,
    options.imageFile,
  ].join('/');
}

export function readSourceCaptureImageBytes(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
  stateId: string;
  viewport: ViewportId;
  imageFile: string;
}): Buffer | null {
  const metaPath = captureMetaPath(options);
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
