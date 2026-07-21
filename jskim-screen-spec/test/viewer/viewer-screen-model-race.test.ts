import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ScreenSpecPage from '../../src/viewer/pages/ScreenSpecPage.vue';
import DomPreview from '../../src/viewer/components/DomPreview.vue';
import type { ManifestScreen, ScreenData, ViewerManifest } from '../../src/viewer/types';
import {
  stubDescriptionTreeFetch,
  type MockTreeDoc,
} from '../helpers/description-tree-fetch-mock';

const reloadCapture = vi.hoisted(() => {
  const capturedReloadScreens: Array<() => Promise<{ status: string }>> = [];

  function createPreviewPanelStub() {
    return {
      runtime: { value: { status: 'idle' as const } },
      persistedCapture: { value: null },
      persistedReference: { value: null },
      localPending: { value: false },
      awaitingManifest: { value: false },
      isCollecting: { value: false },
      isBusy: { value: false },
      actionsDisabled: { value: false },
      statusMessage: { value: '' },
      errorMessage: { value: '' },
      infoMessage: { value: '' },
      dialogError: { value: '' },
      figmaConfirmation: { value: null },
      refreshStatus: async () => {},
      collectCurrent: async () => {},
      resumePendingIfNeeded: async () => {},
      stopPolling: () => {},
      uploadOrReplace: async () => ({ ok: false as const }),
      deleteCurrent: async () => {},
      importFromFigma: async () => ({ ok: false as const }),
      reimportFromFigma: async () => ({ ok: false as const }),
      clearDialogError: () => {},
      abortFigmaDialogRequest: () => {},
      clearFigmaConfirmation: () => {},
    };
  }

  return {
    captureReloadScreen(options: { reloadScreen: () => Promise<{ status: string }> }) {
      capturedReloadScreens.push(options.reloadScreen);
      return createPreviewPanelStub();
    },
    resetCapturedReloadScreens() {
      capturedReloadScreens.length = 0;
    },
    latestCapturedReloadScreen() {
      const reload = capturedReloadScreens.at(-1);
      if (!reload) {
        throw new Error('reloadScreen callback was not captured');
      }
      return reload;
    },
  };
});

vi.mock('../../src/viewer/preview/useDeviceCapturePanel', () => ({
  useDeviceCapturePanel: (options: { reloadScreen: () => Promise<{ status: string }> }) =>
    reloadCapture.captureReloadScreen(options),
}));

vi.mock('../../src/viewer/preview/useReferenceImagePanel', () => ({
  useReferenceImagePanel: (options: { reloadScreen: () => Promise<{ status: string }> }) =>
    reloadCapture.captureReloadScreen(options),
}));

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

type ScreenJsonGate = {
  resolve: (body: ScreenData) => void;
  reject: (error: Error) => void;
};

function createDeferredScreenJsonGate(): {
  promise: Promise<Response>;
  gate: ScreenJsonGate;
} {
  let resolveFn: ((body: ScreenData) => void) | undefined;
  let rejectFn: ((error: Error) => void) | undefined;
  const promise = new Promise<Response>((resolve, reject) => {
    resolveFn = (body) => resolve(jsonResponse(body));
    rejectFn = (error) => reject(error);
  });
  return {
    promise,
    gate: {
      resolve: (body) => resolveFn?.(body),
      reject: (error) => rejectFn?.(error),
    },
  };
}

type DeferredResourceGate = {
  resolveText: (text: string) => void;
  rejectText: (error: Error) => void;
};

function createDeferredFetchResponse(): {
  promise: Promise<Response>;
  gate: DeferredResourceGate;
} {
  let resolveResponse!: (response: Response) => void;
  let rejectResponse!: (error: Error) => void;
  const promise = new Promise<Response>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  return {
    promise,
    gate: {
      resolveText: (text: string) => resolveResponse(textResponse(text)),
      rejectText: (error: Error) => rejectResponse(error),
    },
  };
}

