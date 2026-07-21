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
      styles: [{ kind: 'style', href: '/data/theme/a.css', media: 'all' }],
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
      styles: [{ kind: 'style', href: '/data/theme/b.css', media: 'all' }],
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

type ResourceRaceHarness = {
  gates: Record<string, ScreenJsonGate>;
  snapshotTextGates: Record<string, DeferredResourceGate>;
  stylesheetTextGates: Record<string, DeferredResourceGate>;
  requestCounts: { a: number; b: number };
};

function lastGate<T>(gates: Record<string, T>, prefix: string): T | undefined {
  const keys = Object.keys(gates).filter((key) => key.startsWith(prefix));
  if (keys.length === 0) {
    return undefined;
  }
  keys.sort();
  return gates[keys[keys.length - 1]!];
}

function stubResourceRaceFetch(options?: { failStylesheetA?: boolean }): ResourceRaceHarness {
  const gates: Record<string, ScreenJsonGate> = {};
  const snapshotTextGates: Record<string, DeferredResourceGate> = {};
  const stylesheetTextGates: Record<string, DeferredResourceGate> = {};
  const requestCounts = { a: 0, b: 0 };
  let snapshotACount = 0;
  let snapshotBCount = 0;
  let stylesheetACount = 0;
  let stylesheetBCount = 0;

  stubDescriptionTreeFetch(
    {
      'screen-a': createTreeDoc('screen-a', 'A最終', 'A項目'),
      'screen-b': createTreeDoc('screen-b', 'B中間', 'B項目'),
    },
    {
      extraHandler: (url) => {
        if (url.endsWith('/data/theme/preview.css')) {
          return new Response('/* preview */', { status: 200 });
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
      if (url.endsWith('/data/snapshots/screen-a/default.html')) {
        snapshotACount += 1;
        const key = `snapshot-a:${snapshotACount}`;
        const deferred = createDeferredFetchResponse();
        snapshotTextGates[key] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/snapshots/screen-b/default.html')) {
        snapshotBCount += 1;
        const key = `snapshot-b:${snapshotBCount}`;
        const deferred = createDeferredFetchResponse();
        snapshotTextGates[key] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/theme/a.css')) {
        if (options?.failStylesheetA) {
          return new Response('missing', { status: 404 });
        }
        stylesheetACount += 1;
        const key = `stylesheet-a:${stylesheetACount}`;
        const deferred = createDeferredFetchResponse();
        stylesheetTextGates[key] = deferred.gate;
        return deferred.promise;
      }
      if (url.endsWith('/data/theme/b.css')) {
        stylesheetBCount += 1;
        const key = `stylesheet-b:${stylesheetBCount}`;
        const deferred = createDeferredFetchResponse();
        stylesheetTextGates[key] = deferred.gate;
        return deferred.promise;
      }
      return baseFetch(input, init);
    }),
  );

  return { gates, snapshotTextGates, stylesheetTextGates, requestCounts };
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

describe('ScreenSpecPage resource load race', () => {
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

  it('route load: model 適用後 resource pending は loading 表示と aria-busy', async () => {
    const { gates, snapshotTextGates, stylesheetTextGates } = stubResourceRaceFetch();
    const { wrapper } = await mountDualScreenPage('screen-a');

    gates['screen-a:1'].resolve(screenAData);
    await flushPromises();

    expect(wrapper.find('[data-testid="page-resource-loading"]').exists()).toBe(true);
    expect(wrapper.find('.spec-page').attributes('aria-busy')).toBe('true');
    expect(wrapper.find('.state-selector__button').attributes('disabled')).toBeDefined();

    lastGate(snapshotTextGates, 'snapshot-a:')!.resolveText('<main data-a></main>');
    await flushPromises();
    lastGate(stylesheetTextGates, 'stylesheet-a:')!.resolveText('/* css-a */');
    await flushPromises();

    expect(wrapper.find('[data-testid="page-resource-loading"]').exists()).toBe(false);
    expect(wrapper.find('.spec-page').attributes('aria-busy')).toBeUndefined();
    expect(readPreviewHtml(wrapper)).toBe('<main data-a></main>');
  });

  it('route resource 失敗: stylesheet HTTP 404 で error UI', async () => {
    const { gates, snapshotTextGates } = stubResourceRaceFetch({ failStylesheetA: true });

    const { wrapper } = await mountDualScreenPage('screen-a');
    gates['screen-a:1'].resolve(screenAData);
    await flushPromises();
    lastGate(snapshotTextGates, 'snapshot-a:')!.resolveText('<main data-a></main>');
    await flushPromises();

    expect(wrapper.find('.spec-page--error').exists()).toBe(true);
    expect(wrapper.text()).toContain('プレビューリソースの読み込みに失敗しました');
  });

  it('stale loading completion: A pending → B → B 完了 → A late success 無視', async () => {
    const { gates, snapshotTextGates, stylesheetTextGates } = stubResourceRaceFetch();
    const { wrapper, router } = await mountDualScreenPage('screen-a');

    gates['screen-a:1'].resolve(screenAData);
    await flushPromises();
    const a1Snapshot = lastGate(snapshotTextGates, 'snapshot-a:');
    expect(a1Snapshot).toBeDefined();

    await router.push('/screens/screen-b');
    await nextTick();
    gates['screen-b:1'].resolve(screenBData);
    await flushPromises();
    lastGate(snapshotTextGates, 'snapshot-b:')!.resolveText('<main data-b></main>');
    await flushPromises();
    lastGate(stylesheetTextGates, 'stylesheet-b:')!.resolveText('/* css-b */');
    await flushPromises();

    a1Snapshot!.resolveText('<main data-a-stale></main>');
    await flushPromises();

    expect(wrapper.text()).toContain('B中間');
    expect(readPreviewHtml(wrapper)).toBe('<main data-b></main>');
    expect(wrapper.find('[data-testid="page-resource-loading"]').exists()).toBe(false);
  });

  it('A→B→A: A2 완료 후 B/A1 늦은 snapshot/stylesheet가 A2 state를 덮지 않음', async () => {
    const { gates, snapshotTextGates, stylesheetTextGates } = stubResourceRaceFetch();
    const htmlHistory: string[] = [];
    const cssHistory: string[] = [];

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
    htmlHistory.push(readPreviewHtml(wrapper));
    cssHistory.push(JSON.stringify(readPreviewStylesheets(wrapper)));

    gates['screen-a:2'].resolve(screenAData);
    await flushPromises();
    htmlHistory.push(readPreviewHtml(wrapper));
    cssHistory.push(JSON.stringify(readPreviewStylesheets(wrapper)));

    const a2Snapshot = lastGate(snapshotTextGates, 'snapshot-a:');
    expect(a2Snapshot).toBeDefined();
    a2Snapshot!.resolveText('<main data-a2></main>');
    await flushPromises();

    const a2Stylesheet = lastGate(stylesheetTextGates, 'stylesheet-a:');
    expect(a2Stylesheet).toBeDefined();
    a2Stylesheet!.resolveText('/* css-a2 */');
    await flushPromises();
    htmlHistory.push(readPreviewHtml(wrapper));
    cssHistory.push(JSON.stringify(readPreviewStylesheets(wrapper)));

    gates['screen-b:1'].resolve(screenBData);
    await flushPromises();

    const bSnapshot = lastGate(snapshotTextGates, 'snapshot-b:');
    const bStylesheet = lastGate(stylesheetTextGates, 'stylesheet-b:');
    bSnapshot?.resolveText('<main data-b></main>');
    bStylesheet?.resolveText('/* css-b */');
    await flushPromises();
    htmlHistory.push(readPreviewHtml(wrapper));
    cssHistory.push(JSON.stringify(readPreviewStylesheets(wrapper)));

    gates['screen-a:1'].resolve(screenAOldData);
    await flushPromises();
    htmlHistory.push(readPreviewHtml(wrapper));
    cssHistory.push(JSON.stringify(readPreviewStylesheets(wrapper)));

    expect(wrapper.text()).toContain('A最終');
    expect(readPreviewHtml(wrapper)).toBe('<main data-a2></main>');
    expect(readPreviewStylesheets(wrapper)[0]?.cssText).toBe('/* css-a2 */');
    expect(htmlHistory.filter((html) => html !== '')).not.toContain('<main data-b></main>');
    expect(cssHistory.filter((css) => css !== '[]')).not.toContain('[{"cssText":"/* css-b */","media":"all"}]');
  });

  it('snapshot text race: B text pending → A2 완료 → B text late resolve', async () => {
    const { gates, snapshotTextGates, stylesheetTextGates } = stubResourceRaceFetch();

    const { wrapper, router } = await mountDualScreenPage('screen-a');
    await router.push('/screens/screen-b');
    await nextTick();
    await router.push('/screens/screen-a');
    await nextTick();

    gates['screen-a:2'].resolve(screenAData);
    await flushPromises();

    lastGate(snapshotTextGates, 'snapshot-a:')!.resolveText('<main data-a2></main>');
    await flushPromises();
    lastGate(stylesheetTextGates, 'stylesheet-a:')!.resolveText('/* css-a2 */');
    await flushPromises();

    gates['screen-b:1'].resolve(screenBData);
    await flushPromises();

    lastGate(snapshotTextGates, 'snapshot-b:')?.resolveText('<main data-b></main>');
    await flushPromises();

    expect(readPreviewHtml(wrapper)).toBe('<main data-a2></main>');
  });

  it('stylesheet race: B stylesheet pending → A2 완료 → B stylesheet late resolve', async () => {
    const { gates, snapshotTextGates, stylesheetTextGates } = stubResourceRaceFetch();

    const { wrapper, router } = await mountDualScreenPage('screen-a');
    await router.push('/screens/screen-b');
    await nextTick();
    await router.push('/screens/screen-a');
    await nextTick();

    gates['screen-a:2'].resolve(screenAData);
    await flushPromises();

    lastGate(snapshotTextGates, 'snapshot-a:')!.resolveText('<main data-a2></main>');
    await flushPromises();

    lastGate(stylesheetTextGates, 'stylesheet-a:')!.resolveText('/* css-a2 */');
    await flushPromises();

    gates['screen-b:1'].resolve(screenBData);
    await flushPromises();

    lastGate(snapshotTextGates, 'snapshot-b:')?.resolveText('<main data-b></main>');
    lastGate(stylesheetTextGates, 'stylesheet-b:')?.resolveText('/* css-b */');
    await flushPromises();

    expect(readPreviewStylesheets(wrapper)[0]?.cssText).toBe('/* css-a2 */');
  });

  it('unmount 후 snapshot text resolve → state 변경 없음', async () => {
    const { gates, snapshotTextGates } = stubResourceRaceFetch();

    const { wrapper } = await mountDualScreenPage('screen-a');
    gates['screen-a:1'].resolve(screenAData);
    await flushPromises();
    const pending = lastGate(snapshotTextGates, 'snapshot-a:');
    expect(pending).toBeDefined();

    wrapper.unmount();
    pending!.resolveText('<main data-late></main>');
    await flushPromises();

    expect(wrapper.findComponent(DomPreview).exists()).toBe(false);
  });

  it('unmount 후 snapshot text reject → uncaught rejection 없음', async () => {
    const { gates, snapshotTextGates } = stubResourceRaceFetch();

    const { wrapper } = await mountDualScreenPage('screen-a');
    gates['screen-a:1'].resolve(screenAData);
    await flushPromises();
    const pending = lastGate(snapshotTextGates, 'snapshot-a:');
    expect(pending).toBeDefined();

    wrapper.unmount();
    pending!.rejectText(new Error('text failed'));
    await flushPromises();

    expect(wrapper.find('.spec-page--error').exists()).toBe(false);
  });

  it('unmount 후 stylesheet text resolve → state 변경 없음', async () => {
    const { gates, snapshotTextGates, stylesheetTextGates } = stubResourceRaceFetch();

    const { wrapper } = await mountDualScreenPage('screen-a');
    gates['screen-a:1'].resolve(screenAData);
    await flushPromises();
    lastGate(snapshotTextGates, 'snapshot-a:')?.resolveText('<main></main>');
    await flushPromises();

    const pending = lastGate(stylesheetTextGates, 'stylesheet-a:');
    expect(pending).toBeDefined();

    wrapper.unmount();
    pending!.resolveText('/* late css */');
    await flushPromises();

    expect(wrapper.findComponent(DomPreview).exists()).toBe(false);
  });

  it('unmount 후 stylesheet text reject → uncaught rejection 없음', async () => {
    const { gates, snapshotTextGates, stylesheetTextGates } = stubResourceRaceFetch();

    const { wrapper } = await mountDualScreenPage('screen-a');
    gates['screen-a:1'].resolve(screenAData);
    await flushPromises();
    lastGate(snapshotTextGates, 'snapshot-a:')?.resolveText('<main></main>');
    await flushPromises();

    const pending = lastGate(stylesheetTextGates, 'stylesheet-a:');
    expect(pending).toBeDefined();

    wrapper.unmount();
    pending!.rejectText(new Error('css failed'));
    await flushPromises();

    expect(wrapper.find('.spec-page--error').exists()).toBe(false);
  });
});
