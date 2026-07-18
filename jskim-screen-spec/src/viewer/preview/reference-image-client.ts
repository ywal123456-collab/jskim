/**
 * Reference Image HTTP クライアント（spec dev editable 専用）。
 */

import type { ReferenceViewport } from './preview-provider.js';
import type { ReferenceImageManifestEntry } from '../types.js';

export const REFERENCE_IMAGE_STATUS_PATH =
  '/_jskim/spec/reference-images/status';

export const MAX_REFERENCE_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;

export type ReferenceImageRuntimeState =
  | { status: 'idle' }
  | {
      status: 'uploading';
      requestId?: string;
      startedAt?: string;
    }
  | {
      status: 'deleting';
      requestId?: string;
      startedAt?: string;
    }
  | {
      status: 'failed';
      operation: 'upload' | 'delete';
      failedAt?: string;
      error?: { code: string; message: string };
    };

export type ReferenceImageStatusResponse = {
  screenId: string;
  viewport: ReferenceViewport;
  runtime: ReferenceImageRuntimeState;
  referenceImage: ReferenceImageManifestEntry & {
    diagnosticCode?: string;
  };
};

export type ReferenceImagePutResult = 'created' | 'updated' | 'unchanged';

export type ReferenceImagePutResponse = {
  screenId: string;
  viewport: ReferenceViewport;
  result: ReferenceImagePutResult;
  referenceImage: {
    status: 'current';
    imageRevision: string;
    imageWidth: number;
    imageHeight: number;
    uploadedAt: string;
  };
};

export type ReferenceImageDeleteResponse = {
  screenId: string;
  viewport: ReferenceViewport;
  result: 'deleted';
  deletedImageRevision: string;
};

export type ReferenceImageApiError = {
  code: string;
  message: string;
  status: number;
};

function parseError(
  status: number,
  body: unknown,
): ReferenceImageApiError {
  if (body && typeof body === 'object') {
    const o = body as { code?: unknown; message?: unknown };
    if (typeof o.code === 'string' && typeof o.message === 'string') {
      return { code: o.code, message: o.message, status };
    }
  }
  return {
    code: 'SPEC_REFERENCE_IMAGE_REQUEST_FAILED',
    message: '参照画像の要求に失敗しました。',
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

export function referenceImageResourcePath(
  screenId: string,
  viewport: ReferenceViewport,
): string {
  return `/_jskim/spec/reference-images/${encodeURIComponent(screenId)}/${encodeURIComponent(viewport)}`;
}

export async function fetchReferenceImageStatus(options: {
  screenId: string;
  viewport: ReferenceViewport;
  fetchFn?: typeof fetch;
}): Promise<
  | { ok: true; data: ReferenceImageStatusResponse }
  | { ok: false; error: ReferenceImageApiError }
> {
  const fetchFn = options.fetchFn ?? fetch;
  const url = new URL(REFERENCE_IMAGE_STATUS_PATH, window.location.origin);
  url.searchParams.set('screenId', options.screenId);
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
    return { ok: true, data: body as ReferenceImageStatusResponse };
  } catch {
    return {
      ok: false,
      error: {
        code: 'SPEC_REFERENCE_IMAGE_NETWORK',
        message: '参照画像の状態取得に失敗しました。',
        status: 0,
      },
    };
  }
}

export async function putReferenceImageMultipart(options: {
  screenId: string;
  viewport: ReferenceViewport;
  file: File;
  /** replace 時のみ。初回 upload では省略（フィールド自体を送らない） */
  expectedImageRevision?: string;
  fetchFn?: typeof fetch;
}): Promise<
  | { ok: true; data: ReferenceImagePutResponse }
  | { ok: false; error: ReferenceImageApiError }
> {
  const fetchFn = options.fetchFn ?? fetch;
  const form = new FormData();
  form.append('image', options.file, options.file.name || 'reference.png');
  if (options.expectedImageRevision != null) {
    form.append('expectedImageRevision', options.expectedImageRevision);
  }
  try {
    const res = await fetchFn(
      referenceImageResourcePath(options.screenId, options.viewport),
      {
        method: 'PUT',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        body: form,
      },
    );
    const body = await readJson(res);
    if (!res.ok) {
      return { ok: false, error: parseError(res.status, body) };
    }
    return { ok: true, data: body as ReferenceImagePutResponse };
  } catch {
    return {
      ok: false,
      error: {
        code: 'SPEC_REFERENCE_IMAGE_NETWORK',
        message: '参照画像のアップロードに失敗しました。',
        status: 0,
      },
    };
  }
}

export async function deleteReferenceImageRequest(options: {
  screenId: string;
  viewport: ReferenceViewport;
  expectedImageRevision: string;
  fetchFn?: typeof fetch;
}): Promise<
  | { ok: true; data: ReferenceImageDeleteResponse }
  | { ok: false; error: ReferenceImageApiError }
> {
  const fetchFn = options.fetchFn ?? fetch;
  try {
    const res = await fetchFn(
      referenceImageResourcePath(options.screenId, options.viewport),
      {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          expectedImageRevision: options.expectedImageRevision,
        }),
      },
    );
    const body = await readJson(res);
    if (!res.ok) {
      return { ok: false, error: parseError(res.status, body) };
    }
    return { ok: true, data: body as ReferenceImageDeleteResponse };
  } catch {
    return {
      ok: false,
      error: {
        code: 'SPEC_REFERENCE_IMAGE_NETWORK',
        message: '参照画像の削除に失敗しました。',
        status: 0,
      },
    };
  }
}

/**
 * 画面 JSON の参照画像が期待状態になるまで待つ（固定 timeout で成功扱いにしない）。
 */
export async function waitForReferenceImageManifest(options: {
  screenDataUrl: string;
  viewport: ReferenceViewport;
  mode: 'revision' | 'missing';
  expectedImageRevision?: string;
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
          referenceImages?: Record<
            string,
            { status?: string; imageRevision?: string }
          >;
        };
        const entry = data.referenceImages?.[options.viewport];
        if (options.mode === 'missing') {
          if (!entry || entry.status === 'missing') {
            return true;
          }
        } else if (
          entry &&
          entry.status === 'current' &&
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

/** client UX 用。server 検証が最終基準。 */
export function validateReferenceImageFile(file: File | null): {
  ok: true;
} | {
  ok: false;
  message: string;
} {
  if (!file) {
    return { ok: false, message: 'PNGファイルを選択してください。' };
  }
  if (file.size <= 0) {
    return { ok: false, message: 'PNGファイルを選択してください。' };
  }
  if (file.size > MAX_REFERENCE_IMAGE_UPLOAD_BYTES) {
    return {
      ok: false,
      message: '参照画像のアップロードサイズが上限を超えています。',
    };
  }
  const type = String(file.type || '').toLowerCase();
  if (type && type !== 'image/png') {
    return {
      ok: false,
      message: 'PNG形式の画像のみ登録できます。',
    };
  }
  return { ok: true };
}
