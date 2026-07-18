import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { useDeviceCapturePanel } from '../../src/viewer/preview/useDeviceCapturePanel.js';
import type { ScreenData } from '../../src/viewer/types.js';
import {
  clearPendingDeviceCapture,
  peekPendingDeviceCapture,
} from '../../src/viewer/preview/pending-device-capture.js';

function makeScreen(captureStatus: 'missing' | 'current' | 'stale' = 'missing'): ScreenData {
  const image =
    captureStatus === 'missing'
      ? { status: 'missing' as const }
      : {
          status: captureStatus,
          imagePath: 'device-captures/demo/default/pc/capture-xx.png',
          inputRevision: 'sha256:' + 'a'.repeat(64),
          imageRevision: 'sha256:' + 'b'.repeat(64),
          capturedAt: '2026-07-18T00:00:00.000Z',
          viewportWidth: 1440,
          viewportHeight: 900,
          imageWidth: 1440,
          imageHeight: 900,
        };
  return {
    id: 'demo',
    name: 'Demo',
    description: '',
    path: '/index.html',
    itemOrder: [],
    items: {},
    states: [
      {
        id: 'default',
        name: '初期',
        viewer: { visible: true, order: 1 },
        snapshotFile: 'snapshots/demo/default.html',
        deviceCaptures: { pc: image, sp: { status: 'missing' } },
      },
    ],
    interactions: [],
    status: 'linked',
    hasDescription: true,
    hasImplementation: true,
    hasPreview: true,
  };
}

function mountPanel(options: {
  fetchFn: typeof fetch;
  viewport?: 'pc' | 'sp' | null;
  editable?: boolean;
  screen?: ScreenData;
  reloadScreen?: () => Promise<void>;
}) {
  const screen = ref(options.screen ?? makeScreen('current'));
  const viewport = ref<'pc' | 'sp' | null>(options.viewport ?? 'pc');
  const reload = options.reloadScreen ?? (async () => {});
  let api: ReturnType<typeof useDeviceCapturePanel> | null = null;

  const Comp = defineComponent({
    setup() {
      api = useDeviceCapturePanel({
        projectName: () => 'sample',
        screenId: () => 'demo',
        stateId: () => 'default',
        viewport: () => viewport.value,
        screen: () => screen.value,
        editable: () => options.editable !== false,
        reloadScreen: reload,
        screenDataUrl: () => '/spec/data/screens/demo.json',
        fetchFn: options.fetchFn,
        pollIntervalMs: 20,
      });
      return () => null;
    },
  });

  const wrapper = mount(Comp);
  return { wrapper, api: api!, screen, viewport };
}

