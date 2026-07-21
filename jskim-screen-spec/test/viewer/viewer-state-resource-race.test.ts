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

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string): Response {
  return new Response(body, { status: 200 });
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

const multiStateManifest: ManifestScreen = {
  id: 'multi-state',
  name: 'Multi State',
  path: '/multi.html',
  dataFile: 'screens/multi-state.json',
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

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

const multiStateScreen: ScreenData = {
  id: 'multi-state',
  name: 'Multi State',
  description: '',
  path: '/multi.html',
  itemOrder: ['item'],
  items: {
    item: { name: '項目', type: 'text', description: '', note: '' },
  },
  states: [
    {
      id: 'state-a',
      name: 'State A',
      viewer: { visible: true, order: 10 },
      snapshotFile: 'snapshots/multi-state/state-a.html',
      styles: [{ kind: 'style', href: '/data/theme/state-a.css', media: 'all' }],
    },
    {
      id: 'state-b',
      name: 'State B',
      viewer: { visible: true, order: 20 },
      snapshotFile: 'snapshots/multi-state/state-b.html',
      styles: [{ kind: 'style', href: '/data/theme/state-b.css', media: 'all' }],
    },
  ],
  interactions: [],
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
      id: 'state-b',
      name: 'State B',
      viewer: { visible: true, order: 1 },
      snapshotFile: 'snapshots/screen-x/state-b.html',
      styles: [{ kind: 'style', href: '/data/theme/x-b.css', media: 'all' }],
    },
  ],
  interactions: [],
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
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
      styles: [{ kind: 'style', href: '/data/theme/y.css', media: 'all' }],
    },
  ],
  interactions: [],
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
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

type ResourceGateMaps = {
  snapshotGates: Record<string, DeferredResourceGate>;
  stylesheetGates: Record<string, DeferredResourceGate>;
  screenJsonGates: Record<string, ScreenJsonGate>;
};

function lastGate<T>(gates: Record<string, T>, prefix: string): T | undefined {
  const keys = Object.keys(gates).filter((key) => key.startsWith(prefix));
  if (keys.length === 0) {
    return undefined;
  }
  keys.sort();
  return gates[keys[keys.length - 1]!];
}

