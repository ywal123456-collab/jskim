import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { useReferenceImagePanel } from '../../src/viewer/preview/useReferenceImagePanel.js';
import type { ScreenData } from '../../src/viewer/types.js';
import { peekPendingReferenceImage } from '../../src/viewer/preview/pending-reference-image.js';
import type { ReferenceViewport } from '../../src/viewer/preview/preview-provider.js';

function makeScreen(pcStatus: 'missing' | 'current' = 'missing'): ScreenData {
  const pc =
    pcStatus === 'missing'
      ? { status: 'missing' as const }
      : {
          status: 'current' as const,
          imagePath: 'reference-images/demo/pc/image-bb.png',
          imageRevision: 'sha256:' + 'b'.repeat(64),
          imageWidth: 1440,
          imageHeight: 900,
          viewportWidth: 1440,
          viewportHeight: 900,
          uploadedAt: '2026-07-18T00:00:00.000Z',
        };
  return {
    id: 'demo',
    name: 'Demo',
    description: '',
    path: '/index.html',
    itemOrder: [],
    items: {},
    states: [],
    interactions: [],
    status: 'linked',
    hasDescription: true,
    hasImplementation: true,
    hasPreview: true,
    referenceImages: { pc, sp: { status: 'missing' } },
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pngFile(): File {
  return new File([new Uint8Array(10)], 'a.png', { type: 'image/png' });
}

function mountPanel(options: {
  fetchFn: typeof fetch;
  viewport?: ReferenceViewport | null;
  active?: boolean;
  editable?: boolean;
  blocked?: boolean;
  screen?: ScreenData;
  reloadScreen?: () => Promise<void>;
}) {
  const screen = ref(options.screen ?? makeScreen('current'));
  const viewport = ref<ReferenceViewport | null>(
    options.viewport === undefined ? 'pc' : options.viewport,
  );
  const active = ref(options.active !== false);
  const reload = options.reloadScreen ?? (async () => {});
  let api: ReturnType<typeof useReferenceImagePanel> | null = null;

  const Comp = defineComponent({
    setup() {
      api = useReferenceImagePanel({
        projectName: () => 'sample',
        screenId: () => 'demo',
        viewport: () => viewport.value,
        active: () => active.value,
        screen: () => screen.value,
        editable: () => options.editable !== false,
        blocked: () => options.blocked === true,
        reloadScreen: reload,
        screenDataUrl: () => '/spec/data/screens/demo.json',
        fetchFn: options.fetchFn,
        pollIntervalMs: 20,
      });
      return () => null;
    },
  });

  const wrapper = mount(Comp);
  return { wrapper, api: api!, screen, viewport, active };
}

describe('useReferenceImagePanel', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('PUT created は expected revision 待ち後に pending 解除', async () => {
    let screenReads = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('reference-images/status')) {
        return jsonResponse({
          screenId: 'demo',
          viewport: 'pc',
          runtime: { status: 'idle' },
          referenceImage: { status: 'missing' },
        });
      }
      if (method === 'PUT' && url.includes('/reference-images/demo/pc')) {
        return jsonResponse({
          screenId: 'demo',
          viewport: 'pc',
          result: 'created',
          referenceImage: {
            status: 'current',
            imageRevision: 'sha256:' + 'e'.repeat(64),
            imageWidth: 1440,
            imageHeight: 900,
            uploadedAt: '2026-07-18T00:00:00.000Z',
          },
        });
      }
      if (url.includes('/screens/demo.json')) {
        screenReads += 1;
        const referenceImages =
          screenReads >= 2
            ? {
                pc: {
                  status: 'current',
                  imageRevision: 'sha256:' + 'e'.repeat(64),
                },
              }
            : { pc: { status: 'missing' } };
        return jsonResponse({ referenceImages });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const { wrapper, api } = mountPanel({
      fetchFn,
      screen: makeScreen('missing'),
    });
    await flushPromises();
    await api.uploadOrReplace({ file: pngFile(), expectedImageRevision: null });
    await flushPromises();
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 30));
      await flushPromises();
      if (!api.awaitingManifest.value) {
        break;
      }
    }
    expect(api.awaitingManifest.value).toBe(false);
    expect(api.localPending.value).toBe(false);
    expect(peekPendingReferenceImage('sample')).toBeNull();
    expect(api.infoMessage.value).toContain('更新しました');
    wrapper.unmount();
  });

  it('PUT unchanged は即座に完了し pending を残さない', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('reference-images/status')) {
        return jsonResponse({
          screenId: 'demo',
          viewport: 'pc',
          runtime: { status: 'idle' },
          referenceImage: {
            status: 'current',
            imageRevision: 'sha256:' + 'b'.repeat(64),
          },
        });
      }
      if (method === 'PUT') {
        return jsonResponse({
          screenId: 'demo',
          viewport: 'pc',
          result: 'unchanged',
          referenceImage: {
            status: 'current',
            imageRevision: 'sha256:' + 'b'.repeat(64),
            imageWidth: 1440,
            imageHeight: 900,
            uploadedAt: '2026-07-18T00:00:00.000Z',
          },
        });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const { wrapper, api } = mountPanel({ fetchFn, screen: makeScreen('current') });
    await flushPromises();
    await api.uploadOrReplace({
      file: pngFile(),
      expectedImageRevision: 'sha256:' + 'b'.repeat(64),
    });
    await flushPromises();
    expect(api.infoMessage.value).toContain('同じ参照画像が登録されています');
    expect(api.awaitingManifest.value).toBe(false);
    expect(peekPendingReferenceImage('sample')).toBeNull();
    wrapper.unmount();
  });

  it('DELETE は missing 反映を待って完了する', async () => {
    let screenReads = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('reference-images/status')) {
        return jsonResponse({
          screenId: 'demo',
          viewport: 'pc',
          runtime: { status: 'idle' },
          referenceImage: {
            status: 'current',
            imageRevision: 'sha256:' + 'b'.repeat(64),
          },
        });
      }
      if (method === 'DELETE') {
        return jsonResponse({
          screenId: 'demo',
          viewport: 'pc',
          result: 'deleted',
          deletedImageRevision: 'sha256:' + 'b'.repeat(64),
        });
      }
      if (url.includes('/screens/demo.json')) {
        screenReads += 1;
        const referenceImages =
          screenReads >= 2
            ? { pc: { status: 'missing' } }
            : {
                pc: {
                  status: 'current',
                  imageRevision: 'sha256:' + 'b'.repeat(64),
                },
              };
        return jsonResponse({ referenceImages });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const { wrapper, api } = mountPanel({ fetchFn, screen: makeScreen('current') });
    await flushPromises();
    await api.deleteCurrent('sha256:' + 'b'.repeat(64));
    await flushPromises();
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 30));
      await flushPromises();
      if (!api.awaitingManifest.value) {
        break;
      }
    }
    expect(api.awaitingManifest.value).toBe(false);
    expect(peekPendingReferenceImage('sample')).toBeNull();
    expect(api.infoMessage.value).toContain('削除しました');
    wrapper.unmount();
  });

  it('409 in-progress は status polling に入る', async () => {
    let putDone = false;
    let statusAfterPut = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('reference-images/status')) {
        if (!putDone) {
          return jsonResponse({
            screenId: 'demo',
            viewport: 'pc',
            runtime: { status: 'idle' },
            referenceImage: {
              status: 'current',
              imageRevision: 'sha256:' + 'b'.repeat(64),
            },
          });
        }
        statusAfterPut += 1;
        return jsonResponse({
          screenId: 'demo',
          viewport: 'pc',
          runtime: { status: statusAfterPut < 2 ? 'uploading' : 'idle' },
          referenceImage: {
            status: 'current',
            imageRevision: 'sha256:' + 'b'.repeat(64),
          },
        });
      }
      if (method === 'PUT') {
        putDone = true;
        return jsonResponse(
          {
            code: 'SPEC_REFERENCE_IMAGE_IN_PROGRESS',
            message:
              '同じ参照画像を更新または削除しています。完了後に再度実行してください。',
          },
          409,
        );
      }
      if (url.includes('/screens/demo.json')) {
        return jsonResponse({
          referenceImages: {
            pc: { status: 'current', imageRevision: 'sha256:' + 'b'.repeat(64) },
          },
        });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const { wrapper, api } = mountPanel({ fetchFn, screen: makeScreen('current') });
    await flushPromises();
    await api.uploadOrReplace({
      file: pngFile(),
      expectedImageRevision: 'sha256:' + 'b'.repeat(64),
    });
    await flushPromises();
    expect(api.statusMessage.value).toContain('アップロード中');
    expect(api.runtime.value.status).toBe('uploading');
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      await flushPromises();
      if (api.runtime.value.status === 'idle') {
        break;
      }
    }
    expect(statusAfterPut).toBeGreaterThan(1);
    wrapper.unmount();
  });

  it('500 でも既存参照画像を壊さず failed を残す', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('reference-images/status')) {
        return jsonResponse({
          screenId: 'demo',
          viewport: 'pc',
          runtime: { status: 'idle' },
          referenceImage: {
            status: 'current',
            imageRevision: 'sha256:' + 'b'.repeat(64),
          },
        });
      }
      if (method === 'PUT') {
        return jsonResponse(
          {
            code: 'SPEC_REFERENCE_IMAGE_FAILED',
            message: '参照画像の更新に失敗しました。',
          },
          500,
        );
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const { wrapper, api } = mountPanel({ fetchFn, screen: makeScreen('current') });
    await flushPromises();
    await api.uploadOrReplace({
      file: pngFile(),
      expectedImageRevision: 'sha256:' + 'b'.repeat(64),
    });
    await flushPromises();
    expect(api.runtime.value.status).toBe('failed');
    expect(api.errorMessage.value).toContain('失敗');
    expect(api.persistedReference.value?.status).toBe('current');
    wrapper.unmount();
  });

  it('revision conflict は Viewer 案内を保ち reloadScreen する', async () => {
    const reloadScreen = vi.fn(async () => {});
    let statusCalls = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('reference-images/status')) {
        statusCalls += 1;
        // API は conflict 後に runtime.failed を返すことがある。
        // その文言で Viewer 案内を上書きしてはならない。
        return jsonResponse({
          screenId: 'demo',
          viewport: 'pc',
          runtime: {
            status: 'failed',
            operation: 'upload',
            error: {
              code: 'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT',
              message: '参照画像の revision が一致しません。最新を再読込してください。',
            },
          },
          referenceImage: {
            status: 'current',
            imageRevision: 'sha256:' + 'b'.repeat(64),
          },
        });
      }
      if (method === 'PUT') {
        return jsonResponse(
          {
            code: 'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT',
            message: '参照画像の revision が一致しません。最新を再読込してください。',
          },
          409,
        );
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const { wrapper, api } = mountPanel({
      fetchFn,
      screen: makeScreen('current'),
      reloadScreen,
    });
    await flushPromises();
    const statusCallsBefore = statusCalls;
    await api.uploadOrReplace({
      file: pngFile(),
      expectedImageRevision: 'sha256:' + 'a'.repeat(64),
    });
    await flushPromises();
    expect(api.errorMessage.value).toContain('別の操作で更新されました');
    expect(api.errorMessage.value).not.toContain('revision が一致しません');
    expect(api.runtime.value.status).toBe('idle');
    expect(reloadScreen).toHaveBeenCalled();
    // conflict 経路では失敗 runtime を取りに行かない
    expect(statusCalls).toBe(statusCallsBefore);
    wrapper.unmount();
  });

  it('read-only では status GET / PUT / DELETE を呼ばない', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 404 }));
    const { wrapper, api } = mountPanel({
      fetchFn: fetchFn as unknown as typeof fetch,
      editable: false,
    });
    await flushPromises();
    await api.uploadOrReplace({ file: pngFile(), expectedImageRevision: null });
    await api.deleteCurrent('sha256:' + 'b'.repeat(64));
    expect(fetchFn).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('viewport が null（Live 相当）になると polling を止める', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        screenId: 'demo',
        viewport: 'pc',
        runtime: { status: 'idle' },
        referenceImage: {
          status: 'current',
          imageRevision: 'sha256:' + 'b'.repeat(64),
        },
      }),
    );
    const { wrapper, api, viewport } = mountPanel({
      fetchFn: fetchFn as unknown as typeof fetch,
      screen: makeScreen('current'),
    });
    await flushPromises();
    const before = fetchFn.mock.calls.length;
    viewport.value = null;
    await nextTick();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 60));
    expect(api.runtime.value.status).toBe('idle');
    expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(before + 1);
    wrapper.unmount();
  });

  it('active が false（Live/PC/SP タブ表示中）では polling しない', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 404 }));
    const { wrapper, api } = mountPanel({
      fetchFn: fetchFn as unknown as typeof fetch,
      active: false,
      screen: makeScreen('current'),
    });
    await flushPromises();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(api.runtime.value.status).toBe('idle');
    wrapper.unmount();
  });

  it('古い Figma 応答は abort 後の新しい UI 状態を上書きしない', async () => {
    let resolveFirst!: (value: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    let importCalls = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('reference-images/status')) {
        return jsonResponse({
          screenId: 'demo',
          viewport: 'pc',
          runtime: { status: 'idle' },
          referenceImage: { status: 'missing' },
        });
      }
      if (method === 'POST' && url.includes('figma:import')) {
        importCalls += 1;
        if (importCalls === 1) {
          // AbortSignal を無視し、後から解決する stale 応答を再現する
          return firstResponse;
        }
        return jsonResponse({
          screenId: 'demo',
          viewport: 'pc',
          result: 'unchanged',
          referenceImage: {
            status: 'current',
            imageRevision: 'sha256:' + 'b'.repeat(64),
            imageWidth: 1440,
            imageHeight: 900,
            uploadedAt: '2026-07-18T00:00:00.000Z',
            source: {
              type: 'figma',
              frameName: 'LatestFrame',
              importedAt: '2026-07-18T12:00:00.000Z',
            },
          },
        });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const { wrapper, api } = mountPanel({
      fetchFn,
      screen: makeScreen('missing'),
    });
    await flushPromises();

    const first = api.importFromFigma({
      figmaUrl: 'https://www.figma.com/design/AAA/Name?node-id=1-2',
      expectedImageRevision: null,
      confirmWidthMismatch: false,
    });
    await flushPromises();
    expect(api.runtime.value.status).toBe('importing');

    api.abortFigmaDialogRequest();
    await flushPromises();
    expect(api.runtime.value.status).toBe('idle');
    expect(api.dialogError.value).toBe('');
    expect(api.localPending.value).toBe(false);

    const second = api.importFromFigma({
      figmaUrl: 'https://www.figma.com/design/BBB/Name?node-id=3-4',
      expectedImageRevision: null,
      confirmWidthMismatch: false,
    });
    await flushPromises();
    await second;
    expect(api.infoMessage.value).toContain('同じ参照画像');
    expect(api.runtime.value.status).toBe('idle');
    expect(api.dialogError.value).toBe('');
    expect(api.errorMessage.value).toBe('');

    resolveFirst(
      new Response(
        JSON.stringify({
          code: 'SPEC_FIGMA_BAD_REQUEST',
          message: '古いリクエストのエラーです。この文言は表示されてはいけません。',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    await first;
    await flushPromises();

    expect(api.dialogError.value).toBe('');
    expect(api.errorMessage.value).not.toContain('古いリクエスト');
    expect(api.infoMessage.value).toContain('同じ参照画像');
    expect(api.runtime.value.status).toBe('idle');
    expect(api.localPending.value).toBe(false);
    expect(api.figmaConfirmation.value).toBeNull();
    wrapper.unmount();
  });
});
