import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ScreenSpecPage from '../../src/viewer/pages/ScreenSpecPage.vue';
import DomPreview from '../../src/viewer/components/DomPreview.vue';
import type { ManifestScreen, ScreenData, ViewerManifest } from '../../src/viewer/types';
import {
  resolveSelectedStateId,
  fetchStateResourcesFromScreen,
  resolveStylesheetsFromScreen,
} from '../../src/viewer/screen-view-bundle';
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

function errorResponse(status: number): Response {
  return new Response('error', { status });
}

type DeferredResourceGate = {
  resolveText: (text: string) => void;
  rejectText: (error: Error) => void;
};

type ScreenJsonGate = {
  resolve: (body: ScreenData) => void;
  reject: (error: Error) => void;
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

const atomicManifest: ManifestScreen = {
  id: 'atomic-screen',
  name: 'Atomic Screen',
  path: '/atomic.html',
  dataFile: 'screens/atomic-screen.json',
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

function createRev1Data(): ScreenData {
  return {
    id: 'atomic-screen',
    name: 'Atomic Rev1',
    description: '',
    path: '/atomic.html',
    itemOrder: ['item'],
    items: {
      item: { name: '項目', type: 'text', description: '', note: '' },
    },
    states: [
      {
        id: 'state-a',
        name: 'State A',
        viewer: { visible: true, order: 1 },
        snapshotFile: 'snapshots/atomic/old-a.html',
        styles: [{ kind: 'style', href: '/data/theme/old-a.css', media: 'all' }],
      },
      {
        id: 'state-b',
        name: 'State B',
        viewer: { visible: true, order: 2 },
        snapshotFile: 'snapshots/atomic/old-b.html',
        styles: [{ kind: 'style', href: '/data/theme/old-b.css', media: 'all' }],
      },
    ],
    interactions: [],
    status: 'linked',
    hasDescription: true,
    hasImplementation: true,
    hasPreview: true,
  };
}

function createRev2Data(): ScreenData {
  return {
    ...createRev1Data(),
    name: 'Atomic Rev2',
    states: [
      {
        id: 'state-a',
        name: 'State A',
        viewer: { visible: true, order: 1 },
        snapshotFile: 'snapshots/atomic/new-a.html',
        styles: [{ kind: 'style', href: '/data/theme/new-a.css', media: 'all' }],
      },
      {
        id: 'state-b',
        name: 'State B',
        viewer: { visible: true, order: 2 },
        snapshotFile: 'snapshots/atomic/new-b.html',
        styles: [{ kind: 'style', href: '/data/theme/new-b.css', media: 'all' }],
      },
    ],
  };
}

function createRev2WithoutStateBData(): ScreenData {
  const rev2 = createRev2Data();
  return {
    ...rev2,
    states: rev2.states.filter((state) => state.id !== 'state-b'),
  };
}

function createTreeDoc(): MockTreeDoc {
  return {
    screen: { id: 'atomic-screen', name: 'Atomic Screen', description: '' },
    itemOrder: ['item'],
    items: {
      item: { name: '項目', type: 'text', description: '', note: '' },
    },
    collectedItemIds: ['item'],
  };
}

type AtomicFetchHarness = {
  reloadJsonGates: Record<string, ScreenJsonGate>;
  snapshotGates: Record<string, DeferredResourceGate>;
  stylesheetGates: Record<string, DeferredResourceGate>;
  resourceSignals: AbortSignal[];
  resolveReloadJson: (body: ScreenData) => void;
};

function stubAtomicFetch(options?: {
  reloadJsonDeferred?: boolean;
  reloadJsonReject?: boolean;
  failNewSnapshot?: boolean;
  failNewStylesheet?: boolean;
  deferOldBSnapshot?: boolean;
  deferNewResources?: boolean;
}): AtomicFetchHarness & {
  oldBGates: Record<string, DeferredResourceGate>;
} {
  const reloadJsonGates: Record<string, ScreenJsonGate> = {};
  const snapshotGates: Record<string, DeferredResourceGate> = {};
  const stylesheetGates: Record<string, DeferredResourceGate> = {};
  const oldBGates: Record<string, DeferredResourceGate> = {};
  const resourceSignals: AbortSignal[] = [];
  let screenJsonCount = 0;
  let snapshotACount = 0;
  let snapshotBCount = 0;
  let oldBCount = 0;
  let stylesheetACount = 0;
  let stylesheetBCount = 0;
  let reloadJsonGate: ScreenJsonGate | null = null;

  stubDescriptionTreeFetch(
    { 'atomic-screen': createTreeDoc() },
    {
      extraHandler: (url) => {
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
      if (init?.signal) {
        resourceSignals.push(init.signal);
      }
      if (url.endsWith('/data/screens/atomic-screen.json')) {
        screenJsonCount += 1;
        if (screenJsonCount === 1) {
          return jsonResponse(createRev1Data());
        }
        if (options?.reloadJsonReject) {
          return errorResponse(404);
        }
        if (options?.reloadJsonDeferred) {
          const deferred = createDeferredScreenJsonGate();
          reloadJsonGates[`reload-json:${screenJsonCount}`] = deferred.gate;
          reloadJsonGate = deferred.gate;
          return deferred.promise;
        }
        return jsonResponse(createRev2Data());
      }
      if (url.endsWith('/data/snapshots/atomic/old-a.html')) {
        return textResponse('<main data-old-a></main>');
      }
      if (url.endsWith('/data/snapshots/atomic/old-b.html')) {
        oldBCount += 1;
        if (options?.deferOldBSnapshot) {
          const deferred = createDeferredFetchResponse();
          oldBGates[`old-b:${oldBCount}`] = deferred.gate;
          return deferred.promise;
        }
        return textResponse('<main data-old-b></main>');
      }
      if (url.endsWith('/data/theme/old-a.css')) {
        return textResponse('/* old-a-css */');
      }
      if (url.endsWith('/data/theme/old-b.css')) {
        return textResponse('/* old-b-css */');
      }
      if (url.endsWith('/data/snapshots/atomic/new-a.html')) {
        snapshotACount += 1;
        if (options?.failNewSnapshot) {
          return errorResponse(500);
        }
        if (!options?.deferNewResources) {
          return textResponse('<main data-new-a></main>');
        }
        const deferred = createDeferredFetchResponse();
        snapshotGates[`new-a:${snapshotACount}`] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/snapshots/atomic/new-b.html')) {
        snapshotBCount += 1;
        if (!options?.deferNewResources) {
          return textResponse('<main data-new-b></main>');
        }
        const deferred = createDeferredFetchResponse();
        snapshotGates[`new-b:${snapshotBCount}`] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/theme/new-a.css')) {
        stylesheetACount += 1;
        if (options?.failNewStylesheet) {
          return errorResponse(404);
        }
        if (!options?.deferNewResources) {
          return textResponse('/* new-a-css */');
        }
        const deferred = createDeferredFetchResponse();
        stylesheetGates[`new-a-css:${stylesheetACount}`] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/theme/new-b.css')) {
        stylesheetBCount += 1;
        if (!options?.deferNewResources) {
          return textResponse('/* new-b-css */');
        }
        const deferred = createDeferredFetchResponse();
        stylesheetGates[`new-b-css:${stylesheetBCount}`] = deferred.gate;
        return deferred.promise;
      }
      return baseFetch(input, init);
    }),
  );

  return {
    reloadJsonGates,
    snapshotGates,
    stylesheetGates,
    resourceSignals,
    oldBGates,
    resolveReloadJson: (body: ScreenData) => {
      if (!reloadJsonGate) {
        throw new Error('reload JSON gate missing');
      }
      reloadJsonGate.resolve(body);
    },
  };
}

async function mountAtomicPage(): Promise<{
  wrapper: ReturnType<typeof mount>;
  reloadScreen: () => Promise<{ status: string }>;
}> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/screens/:screenId', component: ScreenSpecPage, props: true }],
  });
  await router.push('/screens/atomic-screen');
  await router.isReady();

  const manifest = computed<ViewerManifest>(() => ({
    schemaVersion: '1',
    projectName: 'sample',
    base: '/spec/',
    screens: [atomicManifest],
  }));

  const wrapper = mount(
    { template: '<router-view />' },
    {
      global: {
        plugins: [router],
        provide: {
          manifest,
          editingEnabled: true,
          openCreateScreen: () => {},
        },
      },
    },
  );
  await flushPromises();
  return {
    wrapper,
    reloadScreen: reloadCapture.latestCapturedReloadScreen(),
  };
}

