import { describe, expect, it, vi } from 'vitest';
import { createFigmaApiClient } from '../../src/figma/client.js';
import { FigmaError } from '../../src/figma/errors.js';
import {
  createMockFetch,
  defaultFrameNodesBody,
  defaultImagesBody,
  jsonResponse,
} from './mock-fetch.js';

const TOKEN = 'test-token-not-real';

describe('FigmaApiClient', () => {
  it('Frame 照会に成功し寸法を返す', async () => {
    const fetchImpl = createMockFetch([
      {
        match: (u) => u.includes('/nodes'),
        handle: () =>
          jsonResponse(
            defaultFrameNodesBody({
              nodeId: '1:3',
              width: 1600,
              height: 900,
              name: 'PC Frame',
            }),
          ),
      },
    ]);
    const client = createFigmaApiClient({ token: TOKEN, fetchImpl });
    const frame = await client.getFrame('FILEKEY', '1:3');
    expect(frame).toMatchObject({
      fileKey: 'FILEKEY',
      nodeId: '1:3',
      frameName: 'PC Frame',
      width: 1600,
      height: 900,
    });
  });

  it('null node / FRAME 以外を拒否する', async () => {
    const nullFetch = createMockFetch([
      {
        match: () => true,
        handle: () => jsonResponse({ nodes: { '1:3': null } }),
      },
    ]);
    await expect(
      createFigmaApiClient({ token: TOKEN, fetchImpl: nullFetch }).getFrame(
        'K',
        '1:3',
      ),
    ).rejects.toMatchObject({ code: 'SPEC_FIGMA_NODE_NOT_FOUND' });

    const rectFetch = createMockFetch([
      {
        match: () => true,
        handle: () =>
          jsonResponse(defaultFrameNodesBody({ type: 'RECTANGLE' })),
      },
    ]);
    await expect(
      createFigmaApiClient({ token: TOKEN, fetchImpl: rectFetch }).getFrame(
        'K',
        '1:3',
      ),
    ).rejects.toMatchObject({ code: 'SPEC_FIGMA_NODE_NOT_FRAME' });
  });

  it('export URL 成功と null URL を扱う', async () => {
    const ok = createMockFetch([
      {
        match: () => true,
        handle: () =>
          jsonResponse(
            defaultImagesBody('1:3', 'https://cdn.example/img.png'),
          ),
      },
    ]);
    const exported = await createFigmaApiClient({
      token: TOKEN,
      fetchImpl: ok,
    }).getPngExportUrl('K', '1:3');
    expect(exported.imageUrl).toBe('https://cdn.example/img.png');
    expect(exported.exportScale).toBe(1);

    const nullUrl = createMockFetch([
      {
        match: () => true,
        handle: () => jsonResponse({ images: { '1:3': null } }),
      },
    ]);
    await expect(
      createFigmaApiClient({ token: TOKEN, fetchImpl: nullUrl }).getPngExportUrl(
        'K',
        '1:3',
      ),
    ).rejects.toMatchObject({ code: 'SPEC_FIGMA_EXPORT_FAILED' });
  });

  it('HTTP / HTTP 以外の export URL を拒否する', async () => {
    const httpUrl = createMockFetch([
      {
        match: () => true,
        handle: () =>
          jsonResponse(defaultImagesBody('1:3', 'http://cdn.example/x.png')),
      },
    ]);
    await expect(
      createFigmaApiClient({
        token: TOKEN,
        fetchImpl: httpUrl,
      }).getPngExportUrl('K', '1:3'),
    ).rejects.toMatchObject({ code: 'SPEC_FIGMA_EXPORT_FAILED' });
  });

  it('401/403/404/400/500 を分類する', async () => {
    for (const [status, code] of [
      [401, 'SPEC_FIGMA_UNAUTHORIZED'],
      [403, 'SPEC_FIGMA_FORBIDDEN'],
      [404, 'SPEC_FIGMA_FILE_NOT_FOUND'],
      [400, 'SPEC_FIGMA_RESPONSE_INVALID'],
      [500, 'SPEC_FIGMA_RESPONSE_INVALID'],
    ] as const) {
      const fetchImpl = createMockFetch([
        {
          match: () => true,
          handle: () => jsonResponse({ err: 'x' }, { status }),
        },
      ]);
      await expect(
        createFigmaApiClient({
          token: TOKEN,
          fetchImpl,
          sleep: async () => {},
          operationDeadlineMs: 1000,
        }).getFrame('K', '1:3'),
      ).rejects.toMatchObject({ code });
    }
  });

  it('malformed JSON を拒否する', async () => {
    const fetchImpl = createMockFetch([
      {
        match: () => true,
        handle: () =>
          new Response('not-json', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ]);
    await expect(
      createFigmaApiClient({ token: TOKEN, fetchImpl }).getFrame('K', '1:3'),
    ).rejects.toMatchObject({ code: 'SPEC_FIGMA_RESPONSE_INVALID' });
  });

  it('deadline 内の 429 retry 後に成功する', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    let now = 0;
    const fetchImpl = createMockFetch([
      {
        match: () => true,
        handle: () => {
          calls += 1;
          if (calls === 1) {
            return jsonResponse(
              { err: 'rate' },
              {
                status: 429,
                headers: {
                  'Retry-After': '1',
                  'X-Figma-Plan-Tier': 'pro',
                  'X-Figma-Rate-Limit-Type': 'high',
                  'X-Figma-Upgrade-Link': 'https://www.figma.com/pricing',
                },
              },
            );
          }
          return jsonResponse(defaultFrameNodesBody());
        },
      },
    ]);
    const frame = await createFigmaApiClient({
      token: TOKEN,
      fetchImpl,
      nowMs: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      operationDeadlineMs: 10_000,
    }).getFrame('K', '1:3');
    expect(frame.frameName).toBe('Hero');
    expect(calls).toBe(2);
    expect(sleeps).toEqual([1000]);
  });

  it('Retry-After が deadline を超えると即 RATE_LIMITED', async () => {
    const fetchImpl = createMockFetch([
      {
        match: () => true,
        handle: () =>
          jsonResponse(
            {},
            {
              status: 429,
              headers: { 'Retry-After': '999' },
            },
          ),
      },
    ]);
    await expect(
      createFigmaApiClient({
        token: TOKEN,
        fetchImpl,
        nowMs: () => 0,
        sleep: async () => {
          throw new Error('sleep すべきでない');
        },
        operationDeadlineMs: 1000,
        operationStartedAtMs: 0,
      }).getFrame('K', '1:3'),
    ).rejects.toMatchObject({
      code: 'SPEC_FIGMA_RATE_LIMITED',
      details: { retryAfterSeconds: 999 },
    });
  });

  it('abort で SPEC_FIGMA_ABORTED になる', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = createMockFetch([
      {
        match: () => true,
        handle: async () => {
          throw new Error('呼ばれるべきでない');
        },
      },
    ]);
    await expect(
      createFigmaApiClient({
        token: TOKEN,
        fetchImpl,
        signal: controller.signal,
      }).getFrame('K', '1:3'),
    ).rejects.toMatchObject({ code: 'SPEC_FIGMA_ABORTED' });
  });

  it('リクエストに X-Figma-Token を付け、エラーに token を載せない', async () => {
    let sawToken = false;
    const fetchImpl = createMockFetch([
      {
        match: () => true,
        handle: (_u, init) => {
          const headers = new Headers(init?.headers);
          sawToken = headers.get('X-Figma-Token') === TOKEN;
          return jsonResponse({}, { status: 401 });
        },
      },
    ]);
    try {
      await createFigmaApiClient({ token: TOKEN, fetchImpl }).getFrame(
        'K',
        '1:3',
      );
      expect.unreachable();
    } catch (err) {
      expect(sawToken).toBe(true);
      expect(err).toBeInstanceOf(FigmaError);
      expect(JSON.stringify(err)).not.toContain(TOKEN);
      expect(String(err)).not.toContain(TOKEN);
    }
  });

  it('不正な Upgrade-Link を details に載せない', async () => {
    const fetchImpl = createMockFetch([
      {
        match: () => true,
        handle: () =>
          jsonResponse(
            {},
            {
              status: 429,
              headers: {
                'Retry-After': '50',
                'X-Figma-Upgrade-Link': 'https://evil.example/phish',
              },
            },
          ),
      },
    ]);
    try {
      await createFigmaApiClient({
        token: TOKEN,
        fetchImpl,
        nowMs: () => 0,
        sleep: async () => {},
        operationDeadlineMs: 10,
        operationStartedAtMs: 0,
      }).getFrame('K', '1:3');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FigmaError);
      expect((err as FigmaError).details?.upgradeLink).toBeUndefined();
    }
  });

  it('timeout 時に AbortController で中断する', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = (async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        await new Promise<void>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error('signal なし'));
            return;
          }
          signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
        return jsonResponse({});
      }) as typeof fetch;

      const promise = createFigmaApiClient({
        token: TOKEN,
        fetchImpl,
        requestTimeoutMs: 100,
        operationDeadlineMs: 10_000,
        nowMs: () => 0,
        sleep: async () => {},
      }).getFrame('K', '1:3');

      const expectation = expect(promise).rejects.toMatchObject({
        code: 'SPEC_FIGMA_TIMEOUT',
      });
      await vi.advanceTimersByTimeAsync(150);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