const screenXManifest: ManifestScreen = {
  id: 'screen-x',
  name: 'Screen X',
  path: '/x.html',
  dataFile: 'screens/screen-x.json',
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

const screenYManifest: ManifestScreen = {
  id: 'screen-y',
  name: 'Screen Y',
  path: '/y.html',
  dataFile: 'screens/screen-y.json',
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

const screenAManifest: ManifestScreen = {
  id: 'screen-a',
  name: 'A最終',
  path: '/a.html',
  dataFile: 'screens/screen-a.json',
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

const screenBManifest: ManifestScreen = {
  id: 'screen-b',
  name: 'B中間',
  path: '/b.html',
  dataFile: 'screens/screen-b.json',
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

const screenXData: ScreenData = {
  id: 'screen-x',
  name: 'Screen X',
  description: '',
  path: '/x.html',
  itemOrder: ['item'],
  items: {
    item: { name: 'X項目', type: 'text', description: '', note: '' },
  },
  states: [
    {
      id: 'default',
      name: '初期',
      viewer: { visible: true, order: 1 },
      snapshotFile: 'snapshots/screen-x/default.html',
    },
  ],
  interactions: [],
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

const screenXStaleData: ScreenData = {
  ...screenXData,
  name: 'Screen X STALE',
};

const screenYData: ScreenData = {
  id: 'screen-y',
  name: 'Screen Y',
  description: '',
  path: '/y.html',
  itemOrder: ['item'],
  items: {
    item: { name: 'Y項目', type: 'text', description: '', note: '' },
  },
  states: [
    {
      id: 'default',
      name: '初期',
      viewer: { visible: true, order: 1 },
      snapshotFile: 'snapshots/screen-y/default.html',
    },
  ],
  interactions: [],
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

const screenAData: ScreenData = {
  id: 'screen-a',
  name: 'A最終',
  description: '',
  path: '/a.html',
  itemOrder: ['item'],
  items: {
    item: { name: 'A項目', type: 'text', description: '', note: '' },
  },
  states: [
    {
      id: 'default',
      name: '初期',
      viewer: { visible: true, order: 1 },
      snapshotFile: 'snapshots/screen-a/default.html',
    },
  ],
  interactions: [],
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

const screenBData: ScreenData = {
  id: 'screen-b',
  name: 'B中間',
  description: '',
  path: '/b.html',
  itemOrder: ['item'],
  items: {
    item: { name: 'B項目', type: 'text', description: '', note: '' },
  },
  states: [
    {
      id: 'default',
      name: '初期',
      viewer: { visible: true, order: 1 },
      snapshotFile: 'snapshots/screen-b/default.html',
    },
  ],
  interactions: [],
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

const screenAOldData: ScreenData = {
  ...screenAData,
  name: 'A1古い',
};

function createTreeDoc(screenId: string, name: string): MockTreeDoc {
  return {
    screen: { id: screenId, name, description: '' },
    itemOrder: ['item'],
    items: {
      item: { name: '項目', type: 'text', description: '', note: '' },
    },
    collectedItemIds: ['item'],
  };
}

type ScreenModelRaceHarness = {
  reloadGates: Record<string, ScreenJsonGate>;
  pageGates: Record<string, ScreenJsonGate>;
  snapshotGates: Record<string, DeferredResourceGate>;
};

function stubScreenXReloadFetch(): ScreenModelRaceHarness & {
  reloadSignals: AbortSignal[];
} {
  const reloadGates: Record<string, ScreenJsonGate> = {};
  const pageGates: Record<string, ScreenJsonGate> = {};
  const snapshotGates: Record<string, DeferredResourceGate> = {};
  const reloadSignals: AbortSignal[] = [];
  let initialLoadDone = false;
  let reloadCount = 0;

  stubDescriptionTreeFetch(
    {
      'screen-x': createTreeDoc('screen-x', 'Screen X'),
      'screen-y': createTreeDoc('screen-y', 'Screen Y'),
    },
    {
      extraHandler: (url) => {
        if (url.endsWith('/data/snapshots/screen-x/default.html')) {
          return textResponse('<main data-x></main>');
        }
        if (url.endsWith('/data/snapshots/screen-y/default.html')) {
          return textResponse('<main data-y></main>');
        }
        if (url.endsWith('/data/theme/preview.css')) {
          return textResponse('/* preview */');
        }
        return undefined;
      },
    },
  );

  const baseFetch = global.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/data/screens/screen-x.json')) {
        if (!initialLoadDone) {
          initialLoadDone = true;
          return jsonResponse(screenXData);
        }
        reloadCount += 1;
        if (init?.signal) {
          reloadSignals.push(init.signal);
        }
        const key = `reload-x:${reloadCount}`;
        const deferred = createDeferredScreenJsonGate();
        reloadGates[key] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/screens/screen-y.json')) {
        const deferred = createDeferredScreenJsonGate();
        pageGates['screen-y:1'] = deferred.gate;
        return deferred.promise;
      }
      return baseFetch(input, init);
    }),
  );

  return { reloadGates, pageGates, snapshotGates, reloadSignals };
}

function stubDualReloadFetch(): ScreenModelRaceHarness & {
  screenAFetchGates: Record<string, ScreenJsonGate>;
} {
  const reloadGates: Record<string, ScreenJsonGate> = {};
  const pageGates: Record<string, ScreenJsonGate> = {};
  const snapshotGates: Record<string, DeferredResourceGate> = {};
  const screenAFetchGates: Record<string, ScreenJsonGate> = {};
  let screenAFetchCount = 0;
  let snapshotACount = 0;

  stubDescriptionTreeFetch(
    {
      'screen-a': createTreeDoc('screen-a', 'A最終'),
      'screen-b': createTreeDoc('screen-b', 'B中間'),
    },
  );

  const baseFetch = global.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/data/snapshots/screen-a/default.html')) {
        snapshotACount += 1;
        const deferred = createDeferredFetchResponse();
        snapshotGates[`snapshot-a:${snapshotACount}`] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/snapshots/screen-b/default.html')) {
        return textResponse('<main data-b></main>');
      }
      if (url.endsWith('/data/theme/preview.css')) {
        return textResponse('/* preview */');
      }
      if (url.endsWith('/data/screens/screen-a.json')) {
        screenAFetchCount += 1;
        if (screenAFetchCount === 1) {
          return jsonResponse(screenAData);
        }
        const key = `screen-a-fetch:${screenAFetchCount}`;
        const deferred = createDeferredScreenJsonGate();
        screenAFetchGates[key] = deferred.gate;
        reloadGates[key] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/screens/screen-b.json')) {
        const deferred = createDeferredScreenJsonGate();
        pageGates['screen-b:1'] = deferred.gate;
        return deferred.promise;
      }
      return baseFetch(input, init);
    }),
  );

  return { reloadGates, pageGates, snapshotGates, screenAFetchGates };
}