function readPreviewHtml(wrapper: ReturnType<typeof mount>): string {
  const preview = wrapper.findComponent(DomPreview);
  if (!preview.exists()) {
    return '';
  }
  return String((preview.props() as { html: string }).html);
}

function readStylesheetText(wrapper: ReturnType<typeof mount>): string {
  const preview = wrapper.findComponent(DomPreview);
  if (!preview.exists()) {
    return '';
  }
  const stylesheets = (preview.props() as { stylesheets?: Array<{ cssText?: string }> })
    .stylesheets;
  return stylesheets?.[0]?.cssText ?? '';
}

function stateButtons(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('button.state-selector__button');
}

describe('screen-view-bundle helpers', () => {
  it('resolveSelectedStateId: 削除された state は first visible へ', () => {
    const rev2 = createRev2WithoutStateBData();
    expect(resolveSelectedStateId(rev2, 'state-b')).toBe('state-a');
  });

  it('resolveStylesheetsFromScreen: 宣言 stylesheet HTTP 404 は failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    const result = await resolveStylesheetsFromScreen(
      createRev1Data(),
      'state-a',
      new AbortController().signal,
      () => true,
    );
    expect(result.kind).toBe('failed');
    vi.unstubAllGlobals();
  });

  it('resolveStylesheetsFromScreen: fetch reject は failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    const result = await resolveStylesheetsFromScreen(
      createRev1Data(),
      'state-a',
      new AbortController().signal,
      () => true,
    );
    expect(result.kind).toBe('failed');
    vi.unstubAllGlobals();
  });

  it('resolveStylesheetsFromScreen: 未宣言 stylesheets=[] は ok', async () => {
    const screen = {
      ...createRev1Data(),
      states: [
        {
          ...createRev1Data().states[0]!,
          styles: [],
        },
      ],
    };
    const result = await resolveStylesheetsFromScreen(
      screen,
      'state-a',
      new AbortController().signal,
      () => true,
    );
    expect(result).toEqual({ kind: 'ok', stylesheets: [] });
  });

  it('fetchStateResourcesFromScreen: stale predicate で late success 0회', async () => {
    let active = true;
    const deferred = createDeferredFetchResponse();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/data/snapshots/atomic/new-a.html')) {
          return deferred.promise;
        }
        if (url.endsWith('/data/theme/new-a.css')) {
          return textResponse('/* new-a-css */');
        }
        return textResponse('');
      }),
    );
    const pending = fetchStateResourcesFromScreen(
      createRev2Data(),
      'state-a',
      new AbortController().signal,
      () => active,
      '/',
    );
    active = false;
    deferred.gate.resolveText('<main data-new-a></main>');
    const result = await pending;
    expect(result.kind).toBe('stale-or-aborted');
    vi.unstubAllGlobals();
  });
});

