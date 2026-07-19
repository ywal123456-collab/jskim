import { createFigmaError, maskUrlForLog } from './errors.js';
import {
  FIGMA_DEFAULT_DOWNLOAD_TIMEOUT_MS,
  FIGMA_DEFAULT_OPERATION_DEADLINE_MS,
  FIGMA_MAX_IMAGE_BYTES,
  FIGMA_MAX_REDIRECTS,
} from './types.js';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export type DownloadFigmaPngOptions = {
  imageUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  maxBytes?: number;
  maxRedirects?: number;
  downloadTimeoutMs?: number;
  operationDeadlineMs?: number;
  operationStartedAtMs?: number;
  nowMs?: () => number;
};

function assertHttpsUrl(urlString: string, base?: string): URL {
  let u: URL;
  try {
    u = base ? new URL(urlString, base) : new URL(urlString);
  } catch {
    throw createFigmaError(
      'SPEC_FIGMA_DOWNLOAD_FAILED',
      'エクスポート画像のダウンロードに失敗しました。',
    );
  }
  if (u.protocol !== 'https:') {
    throw createFigmaError(
      'SPEC_FIGMA_DOWNLOAD_FAILED',
      'エクスポート画像 URL は HTTPS である必要があります。',
    );
  }
  if (u.username || u.password) {
    throw createFigmaError(
      'SPEC_FIGMA_DOWNLOAD_FAILED',
      'エクスポート画像 URL に認証情報を含められません。',
    );
  }
  return u;
}

function contentTypeIsPng(value: string | null): boolean {
  if (!value) {
    return false;
  }
  const main = value.split(';')[0]?.trim().toLowerCase();
  return main === 'image/png';
}

async function readBodyWithLimit(
  res: Response,
  maxBytes: number,
): Promise<Buffer> {
  const contentLength = res.headers.get('content-length');
  if (contentLength != null) {
    const len = Number(contentLength);
    if (Number.isFinite(len) && len > maxBytes) {
      // body を読まずに拒否（可能なら cancel）
      try {
        await res.body?.cancel();
      } catch {
        // ignore
      }
      throw createFigmaError(
        'SPEC_FIGMA_IMAGE_TOO_LARGE',
        '画像サイズが上限（20 MiB）を超えています。',
      );
    }
  }

  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      throw createFigmaError(
        'SPEC_FIGMA_IMAGE_TOO_LARGE',
        '画像サイズが上限（20 MiB）を超えています。',
      );
    }
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        throw createFigmaError(
          'SPEC_FIGMA_IMAGE_TOO_LARGE',
          '画像サイズが上限（20 MiB）を超えています。',
        );
      }
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      throw err;
    }
    throw createFigmaError(
      'SPEC_FIGMA_DOWNLOAD_FAILED',
      'エクスポート画像のダウンロードに失敗しました。',
    );
  }

  if (total === 0) {
    throw createFigmaError(
      'SPEC_FIGMA_DOWNLOAD_FAILED',
      'エクスポート画像の本文が空です。',
    );
  }
  return Buffer.concat(chunks, total);
}

function assertPngBuffer(bytes: Buffer): void {
  if (
    bytes.length < PNG_SIGNATURE.length ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
  ) {
    throw createFigmaError(
      'SPEC_FIGMA_DOWNLOAD_FAILED',
      'ダウンロードしたデータが PNG ではありません。',
    );
  }
}

/**
 * Figma export 一時 URL から PNG をダウンロードする。
 * X-Figma-Token は付けない。redirect は手動検証する。
 */
export async function downloadFigmaPng(
  options: DownloadFigmaPngOptions,
): Promise<Buffer> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? FIGMA_MAX_IMAGE_BYTES;
  const maxRedirects = options.maxRedirects ?? FIGMA_MAX_REDIRECTS;
  const nowMs = options.nowMs ?? Date.now;
  const startedAt = options.operationStartedAtMs ?? nowMs();
  const operationDeadlineMs =
    options.operationDeadlineMs ?? FIGMA_DEFAULT_OPERATION_DEADLINE_MS;
  const downloadTimeoutMs =
    options.downloadTimeoutMs ?? FIGMA_DEFAULT_DOWNLOAD_TIMEOUT_MS;

  let currentUrl = assertHttpsUrl(options.imageUrl).toString();
  // ログ用に host のみ残せるよう参照（値は返さない）
  void maskUrlForLog(currentUrl);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (options.signal?.aborted) {
      throw createFigmaError('SPEC_FIGMA_ABORTED', '操作が中断されました。');
    }
    const remaining = operationDeadlineMs - (nowMs() - startedAt);
    if (remaining <= 0) {
      throw createFigmaError(
        'SPEC_FIGMA_TIMEOUT',
        'Figma API またはダウンロードがタイムアウトしました。',
      );
    }

    const timeoutMs = Math.min(downloadTimeoutMs, remaining);
    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onParentAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'image/png',
        },
      });
    } catch {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onParentAbort);
      if (options.signal?.aborted) {
        throw createFigmaError('SPEC_FIGMA_ABORTED', '操作が中断されました。');
      }
      throw createFigmaError(
        'SPEC_FIGMA_TIMEOUT',
        'Figma API またはダウンロードがタイムアウトしました。',
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onParentAbort);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        throw createFigmaError(
          'SPEC_FIGMA_DOWNLOAD_FAILED',
          'エクスポート画像のリダイレクト先が不正です。',
        );
      }
      if (hop >= maxRedirects) {
        throw createFigmaError(
          'SPEC_FIGMA_DOWNLOAD_FAILED',
          'エクスポート画像のリダイレクト回数が上限を超えました。',
        );
      }
      currentUrl = assertHttpsUrl(location, currentUrl).toString();
      void maskUrlForLog(currentUrl);
      continue;
    }

    if (!res.ok) {
      try {
        await res.body?.cancel();
      } catch {
        // ignore
      }
      throw createFigmaError(
        'SPEC_FIGMA_DOWNLOAD_FAILED',
        'エクスポート画像のダウンロードに失敗しました。',
      );
    }

    if (!contentTypeIsPng(res.headers.get('content-type'))) {
      try {
        await res.body?.cancel();
      } catch {
        // ignore
      }
      throw createFigmaError(
        'SPEC_FIGMA_DOWNLOAD_FAILED',
        'ダウンロード応答の Content-Type が image/png ではありません。',
      );
    }

    const bytes = await readBodyWithLimit(res, maxBytes);
    assertPngBuffer(bytes);
    return bytes;
  }

  throw createFigmaError(
    'SPEC_FIGMA_DOWNLOAD_FAILED',
    'エクスポート画像のリダイレクト回数が上限を超えました。',
  );
}
