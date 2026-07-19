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
      status: 'importing';
      requestId?: string;
      startedAt?: string;
    }
  | {
      status: 'failed';
      operation: 'upload' | 'delete' | 'import' | 'reimport';
      failedAt?: string;
      error?: { code: string; message: string };
    };

export type FigmaWidthMismatchConfirmation = {
  code: 'SPEC_FIGMA_WIDTH_MISMATCH';
  frame: {
    frameName: string;
    width: number;
    height: number;
  };
  viewport: {
    width: number;
    height: number;
  };
};

export type FigmaImportApiResponse =
  | {
      result: 'created' | 'updated' | 'unchanged';
      screenId: string;
      viewport: ReferenceViewport;
      referenceImage: {
        status: 'current';
        imageRevision: string;
        imageWidth: number;
        imageHeight: number;
        uploadedAt: string;
        source?: {
          type: 'figma';
          frameName: string;
          importedAt: string;
        };
      };
      frame: { frameName: string; width: number; height: number };
      source: { type: 'figma'; frameName: string; importedAt: string };
      warnings?: Array<{
        code: string;
        message: string;
        frameWidth: number;
        frameHeight: number;
        viewportWidth: number;
        viewportHeight: number;
      }>;
    }
  | {
      result: 'confirmation-required';
      screenId: string;
      viewport: ReferenceViewport;
      confirmation: FigmaWidthMismatchConfirmation;
    };

export type FigmaImportApiError = ReferenceImageApiError & {
  retryAfterSeconds?: number;
  planTier?: string;
  rateLimitType?: string;
  upgradeLink?: string;
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
): FigmaImportApiError {
  if (body && typeof body === 'object') {
    const o = body as {
      code?: unknown;
      message?: unknown;
      retryAfterSeconds?: unknown;
      planTier?: unknown;
      rateLimitType?: unknown;
      upgradeLink?: unknown;
    };
    if (typeof o.code === 'string' && typeof o.message === 'string') {
      /** @type {FigmaImportApiError} */
      const err: FigmaImportApiError = {
        code: o.code,
        message: o.message,
        status,
      };
      if (
        typeof o.retryAfterSeconds === 'number' &&
        Number.isFinite(o.retryAfterSeconds) &&
        o.retryAfterSeconds >= 0
      ) {
        err.retryAfterSeconds = Math.floor(o.retryAfterSeconds);
      }
      if (typeof o.planTier === 'string') {
        err.planTier = o.planTier;
      }
      if (typeof o.rateLimitType === 'string') {
        err.rateLimitType = o.rateLimitType;
      }
      if (
        typeof o.upgradeLink === 'string' &&
        /^https:\/\/(www\.)?figma\.com\//i.test(o.upgradeLink)
      ) {
        err.upgradeLink = o.upgradeLink;
      }
      return err;
    }
  }
  return {
    code: 'SPEC_REFERENCE_IMAGE_REQUEST_FAILED',
    message: '参照画像の要求に失敗しました。',
    status,
  };
}

export function figmaImportPath(
  screenId: string,
  viewport: ReferenceViewport,
): string {
  return `${referenceImageResourcePath(screenId, viewport)}/figma:import`;
}

export function figmaReimportPath(
  screenId: string,
  viewport: ReferenceViewport,
): string {
  return `${referenceImageResourcePath(screenId, viewport)}/figma:reimport`;
}

/**
 * Figma API エラーコードを Viewer 向け日本語メッセージへ変換する。
 */