function stubMultiStateFetch(): ResourceGateMaps {
  const snapshotGates: Record<string, DeferredResourceGate> = {};
  const stylesheetGates: Record<string, DeferredResourceGate> = {};
  const screenJsonGates: Record<string, ScreenJsonGate> = {};
  const snapshotCounts: Record<string, number> = {};
  const stylesheetCounts: Record<string, number> = {};

  stubDescriptionTreeFetch(
    {
      'multi-state': createTreeDoc('multi-state', 'Multi State'),
      'screen-x': createTreeDoc('screen-x', 'Screen X'),
      'screen-y': createTreeDoc('screen-y', 'Screen Y'),
    },
    {
      extraHandler: (url) => {
        if (url.endsWith('/data/screens/multi-state.json')) {
          return jsonResponse(multiStateScreen);
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
      if (url.endsWith('/data/screens/screen-y.json')) {
        const deferred = createDeferredScreenJsonGate();
        screenJsonGates['screen-y:1'] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/snapshots/screen-y/default.html')) {
        const deferred = createDeferredFetchResponse();
        snapshotGates['snapshot:screen-y:1'] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/theme/y.css')) {
        const deferred = createDeferredFetchResponse();
        stylesheetGates['stylesheet:screen-y:1'] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/snapshots/multi-state/state-a.html')) {
        snapshotCounts['state-a'] = (snapshotCounts['state-a'] ?? 0) + 1;
        const key = `snapshot:state-a:${snapshotCounts['state-a']}`;
        const deferred = createDeferredFetchResponse();
        snapshotGates[key] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/snapshots/multi-state/state-b.html')) {
        snapshotCounts['state-b'] = (snapshotCounts['state-b'] ?? 0) + 1;
        const key = `snapshot:state-b:${snapshotCounts['state-b']}`;
        const deferred = createDeferredFetchResponse();
        snapshotGates[key] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/theme/state-a.css')) {
        stylesheetCounts['state-a'] = (stylesheetCounts['state-a'] ?? 0) + 1;
        const key = `stylesheet:state-a:${stylesheetCounts['state-a']}`;
        const deferred = createDeferredFetchResponse();
        stylesheetGates[key] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/theme/state-b.css')) {
        stylesheetCounts['state-b'] = (stylesheetCounts['state-b'] ?? 0) + 1;
        const key = `stylesheet:state-b:${stylesheetCounts['state-b']}`;
        const deferred = createDeferredFetchResponse();
        stylesheetGates[key] = deferred.gate;
        return deferred.promise;
      }
      return baseFetch(input, init);
    }),
  );

  return { snapshotGates, stylesheetGates, screenJsonGates };
}

function stubDualScreenStateFetch(): ResourceGateMaps & {
  screenGates: Record<string, ScreenJsonGate>;
} {
  const snapshotGates: Record<string, DeferredResourceGate> = {};
  const stylesheetGates: Record<string, DeferredResourceGate> = {};
  const screenGates: Record<string, ScreenJsonGate> = {};
  const screenJsonGates: Record<string, ScreenJsonGate> = {};

  stubDescriptionTreeFetch(
    {
      'screen-x': createTreeDoc('screen-x', 'Screen X'),
      'screen-y': createTreeDoc('screen-y', 'Screen Y'),
    },
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
      if (url.endsWith('/data/screens/screen-x.json')) {
        const deferred = createDeferredScreenJsonGate();
        screenGates['screen-x:1'] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/screens/screen-y.json')) {
        const deferred = createDeferredScreenJsonGate();
        screenGates['screen-y:1'] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/snapshots/screen-x/state-b.html')) {
        const deferred = createDeferredFetchResponse();
        snapshotGates['snapshot:screen-x:1'] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/snapshots/screen-y/default.html')) {
        const deferred = createDeferredFetchResponse();
        snapshotGates['snapshot:screen-y:1'] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/theme/x-b.css')) {
        const deferred = createDeferredFetchResponse();
        stylesheetGates['stylesheet:screen-x:1'] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/theme/y.css')) {
        const deferred = createDeferredFetchResponse();
        stylesheetGates['stylesheet:screen-y:1'] = deferred.gate;
        return deferred.promise;
      }
      return baseFetch(input, init);
    }),
  );

  return { snapshotGates, stylesheetGates, screenJsonGates, screenGates };
}

async function mountPage(
  screenId: string,
  screens: ManifestScreen[],
): Promise<{ wrapper: ReturnType<typeof mount>; router: ReturnType<typeof createRouter> }> {
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
          editingEnabled: true,
          openCreateScreen: () => {},
        },
      },
    },
  );
  await flushPromises();
  return { wrapper, router };
}

function readPreviewHtml(wrapper: ReturnType<typeof mount>): string {
  const preview = wrapper.findComponent(DomPreview);
  if (!preview.exists()) {
    return '';
  }
  return String((preview.props() as { html: string }).html);
}

function readPreviewStylesheets(
  wrapper: ReturnType<typeof mount>,
): Array<{ cssText?: string; href?: string }> {
  const preview = wrapper.findComponent(DomPreview);
  if (!preview.exists()) {
    return [];
  }
  return (preview.props() as { stylesheets?: Array<{ cssText?: string; href?: string }> })
    .stylesheets ?? [];
}

function stateButtons(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('button.state-selector__button');
}