describe('useDeviceCapturePanel', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('POST created は expected revision 待ち後に pending 解除', async () => {
    let screenReads = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('device-captures/status')) {
        return new Response(
          JSON.stringify({
            screenId: 'demo',
            stateId: 'default',
            viewport: 'pc',
            runtime: { status: 'idle' },
            capture: { status: 'current', imageRevision: 'sha256:' + 'b'.repeat(64) },
          }),
          { status: 200 },
        );
      }
      if (method === 'POST' && url.includes('device-captures:collect')) {
        return new Response(
          JSON.stringify({
            screenId: 'demo',
            stateId: 'default',
            viewport: 'pc',
            result: 'created',
            capture: {
              status: 'current',
              imageRevision: 'sha256:' + 'e'.repeat(64),
              inputRevision: 'sha256:' + 'f'.repeat(64),
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('/screens/demo.json')) {
        screenReads += 1;
        const rev =
          screenReads >= 2 ? 'sha256:' + 'e'.repeat(64) : 'sha256:' + 'b'.repeat(64);
        return new Response(
          JSON.stringify({
            states: [
              {
                id: 'default',
                deviceCaptures: {
                  pc: {
                    status: 'current',
                    imageRevision: rev,
                  },
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const { wrapper, api } = mountPanel({ fetchFn });
    await flushPromises();
    await api.collectCurrent();
    await flushPromises();
    // wait loop
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 30));
      await flushPromises();
      if (!api.awaitingManifest.value) {
        break;
      }
    }
    expect(api.awaitingManifest.value).toBe(false);
    expect(api.localPending.value).toBe(false);
    expect(peekPendingDeviceCapture('sample')).toBeNull();
    expect(api.infoMessage.value).toContain('更新しました');
    wrapper.unmount();
  });

  it('POST unchanged は即座に完了し pending を残さない', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('device-captures/status')) {
        return new Response(
          JSON.stringify({
            screenId: 'demo',
            stateId: 'default',
            viewport: 'pc',
            runtime: { status: 'idle' },
            capture: { status: 'current' },
          }),
          { status: 200 },
        );
      }
      if (method === 'POST') {
        return new Response(
          JSON.stringify({
            screenId: 'demo',
            stateId: 'default',
            viewport: 'pc',
            result: 'unchanged',
            capture: { status: 'current', imageRevision: 'sha256:' + 'b'.repeat(64) },
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const { wrapper, api } = mountPanel({ fetchFn });
    await flushPromises();
    await api.collectCurrent();
    await flushPromises();
    expect(api.infoMessage.value).toContain('最新です');
    expect(api.awaitingManifest.value).toBe(false);
    expect(peekPendingDeviceCapture('sample')).toBeNull();
    wrapper.unmount();
  });

  it('409 in-progress は status polling に入る', async () => {
    let postDone = false;
    let statusAfterPost = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('device-captures/status')) {
        if (!postDone) {
          return new Response(
            JSON.stringify({
              screenId: 'demo',
              stateId: 'default',
              viewport: 'pc',
              runtime: { status: 'idle' },
              capture: { status: 'stale' },
            }),
            { status: 200 },
          );
        }
        statusAfterPost += 1;
        return new Response(
          JSON.stringify({
            screenId: 'demo',
            stateId: 'default',
            viewport: 'pc',
            runtime: {
              status: statusAfterPost < 2 ? 'collecting' : 'idle',
            },
            capture: { status: 'stale' },
          }),
          { status: 200 },
        );
      }
      if (method === 'POST') {
        postDone = true;
        return new Response(
          JSON.stringify({
            code: 'SPEC_DEVICE_CAPTURE_IN_PROGRESS',
            message: '同じDevice Previewを収集中です。',
          }),
          { status: 409 },
        );
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const { wrapper, api } = mountPanel({
      fetchFn,
      screen: makeScreen('stale'),
    });
    await flushPromises();
    await api.collectCurrent();
    await flushPromises();
    expect(api.statusMessage.value).toContain('収集中');
    expect(api.runtime.value.status).toBe('collecting');
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      await flushPromises();
      if (api.runtime.value.status === 'idle') {
        break;
      }
    }
    expect(statusAfterPost).toBeGreaterThan(1);
    wrapper.unmount();
  });

  it('500 でも既存 Capture を壊さず failed を残す', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('status')) {
        return new Response(
          JSON.stringify({
            screenId: 'demo',
            stateId: 'default',
            viewport: 'pc',
            runtime: { status: 'idle' },
            capture: { status: 'current' },
          }),
          { status: 200 },
        );
      }
      if (method === 'POST') {
        return new Response(
          JSON.stringify({
            code: 'SPEC_DEVICE_CAPTURE_FAILED',
            message: 'Device Previewの収集に失敗しました。',
          }),
          { status: 500 },
        );
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const { wrapper, api } = mountPanel({ fetchFn });
    await flushPromises();
    await api.collectCurrent();
    await flushPromises();
    expect(api.runtime.value.status).toBe('failed');
    expect(api.errorMessage.value).toContain('失敗');
    expect(api.persistedCapture.value?.status).toBe('current');
    wrapper.unmount();
  });

  it('Live 相当（viewport null）では polling しない', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 404 }));
    const { wrapper, api, viewport } = mountPanel({
      fetchFn: fetchFn as unknown as typeof fetch,
      viewport: 'pc',
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
    clearPendingDeviceCapture('sample');
  });

  it('read-only では status GET / POST しない', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 404 }));
    const { wrapper, api } = mountPanel({
      fetchFn: fetchFn as unknown as typeof fetch,
      editable: false,
    });
    await flushPromises();
    await api.collectCurrent();
    expect(fetchFn).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
