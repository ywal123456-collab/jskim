import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ScreenSpecPage from '../../src/viewer/pages/ScreenSpecPage.vue';
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

const screenAData: ScreenData = {
  id: 'screen-a',
  name: 'A最終',
  description: '',
  path: '/a.html',
  itemOrder: ['same-item'],
  items: {
    'same-item': { name: 'A項目', type: 'text', description: '', note: '' },
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
  itemOrder: ['same-item'],
  items: {
    'same-item': { name: 'B項目', type: 'text', description: '', note: '' },
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

function createTreeDoc(screenId: string, screenName: string, itemName: string): MockTreeDoc {
  return {
    screen: { id: screenId, name: screenName, description: '' },
    itemOrder: ['same-item'],
    items: {
      'same-item': { name: itemName, type: 'text', description: '', note: '' },
    },
    collectedItemIds: ['same-item'],
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

function stubDualScreenPageFetch(): {
  gates: Record<string, ScreenJsonGate>;
  requestCounts: { a: number; b: number };
} {
  const gates: Record<string, ScreenJsonGate> = {};
  const requestCounts = { a: 0, b: 0 };

  stubDescriptionTreeFetch(
    {
      'screen-a': createTreeDoc('screen-a', 'A最終', 'A項目'),
      'screen-b': createTreeDoc('screen-b', 'B中間', 'B項目'),
    },
    {
      extraHandler: (url) => {
        if (url.endsWith('/data/snapshots/screen-a/default.html')) {
          return textResponse('<main>A</main>');
        }
        if (url.endsWith('/data/snapshots/screen-b/default.html')) {
          return textResponse('<main>B</main>');
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
      if (url.endsWith('/data/screens/screen-a.json')) {
        requestCounts.a += 1;
        const key = `screen-a:${requestCounts.a}`;
        const deferred = createDeferredScreenJsonGate();
        gates[key] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/screens/screen-b.json')) {
        requestCounts.b += 1;
        const key = `screen-b:${requestCounts.b}`;
        const deferred = createDeferredScreenJsonGate();
        gates[key] = deferred.gate;
        return deferred.promise;
      }
      return baseFetch(input, init);
    }),
  );

  return { gates, requestCounts };
}

async function mountDualScreenPage(
  screenId: string,
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
    screens: [screenAManifest, screenBManifest],
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

describe('ScreenSpecPage page load identity', () => {
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

  it('A→B→A 실제 응답 순서: A2 완료 후 B/A1 늦은 success가 A2를 덮지 않음', async () => {
    const { gates } = stubDualScreenPageFetch();

    const { wrapper, router } = await mountDualScreenPage('screen-a');
    expect(gates['screen-a:1']).toBeDefined();

    await router.push('/screens/screen-b');
    await nextTick();
    expect(gates['screen-b:1']).toBeDefined();

    await router.push('/screens/screen-a');
    await nextTick();
    expect(gates['screen-a:2']).toBeDefined();

    gates['screen-a:2'].resolve(screenAData);
    await flushPromises();
    gates['screen-b:1'].resolve(screenBData);
    await flushPromises();
    gates['screen-a:1'].resolve(screenAOldData);
    await flushPromises();

    expect(wrapper.text()).toContain('A最終');
    expect(wrapper.text()).not.toContain('B中間');
    expect(wrapper.text()).not.toContain('A1古い');
  });

  it('A→B→A: B 늦은 404가 마지막 A error를 덮지 않음', async () => {
    const { gates } = stubDualScreenPageFetch();

    const { wrapper, router } = await mountDualScreenPage('screen-a');
    expect(gates['screen-a:1']).toBeDefined();

    await router.push('/screens/screen-b');
    await nextTick();
    expect(gates['screen-b:1']).toBeDefined();

    await router.push('/screens/screen-a');
    await nextTick();
    expect(gates['screen-a:2']).toBeDefined();

    gates['screen-a:2'].resolve(screenAData);
    await flushPromises();
    gates['screen-b:1'].reject(new Error('B 404'));
    await flushPromises();
    gates['screen-a:1'].resolve(screenAOldData);
    await flushPromises();

    expect(wrapper.find('.spec-page--error').exists()).toBe(false);
    expect(wrapper.text()).toContain('A最終');
    expect(wrapper.text()).not.toContain('B中間');
  });

  it('unmount 후 Screen JSON success resolve → state 적용 없음', async () => {
    const { gates } = stubDualScreenPageFetch();

    const { wrapper } = await mountDualScreenPage('screen-a');
    wrapper.unmount();

    gates['screen-a:1'].resolve(screenBData);
    await flushPromises();

    expect(wrapper.text()).not.toContain('B中間');
  });

  it('unmount 후 Screen JSON reject → uncaught rejection 없음', async () => {
    const { gates } = stubDualScreenPageFetch();

    const { wrapper } = await mountDualScreenPage('screen-a');
    wrapper.unmount();

    gates['screen-a:1'].reject(new Error('network'));
    await flushPromises();

    expect(wrapper.find('.spec-page--error').exists()).toBe(false);
  });
});
