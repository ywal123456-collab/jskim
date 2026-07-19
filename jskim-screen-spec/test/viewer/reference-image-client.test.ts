import { describe, expect, it, vi } from 'vitest';
import {
  MAX_REFERENCE_IMAGE_UPLOAD_BYTES,
  formatFigmaViewerError,
  validateReferenceImageFile,
  waitForReferenceImageManifest,
} from '../../src/viewer/preview/reference-image-client.js';

function pngFile(size = 100): File {
  const file = new File([new Uint8Array(Math.min(size, 1024))], 'a.png', {
    type: 'image/png',
  });
  if (size !== file.size) {
    Object.defineProperty(file, 'size', { value: size, configurable: true });
  }
  return file;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('validateReferenceImageFile', () => {
  it('未選択は選択案内を返す', () => {
    const result = validateReferenceImageFile(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('PNGファイルを選択してください');
    }
  });

  it('空ファイル（size 0）は選択案内を返す', () => {
    const file = pngFile(0);
    const result = validateReferenceImageFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('PNGファイルを選択してください');
    }
  });

  it('20MiB を超えるファイルはサイズ超過を返す', () => {
    const file = pngFile(MAX_REFERENCE_IMAGE_UPLOAD_BYTES + 1);
    const result = validateReferenceImageFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('上限を超えています');
    }
  });

  it('20MiB ちょうどは許可される', () => {
    const file = pngFile(MAX_REFERENCE_IMAGE_UPLOAD_BYTES);
    const result = validateReferenceImageFile(file);
    expect(result.ok).toBe(true);
  });

  it('PNG 以外の MIME type は拒否される', () => {
    const file = new File([new Uint8Array(10)], 'a.jpg', {
      type: 'image/jpeg',
    });
    const result = validateReferenceImageFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('PNG形式の画像のみ登録できます');
    }
  });

  it('type が空でも許可（server 側検証に委ねる）', () => {
    const file = new File([new Uint8Array(10)], 'a.png', { type: '' });
    const result = validateReferenceImageFile(file);
    expect(result.ok).toBe(true);
  });

  it('正常な PNG ファイルは許可される', () => {
    const file = pngFile(1024);
    const result = validateReferenceImageFile(file);
    expect(result.ok).toBe(true);
  });
});

describe('waitForReferenceImageManifest', () => {
  it('revision モードで一致すれば即座に true を返す', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        referenceImages: {
          pc: { status: 'current', imageRevision: 'sha256:' + 'b'.repeat(64) },
        },
      }),
    );
    const ok = await waitForReferenceImageManifest({
      screenDataUrl: '/spec/data/screens/demo.json',
      viewport: 'pc',
      mode: 'revision',
      expectedImageRevision: 'sha256:' + 'b'.repeat(64),
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('missing モードで status missing なら true を返す', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        referenceImages: { sp: { status: 'missing' } },
      }),
    );
    const ok = await waitForReferenceImageManifest({
      screenDataUrl: '/spec/data/screens/demo.json',
      viewport: 'sp',
      mode: 'missing',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(ok).toBe(true);
  });

  it('missing モードで entry 自体が無い場合も true を返す', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ referenceImages: {} }));
    const ok = await waitForReferenceImageManifest({
      screenDataUrl: '/spec/data/screens/demo.json',
      viewport: 'pc',
      mode: 'missing',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(ok).toBe(true);
  });

  it('revision が一致するまでリトライする', async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      return jsonResponse({
        referenceImages: {
          pc: {
            status: 'current',
            imageRevision:
              calls >= 2 ? 'sha256:' + 'e'.repeat(64) : 'sha256:' + 'b'.repeat(64),
          },
        },
      });
    });
    const ok = await waitForReferenceImageManifest({
      screenDataUrl: '/spec/data/screens/demo.json',
      viewport: 'pc',
      mode: 'revision',
      expectedImageRevision: 'sha256:' + 'e'.repeat(64),
      intervalMs: 5,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(ok).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('signal が既に abort 済みなら即座に false を返す', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ referenceImages: { pc: { status: 'missing' } } }),
    );
    const controller = new AbortController();
    controller.abort();
    const ok = await waitForReferenceImageManifest({
      screenDataUrl: '/spec/data/screens/demo.json',
      viewport: 'pc',
      mode: 'revision',
      expectedImageRevision: 'sha256:' + 'b'.repeat(64),
      signal: controller.signal,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetch 失敗時はリトライし、abort されると false を返す', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('network error');
    });
    const controller = new AbortController();
    const promise = waitForReferenceImageManifest({
      screenDataUrl: '/spec/data/screens/demo.json',
      viewport: 'pc',
      mode: 'missing',
      intervalMs: 5,
      signal: controller.signal,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    const ok = await promise;
    expect(ok).toBe(false);
  });
});

describe('formatFigmaViewerError', () => {
  it('429 は Retry-After 秒数を日本語メッセージに含める', () => {
    const message = formatFigmaViewerError({
      code: 'SPEC_FIGMA_RATE_LIMITED',
      message: 'rate',
      status: 429,
      retryAfterSeconds: 12,
    });
    expect(message).toContain('利用上限');
    expect(message).toContain('12');
    expect(message).not.toContain('token');
  });
});
