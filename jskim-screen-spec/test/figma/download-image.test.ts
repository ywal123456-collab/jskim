import { describe, expect, it } from 'vitest';
import { downloadFigmaPng } from '../../src/figma/download-image.js';
import { FigmaError } from '../../src/figma/errors.js';
import { FIGMA_MAX_IMAGE_BYTES } from '../../src/figma/types.js';
import {
  createMockFetch,
  pngResponse,
  redirectResponse,
  samplePng,
} from './mock-fetch.js';

describe('downloadFigmaPng', () => {
  it('PNG ダウンロードに成功する', async () => {
    const png = samplePng(10, 20);
    const fetchImpl = createMockFetch([
      {
        match: (u) => u.startsWith('https://cdn.example/a.png'),
        handle: (_u, init) => {
          const headers = new Headers(init?.headers);
          expect(headers.get('X-Figma-Token')).toBeNull();
          expect(headers.get('Authorization')).toBeNull();
          return pngResponse(png);
        },
      },
    ]);
    const bytes = await downloadFigmaPng({
      imageUrl: 'https://cdn.example/a.png?sig=SECRET_QUERY',
      fetchImpl,
    });
    expect(bytes.equals(png)).toBe(true);
  });

  it('Content-Type と signature を検証する', async () => {
    const png = samplePng(8, 8);
    await expect(
      downloadFigmaPng({
        imageUrl: 'https://cdn.example/x',
        fetchImpl: createMockFetch([
          {
            match: () => true,
            handle: () =>
              new Response(Uint8Array.from(png), {
                status: 200,
                headers: { 'content-type': 'text/plain' },
              }),
          },
        ]),
      }),
    ).rejects.toMatchObject({ code: 'SPEC_FIGMA_DOWNLOAD_FAILED' });

    await expect(
      downloadFigmaPng({
        imageUrl: 'https://cdn.example/x',
        fetchImpl: createMockFetch([
          {
            match: () => true,
            handle: () =>
              new Response(Buffer.from('not-png!!!!'), {
                status: 200,
                headers: { 'content-type': 'image/png' },
              }),
          },
        ]),
      }),
    ).rejects.toMatchObject({ code: 'SPEC_FIGMA_DOWNLOAD_FAILED' });
  });

  it('Content-Length 超過と stream 超過を拒否する', async () => {
    await expect(
      downloadFigmaPng({
        imageUrl: 'https://cdn.example/big',
        maxBytes: 100,
        fetchImpl: createMockFetch([
          {
            match: () => true,
            handle: () =>
              new Response(Uint8Array.from(samplePng(10, 10)), {
                status: 200,
                headers: {
                  'content-type': 'image/png',
                  'content-length': '9999',
                },
              }),
          },
        ]),
      }),
    ).rejects.toMatchObject({ code: 'SPEC_FIGMA_IMAGE_TOO_LARGE' });

    const over = Buffer.alloc(120, 1);
    over.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    await expect(
      downloadFigmaPng({
        imageUrl: 'https://cdn.example/stream',
        maxBytes: 100,
        fetchImpl: createMockFetch([
          {
            match: () => true,
            handle: () =>
              new Response(over, {
                status: 200,
                headers: { 'content-type': 'image/png' },
              }),
          },
        ]),
      }),
    ).rejects.toMatchObject({ code: 'SPEC_FIGMA_IMAGE_TOO_LARGE' });
  });

  it('HTTPS→HTTPS redirect と相対 redirect を辿る', async () => {
    const png = samplePng(5, 5);
    let hops = 0;
    const fetchImpl = createMockFetch([
      {
        match: (u) => u.includes('/start'),
        handle: () => {
          hops += 1;
          return redirectResponse('https://cdn.example/next');
        },
      },
      {
        match: (u) => u.includes('/next'),
        handle: () => {
          hops += 1;
          return redirectResponse('/final.png');
        },
      },
      {
        match: (u) => u.includes('/final.png'),
        handle: () => {
          hops += 1;
          return pngResponse(png);
        },
      },
    ]);
    const bytes = await downloadFigmaPng({
      imageUrl: 'https://cdn.example/start',
      fetchImpl,
    });
    expect(bytes.equals(png)).toBe(true);
    expect(hops).toBe(3);
  });

  it('HTTPS→HTTP redirect と redirect 上限を拒否する', async () => {
    await expect(
      downloadFigmaPng({
        imageUrl: 'https://cdn.example/start',
        fetchImpl: createMockFetch([
          {
            match: () => true,
            handle: () => redirectResponse('http://cdn.example/bad'),
          },
        ]),
      }),
    ).rejects.toMatchObject({ code: 'SPEC_FIGMA_DOWNLOAD_FAILED' });

    await expect(
      downloadFigmaPng({
        imageUrl: 'https://cdn.example/a',
        maxRedirects: 1,
        fetchImpl: createMockFetch([
          {
            match: (u) => u.endsWith('/a'),
            handle: () => redirectResponse('https://cdn.example/b'),
          },
          {
            match: (u) => u.endsWith('/b'),
            handle: () => redirectResponse('https://cdn.example/c'),
          },
        ]),
      }),
    ).rejects.toMatchObject({ code: 'SPEC_FIGMA_DOWNLOAD_FAILED' });
  });

  it('HTTP 初期 URL と userinfo を拒否する', async () => {
    await expect(
      downloadFigmaPng({
        imageUrl: 'http://cdn.example/a.png',
        fetchImpl: createMockFetch([]),
      }),
    ).rejects.toBeInstanceOf(FigmaError);

    await expect(
      downloadFigmaPng({
        imageUrl: 'https://user:pass@cdn.example/a.png',
        fetchImpl: createMockFetch([]),
      }),
    ).rejects.toBeInstanceOf(FigmaError);
  });

  it('download limit は Reference と同値（20 MiB）', () => {
    expect(FIGMA_MAX_IMAGE_BYTES).toBe(20 * 1024 * 1024);
  });

  it('エラーメッセージに signed query を含めない', async () => {
    try {
      await downloadFigmaPng({
        imageUrl: 'https://cdn.example/a.png?sig=SUPER_SECRET_SIGNATURE',
        fetchImpl: createMockFetch([
          {
            match: () => true,
            handle: () =>
              new Response(null, { status: 500 }),
          },
        ]),
      });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain('SUPER_SECRET_SIGNATURE');
      expect(JSON.stringify(err)).not.toContain('SUPER_SECRET_SIGNATURE');
    }
  });
});
