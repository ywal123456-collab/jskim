/**
 * Device Capture HTTP クライアント（spec dev editable 専用）。
 */

import type { DeviceCaptureViewport } from './preview-provider.js';

export const DEVICE_CAPTURE_COLLECT_PATH =
  '/_jskim/spec/device-captures:collect';
export const DEVICE_CAPTURE_STATUS_PATH =
  '/_jskim/spec/device-captures/status';

export type DeviceCaptureRuntimeState =
  | { status: 'idle' }
  | { status: 'collecting'; requestId?: string; startedAt?: string }
  | {
      status: 'failed';
      failedAt?: string;
      error?: { code: string; message: string };
    };

export type DeviceCapturePersistedPublic = {
  status: 'missing' | 'current' | 'stale' | 'invalid';
  inputRevision?: string;
  imageRevision?: string;
  capturedAt?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageFile?: string;
  viewportWidth?: number;
  viewportHeight?: number;
};

export type DeviceCaptureStatusResponse = {
  screenId: string;
  stateId: string;
  viewport: DeviceCaptureViewport;
  runtime: DeviceCaptureRuntimeState;
  capture: DeviceCapturePersistedPublic;
};

export type DeviceCaptureCollectResult = 'created' | 'updated' | 'unchanged';

export type DeviceCaptureCollectResponse = {
  screenId: string;
  stateId: string;
  viewport: DeviceCaptureViewport;
  result: DeviceCaptureCollectResult;
  capture: DeviceCapturePersistedPublic;
};

export type DeviceCaptureApiError = {
  code: string;
  message: string;
  status: number;
};

function parseError(
  status: number,
  body: unknown,
): DeviceCaptureApiError {
  if (body && typeof body === 'object') {
    const o = body as { code?: unknown; message?: unknown };
    if (typeof o.code === 'string' && typeof o.message === 'string') {
      return { code: o.code, message: o.message, status };
    }
  }
  return {
    code: 'SPEC_DEVICE_CAPTURE_REQUEST_FAILED',
    message: 'Device Previewの要求に失敗しました。',
    status,
  };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function fetchDeviceCaptureStatus(options: {
  screenId: string;
  stateId: string;
  viewport: DeviceCaptureViewport;
  fetchFn?: typeof fetch;
}): Promise<
  | { ok: true; data: DeviceCaptureStatusResponse }
  | { ok: false; error: DeviceCaptureApiError }
> {
  const fetchFn = options.fetchFn ?? fetch;
  const url = new URL(DEVICE_CAPTURE_STATUS_PATH, window.location.origin);
  url.searchParams.set('screenId', options.screenId);
  url.searchParams.set('stateId', options.stateId);
  url.searchParams.set('viewport', options.viewport);
  try {
    const res = await fetchFn(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    const body = await readJson(res);
    if (!res.ok) {
      return { ok: false, error: parseError(res.status, body) };
    }
    return { ok: true, data: body as DeviceCaptureStatusResponse };
  } catch {
    return {
      ok: false,
      error: {
        code: 'SPEC_DEVICE_CAPTURE_NETWORK',
        message: 'Device Previewの状態取得に失敗しました。',
        status: 0,
      },
    };
  }
}

export async function postDeviceCaptureCollect(options: {
  screenId: string;
  stateId: string;
  viewport: DeviceCaptureViewport;
  fetchFn?: typeof fetch;
}): Promise<
  | { ok: true; data: DeviceCaptureCollectResponse }
  | { ok: false; error: DeviceCaptureApiError }
> {
  const fetchFn = options.fetchFn ?? fetch;
  try {
    const res = await fetchFn(DEVICE_CAPTURE_COLLECT_PATH, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        screenId: options.screenId,
        stateId: options.stateId,
        viewport: options.viewport,
      }),
    });
    const body = await readJson(res);
    if (!res.ok) {
      return { ok: false, error: parseError(res.status, body) };
    }
    return { ok: true, data: body as DeviceCaptureCollectResponse };
  } catch {
    return {
      ok: false,
      error: {
        code: 'SPEC_DEVICE_CAPTURE_NETWORK',
        message: 'Device Previewの収集要求に失敗しました。',
        status: 0,
      },
    };
  }
}

/**
 * 画面 JSON が期待 imageRevision を指すまで待つ（固定 timeout で成功扱いにしない）。
 * AbortSignal で打ち切れる。
 */
export async function waitForDeviceCaptureRevision(options: {
  screenDataUrl: string;
  stateId: string;
  viewport: DeviceCaptureViewport;
  expectedImageRevision: string;
  intervalMs?: number;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}): Promise<boolean> {
  const fetchFn = options.fetchFn ?? fetch;
  const intervalMs = options.intervalMs ?? 250;

  while (!options.signal?.aborted) {
    try {
      const res = await fetchFn(options.screenDataUrl, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (res.ok) {
        const data = (await res.json()) as {
          states?: Array<{
            id: string;
            deviceCaptures?: Record<
              string,
              { status?: string; imageRevision?: string }
            >;
          }>;
        };
        const state = (data.states || []).find((s) => s.id === options.stateId);
        const entry = state?.deviceCaptures?.[options.viewport];
        if (
          entry &&
          (entry.status === 'current' || entry.status === 'stale') &&
          entry.imageRevision === options.expectedImageRevision
        ) {
          return true;
        }
      }
    } catch {
      // retry
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, intervalMs);
      options.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  }
  return false;
}