async function mountPage(
  screenId: string,
  screens: ManifestScreen[],
): Promise<{ wrapper: ReturnType<typeof mount>; router: ReturnType<typeof createRouter> }> {
  reloadCapture.resetCapturedReloadScreens();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/screens/:screenId', component: ScreenSpecPage, props: true }],
  });
  await router.push(`/screens/${screenId}`);
  await router.isReady();

  const manifest = computed<ViewerManifest>(() => ({
    schemaVersion: '1',
    projectName: 'sample',
    base: '/spec/',
    screens,
  }));

  const wrapper = mount(
    { template: '<router-view />' },
    {
      global: {
        plugins: [router],
        provide: {
          manifest,
          editingEnabled: false,
          openCreateScreen: () => {},
        },
      },
    },
  );
  await flushPromises();
  return { wrapper, router };
}

async function reloadScreen(wrapper: ReturnType<typeof mount>): Promise<void> {
  await reloadCapture.latestCapturedReloadScreen()();
}

function readScreenTitle(wrapper: ReturnType<typeof mount>): string {
  const heading = wrapper.find('h1');
  return heading.exists() ? heading.text() : '';
}

function pageComponent(wrapper: ReturnType<typeof mount>) {
  return wrapper.findComponent(ScreenSpecPage);
}

function readPreviewHtml(wrapper: ReturnType<typeof mount>): string {
  const preview = wrapper.findComponent(DomPreview);
  if (!preview.exists()) {
    return '';
  }
  return String((preview.props() as { html: string }).html);
}