describe('ScreenSpecPage state resource load race', () => {
  beforeEach(() => {
    window.__JSKIM_SPEC_EDIT__ = {
      enabled: true,
      apiBase: '/_jskim/spec/descriptions',
    };
  });

  afterEach(() => {
    delete window.__JSKIM_SPEC_EDIT__;
    vi.unstubAllGlobals();
  });

  it('State A→B→A: A2 완료 후 B/A1 늦은 resource가 A2 state를 덮지 않음', async () => {
    const { snapshotGates, stylesheetGates } = stubMultiStateFetch();
    const { wrapper } = await mountPage('multi-state', [multiStateManifest]);

    expect(snapshotGates['snapshot:state-a:1']).toBeDefined();

    await stateButtons(wrapper)[1].trigger('click');
    await nextTick();
    await stateButtons(wrapper)[0].trigger('click');
    await nextTick();

    lastGate(snapshotGates, 'snapshot:state-a:')!.resolveText('<main data-a2></main>');
    await flushPromises();
    lastGate(stylesheetGates, 'stylesheet:state-a:')!.resolveText('/* css-a2 */');
    await flushPromises();

    lastGate(snapshotGates, 'snapshot:state-b:')?.resolveText('<main data-b></main>');
    lastGate(stylesheetGates, 'stylesheet:state-b:')?.resolveText('/* css-b */');
    await flushPromises();

    snapshotGates['snapshot:state-a:1']?.resolveText('<main data-a1></main>');
    stylesheetGates['stylesheet:state-a:1']?.resolveText('/* css-a1 */');
    await flushPromises();

    expect(stateButtons(wrapper)[0].classes()).toContain('is-active');
    expect(readPreviewHtml(wrapper)).toBe('<main data-a2></main>');
    expect(readPreviewStylesheets(wrapper)[0]?.cssText).toBe('/* css-a2 */');
  });

  it('State B pending 중 Screen Y 전환 → Y resource 유지, X/B stale 폐기', async () => {
    const { snapshotGates, stylesheetGates, screenGates } = stubDualScreenStateFetch();
    const { wrapper, router } = await mountPage('screen-x', [screenXManifest, screenYManifest]);

    screenGates['screen-x:1'].resolve(screenXData);
    await flushPromises();

    expect(snapshotGates['snapshot:screen-x:1']).toBeDefined();

    await router.push('/screens/screen-y');
    await nextTick();

    screenGates['screen-y:1'].resolve(screenYData);
    await flushPromises();

    snapshotGates['snapshot:screen-y:1']!.resolveText('<main data-y></main>');
    await flushPromises();
    stylesheetGates['stylesheet:screen-y:1']!.resolveText('/* css-y */');
    await flushPromises();

    snapshotGates['snapshot:screen-x:1']?.resolveText('<main data-x-b></main>');
    stylesheetGates['stylesheet:screen-x:1']?.resolveText('/* css-x-b */');
    await flushPromises();

    expect(wrapper.text()).toContain('Screen Y');
    expect(readPreviewHtml(wrapper)).toBe('<main data-y></main>');
    expect(readPreviewStylesheets(wrapper)[0]?.cssText).toBe('/* css-y */');
    expect(wrapper.find('.spec-page--error').exists()).toBe(false);
  });

  it('page load snapshot pending → state selector は disabled', async () => {
    const { snapshotGates, stylesheetGates } = stubMultiStateFetch();
    const { wrapper } = await mountPage('multi-state', [multiStateManifest]);

    expect(snapshotGates['snapshot:state-a:1']).toBeDefined();
    expect(wrapper.find('.state-selector__button').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="page-resource-loading"]').exists()).toBe(true);

    snapshotGates['snapshot:state-a:1']!.resolveText('<main data-a1></main>');
    await flushPromises();
    stylesheetGates['stylesheet:state-a:1']!.resolveText('/* css-a1 */');
    await flushPromises();

    expect(wrapper.find('.state-selector__button').attributes('disabled')).toBeUndefined();
    await stateButtons(wrapper)[1].trigger('click');
    await nextTick();

    lastGate(snapshotGates, 'snapshot:state-b:')!.resolveText('<main data-b></main>');
    await flushPromises();
    lastGate(stylesheetGates, 'stylesheet:state-b:')!.resolveText('/* css-b */');
    await flushPromises();

    expect(stateButtons(wrapper)[1].classes()).toContain('is-active');
    expect(readPreviewHtml(wrapper)).toBe('<main data-b></main>');
  });

  it('state resource pending → loadScreen 시작 시 stale state resource 폐기', async () => {
    const { snapshotGates, stylesheetGates, screenJsonGates } = stubMultiStateFetch();
    const { wrapper, router } = await mountPage('multi-state', [
      multiStateManifest,
      screenYManifest,
    ]);

    snapshotGates['snapshot:state-a:1']!.resolveText('<main data-a1></main>');
    await flushPromises();
    stylesheetGates['stylesheet:state-a:1']!.resolveText('/* css-a1 */');
    await flushPromises();

    await stateButtons(wrapper)[1].trigger('click');
    await nextTick();
    expect(lastGate(snapshotGates, 'snapshot:state-b:')).toBeDefined();

    await router.push('/screens/screen-y');
    await nextTick();

    screenJsonGates['screen-y:1'].resolve(screenYData);
    await flushPromises();

    snapshotGates['snapshot:screen-y:1']!.resolveText('<main data-y></main>');
    await flushPromises();
    stylesheetGates['stylesheet:screen-y:1']!.resolveText('/* css-y */');
    await flushPromises();

    lastGate(snapshotGates, 'snapshot:state-b:')?.resolveText('<main data-b-stale></main>');
    lastGate(stylesheetGates, 'stylesheet:state-b:')?.resolveText('/* css-b-stale */');
    await flushPromises();

    expect(wrapper.text()).toContain('Screen Y');
    expect(readPreviewHtml(wrapper)).toBe('<main data-y></main>');
    expect(readPreviewStylesheets(wrapper)[0]?.cssText).toBe('/* css-y */');
  });

  it('unmount 후 state snapshot text resolve → state 변경 없음', async () => {
    const { snapshotGates } = stubMultiStateFetch();
    const { wrapper } = await mountPage('multi-state', [multiStateManifest]);

    const pendingSnapshot = snapshotGates['snapshot:state-a:1'];
    expect(pendingSnapshot).toBeDefined();

    wrapper.unmount();
    pendingSnapshot!.resolveText('<main data-late></main>');
    await flushPromises();

    expect(wrapper.findComponent(DomPreview).exists()).toBe(false);
  });

  it('unmount 후 state snapshot text reject → uncaught rejection 없음', async () => {
    const { snapshotGates } = stubMultiStateFetch();
    const { wrapper } = await mountPage('multi-state', [multiStateManifest]);

    const pendingSnapshot = snapshotGates['snapshot:state-a:1'];
    expect(pendingSnapshot).toBeDefined();

    wrapper.unmount();
    pendingSnapshot!.rejectText(new Error('text failed'));
    await flushPromises();

    expect(wrapper.find('.spec-page--error').exists()).toBe(false);
  });

  it('unmount 후 state stylesheet reject → uncaught rejection 없음', async () => {
    const { snapshotGates, stylesheetGates } = stubMultiStateFetch();
    const { wrapper } = await mountPage('multi-state', [multiStateManifest]);

    snapshotGates['snapshot:state-a:1']!.resolveText('<main></main>');
    await flushPromises();

    const pendingStylesheet = stylesheetGates['stylesheet:state-a:1'];
    expect(pendingStylesheet).toBeDefined();

    wrapper.unmount();
    pendingStylesheet!.rejectText(new Error('css failed'));
    await flushPromises();

    expect(wrapper.find('.spec-page--error').exists()).toBe(false);
  });

  it('State B pending → A2 성공 후 B 늦은 reject → A2 유지, error 미표시', async () => {
    const { snapshotGates, stylesheetGates } = stubMultiStateFetch();
    const { wrapper } = await mountPage('multi-state', [multiStateManifest]);

    await stateButtons(wrapper)[1].trigger('click');
    await nextTick();
    await stateButtons(wrapper)[0].trigger('click');
    await nextTick();

    lastGate(snapshotGates, 'snapshot:state-a:')!.resolveText('<main data-a2></main>');
    await flushPromises();
    lastGate(stylesheetGates, 'stylesheet:state-a:')!.resolveText('/* css-a2 */');
    await flushPromises();

    lastGate(snapshotGates, 'snapshot:state-b:')?.rejectText(new Error('404'));
    await flushPromises();

    expect(readPreviewHtml(wrapper)).toBe('<main data-a2></main>');
    expect(wrapper.find('.spec-page--error').exists()).toBe(false);
  });
});
