import fs from 'node:fs';
import {
  computeInputRevision,
  loadDeviceCaptureInputContext,
} from './input-revision.js';
import { captureMetaPath } from './paths.js';
import type { ViewportId } from './presets.js';
import type { DeviceCaptureStatus } from './types.js';
import { validatePersistedCapture } from './validate-metadata.js';

export type GetDeviceCaptureStatusOptions = {
  rootDir: string;
  projectName: string;
  screenId: string;
  stateId: string;
  viewport: ViewportId;
};

export type GetDeviceCaptureStatusResult = {
  status: DeviceCaptureStatus;
  inputRevision?: string;
  currentInputRevision?: string;
  reason?: string;
};

export function getDeviceCaptureStatus(
  options: GetDeviceCaptureStatusOptions,
): GetDeviceCaptureStatusResult {
  const metaPath = captureMetaPath(options);
  if (!fs.existsSync(metaPath)) {
    return { status: 'missing' };
  }

  const validated = validatePersistedCapture({
    metaPath,
    expectedScreenId: options.screenId,
    expectedStateId: options.stateId,
    expectedViewport: options.viewport,
  });
  if (!validated.ok) {
    return { status: 'invalid', reason: validated.reason };
  }

  let currentInputRevision: string;
  try {
    const ctx = loadDeviceCaptureInputContext(options);
    currentInputRevision = computeInputRevision(ctx);
  } catch (err) {
    return {
      status: 'invalid',
      reason:
        err instanceof Error
          ? err.message
          : '現在の inputRevision を計算できません。',
      inputRevision: validated.metadata.inputRevision,
    };
  }

  if (validated.metadata.inputRevision === currentInputRevision) {
    return {
      status: 'current',
      inputRevision: validated.metadata.inputRevision,
      currentInputRevision,
    };
  }

  return {
    status: 'stale',
    inputRevision: validated.metadata.inputRevision,
    currentInputRevision,
  };
}