describe('ScreenSpecPage screen model load race', () => {
  beforeEach(() => {
    reloadCapture.resetCapturedReloadScreens();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('X reload pending → Screen Y 전환 → X stale JSON 미적용', async () => {
    const { reloadGates, pageGates } = stubScreenXReloadFetch();
    const { wrapper, router } = await mountPage('screen-x', [screenXManifest, screenYManifest]);

    expect(wrapper.text()).toContain('Screen X');

    void reloadScreen(wrapper);
    await nextTick();
    expect(reloadGates['reload-x:1']).toBeDefined();

    await router.push('/screens/screen-y');
    await nextTick();

    pageGates['screen-y:1'].resolve(screenYData);
    await flushPromises();

    reloadGates['reload-x:1'].resolve(screenXStaleData);
    await flushPromises();

    expect(readScreenTitle(wrapper)).toContain('Screen Y');
    expect(readScreenTitle(wrapper)).not.toContain('Screen X STALE');
    expect(wrapper.find('.spec-page--error').exists()).toBe(false);
  });

  it('동일 Screen reload R1/R2: R2 완료 후 R1 stale 폐기', async () => {
    const { reloadGates, reloadSignals } = stubScreenXReloadFetch();
    const { wrapper } = await mountPage('screen-x', [screenXManifest]);

    void reloadScreen(wrapper);
    await nextTick();
    void reloadScreen(wrapper);
    await nextTick();
    expect(reloadSignals).toHaveLength(2);
    expect(reloadSignals[0]?.aborted).toBe(true);
    expect(reloadSignals[1]?.aborted).toBe(false);

    reloadGates['reload-x:2'].resolve({ ...screenXData, name: 'Screen X R2' });
    await flushPromises();

    reloadGates['reload-x:1'].resolve(screenXStaleData);
    await flushPromises();

    expect(readScreenTitle(wrapper)).toBe('Screen X R2');
  });

  it('A reload pending → B route → A2 route → stale reload/page JSON 미적용', async () => {
    const { screenAFetchGates, pageGates, snapshotGates } = stubDualReloadFetch();
    const { wrapper, router } = await mountPage('screen-a', [screenAManifest, screenBManifest]);

    void reloadScreen(wrapper);
    await nextTick();
    expect(screenAFetchGates['screen-a-fetch:2']).toBeDefined();

    await router.push('/screens/screen-b');
    await nextTick();
    pageGates['screen-b:1'].resolve(screenBData);
    await flushPromises();

    await router.push('/screens/screen-a');
    await nextTick();
    expect(screenAFetchGates['screen-a-fetch:3']).toBeDefined();

    screenAFetchGates['screen-a-fetch:3'].resolve(screenAData);
    await flushPromises();
    snapshotGates['snapshot-a:2']?.resolveText('<main data-a2></main>');
    await flushPromises();

    pageGates['screen-b:1'].resolve(screenBData);
    await flushPromises();
    screenAFetchGates['screen-a-fetch:2'].resolve(screenAOldData);
    await flushPromises();

    expect(readScreenTitle(wrapper)).toContain('A最終');
    expect(readScreenTitle(wrapper)).not.toContain('A1古い');
    expect(wrapper.text()).not.toContain('B中間');
    expect(wrapper.text()).not.toContain('A1古い');
    expect(readPreviewHtml(wrapper)).toBe('<main data-a2></main>');
  });

  it('reloadScreenData unmount → resolve 후 state/error 변경 없음', async () => {
    const { reloadGates } = stubScreenXReloadFetch();
    const { wrapper } = await mountPage('screen-x', [screenXManifest]);

    void reloadScreen(wrapper);
    await nextTick();
    const pending = reloadGates['reload-x:1'];
    expect(pending).toBeDefined();

    wrapper.unmount();
    pending!.resolve(screenXStaleData);
    await flushPromises();

    expect(wrapper.find('.spec-page--error').exists()).toBe(false);
  });

  it('reloadScreenData unmount → reject 후 state/error 변경 없음', async () => {
    const { reloadGates } = stubScreenXReloadFetch();
    const { wrapper } = await mountPage('screen-x', [screenXManifest]);

    void reloadScreen(wrapper);
    await nextTick();
    const pending = reloadGates['reload-x:1'];
    expect(pending).toBeDefined();

    wrapper.unmount();
    pending!.reject(new Error('late reject'));
    await flushPromises();

    expect(wrapper.find('.spec-page--error').exists()).toBe(false);
  });

  it('R1 pending → R2 success → R1 late reject → R2 유지, error 미표시', async () => {
    const { reloadGates } = stubScreenXReloadFetch();
    const { wrapper } = await mountPage('screen-x', [screenXManifest]);

    void reloadScreen(wrapper);
    await nextTick();
    void reloadScreen(wrapper);
    await nextTick();

    reloadGates['reload-x:2'].resolve({ ...screenXData, name: 'Screen X R2' });
    await flushPromises();

    reloadGates['reload-x:1'].reject(new Error('404'));
    await flushPromises();

    expect(readScreenTitle(wrapper)).toBe('Screen X R2');
    expect(wrapper.find('.spec-page--error').exists()).toBe(false);
  });
});
