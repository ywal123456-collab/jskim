import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ScreenSpecPage from '../../src/viewer/pages/ScreenSpecPage.vue';
import type { ManifestScreen, ScreenData, ViewerManifest } from '../../src/viewer/types.js';
import { DESCRIPTION_TREE_API_PREFIX } from '../../src/viewer/editing/description-tree-types.js';

const treeScreenManifest: ManifestScreen = {
  id: 'tree-screen',
  name: 'Tree Screen',
  path: '/tree.html',
  dataFile: 'screens/tree-screen.json',
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

const treeScreenData: ScreenData = {
  id: 'tree-screen',
  name: 'Tree Screen',
  description: 'Tree test',
  path: '/tree.html',
  itemOrder: ['item-root', 'item-nested'],
  items: {
    'item-root': { name: 'Root Item', type: 'text', description: '', note: '' },
    'item-nested': { name: 'Nested Item', type: 'text', description: '', note: '' },
  },
  states: [
    {
      id: 'default',
      name: '初期',
      viewer: { visible: true, order: 1 },
      snapshotFile: 'snapshots/tree-screen/default.html',
    },
  ],
  interactions: [],
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

const descriptionTreeResponse = {
  revision: 'sha256:' + 'd'.repeat(64),
  sourceSchemaVersion: '1.3',
  description: {
    schemaVersion: '1.3',
    screen: { id: 'tree-screen', name: 'Tree Screen', description: 'Tree test' },
    rootNodes: [
      { type: 'group', id: 'section' },
      { type: 'item', id: 'item-root' },
    ],
    groups: [
      {
        groupId: 'section',
        name: '契約情報',
        kind: 'SECTION',
        children: [{ type: 'item', id: 'item-nested' }],
      },
    ],
    items: {
      'item-root': { name: 'Root Item', type: 'text', description: '', note: '' },
      'item-nested': { name: 'Nested Item', type: 'text', description: '', note: '' },
    },
    excludedItems: {},
  },
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

function mockFetch(options: { treeStatus?: number } = {}): ReturnType<typeof vi.fn> {
  const treeStatus = options.treeStatus ?? 200;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    if (url.includes(`${DESCRIPTION_TREE_API_PREFIX}/tree-screen`) && method === 'GET') {
      if (treeStatus !== 200) {
        return jsonResponse(
          { code: 'SPEC_DESCRIPTION_NOT_FOUND', message: '画面設計書が見つかりません。' },
          treeStatus,
        );
      }
      return jsonResponse(descriptionTreeResponse);
    }
    if (url.endsWith('/data/screens/tree-screen.json')) {
      return jsonResponse(treeScreenData);
    }
    if (url.endsWith('/data/snapshots/tree-screen/default.html')) {
      return textResponse('<div data-jskim-spec-item="item-root"></div>');
    }
    if (url.endsWith('/data/theme/preview.css')) {
      return textResponse('/* preview */');
    }
    if (method !== 'GET') {
      return jsonResponse({ code: 'UNEXPECTED', message: 'mutation' }, 405);
    }
    return new Response('not found', { status: 404 });
  });
}

async function mountTreePage(fetchFn: typeof fetch) {
  vi.stubGlobal('fetch', fetchFn);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/screens/:screenId', component: ScreenSpecPage, props: true }],
  });
  await router.push('/screens/tree-screen');
  await router.isReady();
  const manifest = computed<ViewerManifest>(() => ({
    schemaVersion: '1',
    projectName: 'sample',
    base: '/spec/',
    screens: [treeScreenManifest],
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
  return wrapper;
}

describe('ScreenSpecPage Item Tree integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Item Tree panel を表示し Item 選択で既存 table と連動する', async () => {
    const fetchFn = mockFetch();
    const wrapper = await mountTreePage(fetchFn);
    expect(wrapper.text()).toContain('項目ツリー');
    expect(wrapper.text()).toContain('契約情報');
    const nestedButton = wrapper
      .findAll('.item-tree__select')
      .find((node) => node.text().includes('Nested Item'));
    expect(nestedButton).toBeTruthy();
    await nestedButton!.trigger('click');
    await flushPromises();
    expect(wrapper.find('#item-row-item-nested.is-selected').exists()).toBe(true);
  });

  it('Group 選択で read-only panel を表示する', async () => {
    const fetchFn = mockFetch();
    const wrapper = await mountTreePage(fetchFn);
    const groupButton = wrapper
      .findAll('.item-tree__select')
      .find((node) => node.text().includes('契約情報'));
    await groupButton!.trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="group-info-panel"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('グループ情報');
  });

  it('Tree API 失敗でも preview 領域は維持する', async () => {
    const fetchFn = mockFetch({ treeStatus: 404 });
    const wrapper = await mountTreePage(fetchFn);
    expect(wrapper.text()).toContain('Item Tree を取得できませんでした');
    expect(wrapper.find('.state-selector').exists()).toBe(true);
  });

  it('Tree UI 操作で mutation API を呼ばない', async () => {
    const fetchFn = mockFetch();
    const wrapper = await mountTreePage(fetchFn);
    await wrapper.find('.item-tree-panel__reload').trigger('click');
    await flushPromises();
    const mutationCall = fetchFn.mock.calls.find((call) => {
      const init = call[1] as RequestInit | undefined;
      const method = (init?.method || 'GET').toUpperCase();
      const url = String(call[0]);
      return (
        method !== 'GET' ||
        url.includes('/groups') ||
        url.includes('/nodes/move') ||
        url.includes('/children/reorder') ||
        url.includes('/delete')
      );
    });
    expect(mutationCall).toBeUndefined();
  });
});