export function formatFigmaViewerError(error: FigmaImportApiError): string {
  switch (error.code) {
    case 'SPEC_FIGMA_INPUT_INVALID':
      return 'Figma URL の形式が正しくありません。';
    case 'SPEC_FIGMA_TOKEN_MISSING':
      return 'サーバーに JSKIM_FIGMA_TOKEN が設定されていません。';
    case 'SPEC_FIGMA_UNAUTHORIZED':
      return 'Figma トークンが無効、または期限切れです。';
    case 'SPEC_FIGMA_FORBIDDEN':
      return 'この Figma ファイルへのアクセス権限がありません。';
    case 'SPEC_FIGMA_FILE_NOT_FOUND':
      return 'Figma ファイルが見つかりません。';
    case 'SPEC_FIGMA_NODE_NOT_FOUND':
      return '指定した Frame が見つかりません。';
    case 'SPEC_FIGMA_NODE_NOT_FRAME':
      return '指定したノードは Frame ではありません。';
    case 'SPEC_FIGMA_RATE_LIMITED': {
      const wait =
        error.retryAfterSeconds != null
          ? `（約 ${error.retryAfterSeconds} 秒後に再試行できます）`
          : '';
      return `Figma API の利用上限に達しました。${wait}`;
    }
    case 'SPEC_FIGMA_TIMEOUT':
      return 'Figma との通信がタイムアウトしました。';
    case 'SPEC_FIGMA_EXPORT_FAILED':
      return 'Figma からの画像エクスポートに失敗しました。';
    case 'SPEC_FIGMA_DOWNLOAD_FAILED':
      return 'Figma 画像のダウンロードに失敗しました。';
    case 'SPEC_FIGMA_IMAGE_TOO_LARGE':
      return '参照画像のサイズが上限（20 MiB）を超えています。';
    case 'SPEC_FIGMA_SOURCE_MISSING':
      return 'Figma から再取り込みできない参照画像です。';
    case 'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT':
      return '参照画像が別の操作で更新されました。最新の状態を確認してから再度実行してください。';
    case 'SPEC_REFERENCE_IMAGE_IN_PROGRESS':
      return '同じ参照画像を更新または削除しています。完了後に再度実行してください。';
    case 'SPEC_REFERENCE_IMAGE_NETWORK':
    case 'SPEC_FIGMA_NETWORK':
      return 'ネットワークエラーが発生しました。';
    default:
      return error.message || 'Figma 参照画像の処理に失敗しました。';
  }
}

export function formatReferenceSourceImportedAt(iso: string): string {
  if (!iso || !iso.trim()) {
    return '—';
  }
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return '—';
  }
  try {
    return new Date(t).toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
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

export async function importFigmaReferenceImageRequest(options: {
  screenId: string;
  viewport: ReferenceViewport;
  figmaUrl: string;
  expectedImageRevision?: string | null;
  confirmWidthMismatch?: boolean;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}): Promise<
  | { ok: true; data: FigmaImportApiResponse }
  | { ok: false; error: FigmaImportApiError; aborted?: boolean }
> {
  const fetchFn = options.fetchFn ?? fetch;
  /** @type {Record<string, unknown>} */
  const body: Record<string, unknown> = {
    figmaUrl: options.figmaUrl,
    confirmWidthMismatch: options.confirmWidthMismatch === true,
  };
  if (options.expectedImageRevision !== undefined) {
    body.expectedImageRevision = options.expectedImageRevision;
  }
  try {
    const res = await fetchFn(
      figmaImportPath(options.screenId, options.viewport),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify(body),
        signal: options.signal,
      },
    );
    const parsed = await readJson(res);
    if (!res.ok) {
      return { ok: false, error: parseError(res.status, parsed) };
    }
    return { ok: true, data: parsed as FigmaImportApiResponse };
  } catch (err) {
    if (
      options.signal?.aborted ||
      (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError')
    ) {
      return {
        ok: false,
        aborted: true,
        error: {
          code: 'SPEC_FIGMA_ABORTED',
          message: 'キャンセルされました。',
          status: 0,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: 'SPEC_REFERENCE_IMAGE_NETWORK',
        message: 'Figma 取り込みに失敗しました。',
        status: 0,
      },
    };
  }
}

export async function reimportFigmaReferenceImageRequest(options: {
  screenId: string;
  viewport: ReferenceViewport;
  expectedImageRevision: string;
  confirmWidthMismatch?: boolean;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}): Promise<
  | { ok: true; data: FigmaImportApiResponse }
  | { ok: false; error: FigmaImportApiError; aborted?: boolean }
> {
  const fetchFn = options.fetchFn ?? fetch;
  try {
    const res = await fetchFn(
      figmaReimportPath(options.screenId, options.viewport),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          expectedImageRevision: options.expectedImageRevision,
          confirmWidthMismatch: options.confirmWidthMismatch === true,
        }),
        signal: options.signal,
      },
    );
    const parsed = await readJson(res);
    if (!res.ok) {
      return { ok: false, error: parseError(res.status, parsed) };
    }
    return { ok: true, data: parsed as FigmaImportApiResponse };
  } catch (err) {
    if (
      options.signal?.aborted ||
      (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError')
    ) {
      return {
        ok: false,
        aborted: true,
        error: {
          code: 'SPEC_FIGMA_ABORTED',
          message: 'キャンセルされました。',
          status: 0,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: 'SPEC_REFERENCE_IMAGE_NETWORK',
        message: 'Figma 再取り込みに失敗しました。',
        status: 0,
      },
    };
  }
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
