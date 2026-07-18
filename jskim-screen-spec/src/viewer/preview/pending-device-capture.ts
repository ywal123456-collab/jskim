/**
 * Device Capture POST 後の manifest reload 待ち（full page reload 跨ぎ）。
 * 画面作成/削除の pending key とは分離する。
 */

import {
  isDeviceCaptureViewport,
  type DeviceCaptureViewport,
} from './preview-provider.js';

export const PENDING_DEVICE_CAPTURE_PREFIX = 'jskim-spec-pending-device-capture:';

export type PendingDeviceCapture = {
  screenId: string;
  stateId: string;
  viewport: DeviceCaptureViewport;
  expectedImageRevision: string;
  expectedInputRevision?: string;
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

export function pendingDeviceCaptureKey(projectName: string): string {
  return `${PENDING_DEVICE_CAPTURE_PREFIX}${projectName}`;
}

export function setPendingDeviceCapture(
  projectName: string,
  value: PendingDeviceCapture,
): void {
  try {
    storage()?.setItem(pendingDeviceCaptureKey(projectName), JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function peekPendingDeviceCapture(
  projectName: string,
): PendingDeviceCapture | null {
  try {
    const raw = storage()?.getItem(pendingDeviceCaptureKey(projectName));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PendingDeviceCapture;
    if (
      !parsed ||
      typeof parsed.screenId !== 'string' ||
      typeof parsed.stateId !== 'string' ||
      !isDeviceCaptureViewport(parsed.viewport) ||
      typeof parsed.expectedImageRevision !== 'string' ||
      !parsed.expectedImageRevision.startsWith('sha256:')
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingDeviceCapture(projectName: string): void {
  try {
    storage()?.removeItem(pendingDeviceCaptureKey(projectName));
  } catch {
    // ignore
  }
}

export function captureKey(
  screenId: string,
  stateId: string,
  viewport: DeviceCaptureViewport,
): string {
  return `${screenId}\0${stateId}\0${viewport}`;
}