describe('ScreenSpecPage same-screen model/resource atomicity', () => {
  beforeEach(() => {
    reloadCapture.resetCapturedReloadScreens();
    window.__JSKIM_SPEC_EDIT__ = {
      enabled: true,
      apiBase: '/_jskim/spec/descriptions',
    };
  });

  afterEach(() => {
    delete window.__JSKIM_SPEC_EDIT__;
    vi.unstubAllGlobals();
  });

  it('A/C: loaded old resource → reload revision 2 → new snapshot/styles 적용', async () => {
    const { resolveReloadJson } = stubAtomicFetch({
      reloadJsonDeferred: true,
    });
    const { wrapper, reloadScreen } = await mountAtomicPage();

    expect(readPreviewHtml(wrapper)).toBe('<main data-old-a></main>');
    expect(readStylesheetText(wrapper)).toBe('/* old-a-css */');

    const reloadPromise = reloadScreen();
    await nextTick();
    resolveReloadJson(createRev2Data());
    const outcome = await reloadPromise;
    await flushPromises();

    expect(outcome.status).toBe('applied');
    expect(readPreviewHtml(wrapper)).toBe('<main data-new-a></main>');
    expect(readStylesheetText(wrapper)).toBe('/* new-a-css */');
  });

  it('B: pending old resource → reload revision 2 → old late success 0회', async () => {
    const harness = stubAtomicFetch({
      reloadJsonDeferred: true,
      deferOldBSnapshot: true,
      deferNewResources: true,
    });
    const { wrapper, reloadScreen } = await mountAtomicPage();

    await stateButtons(wrapper)[1]?.trigger('click');
    await nextTick();
    expect(harness.oldBGates['old-b:1']).toBeDefined();

    const reloadPromise = reloadScreen();
    await nextTick();
    harness.resolveReloadJson(createRev2Data());
    await flushPromises();
    expect(harness.snapshotGates['new-b:1']).toBeDefined();
    harness.snapshotGates['new-b:1']!.resolveText('<main data-new-b></main>');
    await flushPromises();
    expect(harness.stylesheetGates['new-b-css:1']).toBeDefined();
    harness.stylesheetGates['new-b-css:1']!.resolveText('/* new-b-css */');
    const outcome = await reloadPromise;

    harness.oldBGates['old-b:1']?.resolveText('<main data-old-b-late></main>');
    await flushPromises();

    expect(outcome.status).toBe('applied');
    expect(readPreviewHtml(wrapper)).toBe('<main data-new-b></main>');
    expect(readStylesheetText(wrapper)).toBe('/* new-b-css */');
  });

  it('D: selected state-b 제거 → first visible state-a + 새 resource', async () => {
    const harness = stubAtomicFetch({ reloadJsonDeferred: true });
    const { wrapper, reloadScreen } = await mountAtomicPage();

    await stateButtons(wrapper)[1]?.trigger('click');
    await flushPromises();
    expect(readPreviewHtml(wrapper)).toBe('<main data-old-b></main>');

    const reloadPromise = reloadScreen();
    await nextTick();
    harness.resolveReloadJson(createRev2WithoutStateBData());
    await nextTick();
    harness.snapshotGates['new-a:1']?.resolveText('<main data-new-a></main>');
    await nextTick();
    harness.stylesheetGates['new-a-css:1']?.resolveText('/* new-a-css */');
    await reloadPromise;
    await flushPromises();

    expect(readPreviewHtml(wrapper)).toBe('<main data-new-a></main>');
    expect(readStylesheetText(wrapper)).toBe('/* new-a-css */');
    expect(wrapper.text()).not.toContain('<main data-old-b>');
  });

  it('E: model success + new snapshot 실패 → revision 1 bundle 유지', async () => {
    const harness = stubAtomicFetch({ reloadJsonDeferred: true, failNewSnapshot: true });
    const { wrapper, reloadScreen } = await mountAtomicPage();

    const reloadPromise = reloadScreen();
    await nextTick();
    harness.resolveReloadJson(createRev2Data());
    const outcome = await reloadPromise;
    await flushPromises();

    expect(outcome.status).toBe('failed');
    expect(readPreviewHtml(wrapper)).toBe('<main data-old-a></main>');
    expect(readStylesheetText(wrapper)).toBe('/* old-a-css */');
  });

  it('F: model JSON 404 → revision 1 bundle 유지', async () => {
    stubAtomicFetch({ reloadJsonReject: true });
    const { wrapper, reloadScreen } = await mountAtomicPage();

    const outcome = await reloadScreen();
    await flushPromises();

    expect(outcome.status).toBe('failed');
    expect(readPreviewHtml(wrapper)).toBe('<main data-old-a></main>');
  });

  it('G: revision 1 state-b pending → reload → state-a 선택 → old state-b 폐기', async () => {
    const harness = stubAtomicFetch({
      reloadJsonDeferred: true,
      deferOldBSnapshot: true,
      deferNewResources: true,
    });
    const { wrapper, reloadScreen } = await mountAtomicPage();

    await stateButtons(wrapper)[1]?.trigger('click');
    await nextTick();
    expect(harness.oldBGates['old-b:1']).toBeDefined();

    const reloadPromise = reloadScreen();
    await nextTick();
    harness.resolveReloadJson(createRev2Data());
    await nextTick();

    await stateButtons(wrapper)[0]?.trigger('click');
    await flushPromises();
    expect(harness.snapshotGates['new-a:1']).toBeDefined();
    harness.snapshotGates['new-a:1']!.resolveText('<main data-rev2-a></main>');
    await flushPromises();
    expect(harness.stylesheetGates['new-a-css:1']).toBeDefined();
    harness.stylesheetGates['new-a-css:1']!.resolveText('/* rev2-a-css */');
    const outcome = await reloadPromise;
    await flushPromises();

    expect(outcome.status).toBe('applied');
    expect(readPreviewHtml(wrapper)).toBe('<main data-rev2-a></main>');
    expect(readStylesheetText(wrapper)).toBe('/* rev2-a-css */');

    harness.oldBGates['old-b:1']?.resolveText('<main data-old-b-late></main>');
    await flushPromises();
    expect(readPreviewHtml(wrapper)).toBe('<main data-rev2-a></main>');
  });

  it('H-stylesheet: revision 2 stylesheet HTTP 失敗 → revision 1 bundle 유지', async () => {
    const harness = stubAtomicFetch({ reloadJsonDeferred: true, failNewStylesheet: true });
    const { wrapper, reloadScreen } = await mountAtomicPage();

    const reloadPromise = reloadScreen();
    await nextTick();
    harness.resolveReloadJson(createRev2Data());
    const outcome = await reloadPromise;
    await flushPromises();

    expect(outcome.status).toBe('failed');
    expect(readPreviewHtml(wrapper)).toBe('<main data-old-a></main>');
    expect(readStylesheetText(wrapper)).toBe('/* old-a-css */');
  });

  it('H-resolve: reload JSON pending → unmount → resolve 후 state 변경 없음', async () => {
    const harness = stubAtomicFetch({ reloadJsonDeferred: true });
    const { wrapper, reloadScreen } = await mountAtomicPage();
    const beforeHtml = readPreviewHtml(wrapper);

    void reloadScreen();
    await nextTick();
    wrapper.unmount();
    harness.resolveReloadJson(createRev2Data());
    await flushPromises();

    expect(beforeHtml).toBe('<main data-old-a></main>');
  });

  it('H-reject: reload JSON pending → unmount → reject 후 state 변경 없음', async () => {
    const harness = stubAtomicFetch({ reloadJsonDeferred: true });
    const { wrapper, reloadScreen } = await mountAtomicPage();
    const beforeHtml = readPreviewHtml(wrapper);

    void reloadScreen();
    await nextTick();
    wrapper.unmount();
    harness.reloadJsonGates['reload-json:2']?.reject(new Error('abort'));
    await flushPromises();

    expect(beforeHtml).toBe('<main data-old-a></main>');
  });
});
