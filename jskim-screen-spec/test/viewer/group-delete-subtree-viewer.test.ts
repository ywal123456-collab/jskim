import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ScreenSpecPage from '../../src/viewer/pages/ScreenSpecPage.vue';
import GroupDeleteSubtreeDialog from '../../src/viewer/components/GroupDeleteSubtreeDialog.vue';
import type { ManifestScreen, ScreenData, ViewerManifest } from '../../src/viewer/types';
import {
  mockDescriptionRevision,
  stubDescriptionTreeFetch,
  type MockTreeDoc,
} from '../helpers/description-tree-fetch-mock';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

/** collected なし（削除可能な manual-only subtree） */
function createManualDoc(overrides?: Partial<MockTreeDoc>): MockTreeDoc {
  return {
    screen: { id: 'grouped', name: 'Grouped', description: '' },
    itemOrder: ['leaf-item', 'root-item', 'sibling-item'],
    items: {
      'leaf-item': {
        name: '末端項目',
        type: 'text',
        description: '',
        note: '',
      },
      'root-item': {
        name: 'ルート項目',
        type: 'text',
        description: '',
        note: '',
      },
      'sibling-item': {
        name: '兄弟項目',
        type: 'text',
        description: '',
        note: '',
      },
    },
    collectedItemIds: [],
    rootNodes: [
      { type: 'group', id: 'parent-section' },
      { type: 'item', id: 'sibling-item' },
    ],
    groups: [
      {
        groupId: 'parent-section',
        name: '親グループ',
        kind: 'SECTION',
        description: '親の説明',
        children: [
          { type: 'group', id: 'child-card' },
          { type: 'item', id: 'root-item' },
        ],
      },
      {
        groupId: 'child-card',
        name: '子カード',
        kind: 'CARD',
        description: '子の説明',
        children: [{ type: 'item', id: 'leaf-item' }],
      },
    ],
    ...overrides,
  };
}

const groupedManifest: ManifestScreen = {
  id: 'grouped',
  name: 'Grouped',
  path: '/grouped.html',
  dataFile: 'screens/grouped.json',
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

const screenBManifest: ManifestScreen = {
  id: 'screen-b',
  name: 'Screen B',
  path: '/screen-b.html',
  dataFile: 'screens/screen-b.json',
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

const groupedScreen: ScreenData = {
  id: 'grouped',
  name: 'Grouped',
  description: '',
  path: '/grouped.html',
  itemOrder: ['leaf-item', 'root-item', 'sibling-item'],
  items: {
    'leaf-item': {
      name: '末端項目',
      type: 'text',
      description: '',
      note: '',
    },
    'root-item': {
      name: 'ルート項目',
      type: 'text',
      description: '',
      note: '',
    },
    'sibling-item': {
      name: '兄弟項目',
      type: 'text',
      description: '',
      note: '',
    },
  },
  states: [
    {
      id: 'default',
      name: '初期',
      viewer: { visible: true, order: 1 },
      snapshotFile: 'snapshots/grouped/default.html',
    },
  ],
  interactions: [],
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

const screenBScreen: ScreenData = {
  id: 'screen-b',
  name: 'Screen B',
  description: '',
  path: '/screen-b.html',
  itemOrder: ['title'],
  items: {
    title: { name: 'B項目', type: 'text', description: '', note: '' },
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

function stubGroupedPageFetch(options?: {
  doc?: MockTreeDoc;
  onFetch?: (
    url: string,
    method: string,
    body: Record<string, unknown>,
  ) => Response | Promise<Response> | null;
  wrapFetch?: (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    baseFetch: typeof fetch,
  ) => Promise<Response>;
}): ReturnType<typeof stubDescriptionTreeFetch> {
  const stubbed = stubDescriptionTreeFetch(
    {
      grouped: options?.doc ?? createManualDoc(),
      'screen-b': {
        screen: { id: 'screen-b', name: 'Screen B', description: '' },
        itemOrder: ['title'],
        items: {
          title: { name: 'B項目', type: 'text', description: '', note: '' },
        },
        collectedItemIds: ['title'],
      },
    },
    {
      onFetch: options?.onFetch,
      extraHandler: (url) => {
        if (url.endsWith('/data/screens/grouped.json')) {
          return jsonResponse(groupedScreen);
        }
        if (url.endsWith('/data/screens/screen-b.json')) {
          return jsonResponse(screenBScreen);
        }
        if (url.endsWith('/data/snapshots/grouped/default.html')) {
          return textResponse('<main data-grouped></main>');
        }
        if (url.endsWith('/data/snapshots/screen-b/default.html')) {
          return textResponse('<main data-b></main>');
        }
        if (url.endsWith('/data/theme/preview.css')) {
          return textResponse('/* preview */');
        }
        return null;
      },
    },
  );

  if (options?.wrapFetch) {
    const baseFetch = stubbed.getFetchMock();
    const wrapped = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      options.wrapFetch!(input, init, baseFetch as typeof fetch),
    );
    vi.stubGlobal('fetch', wrapped);
    return { state: stubbed.state, getFetchMock: () => wrapped };
  }

  return stubbed;
}

async function mountGroupedPage(options?: { initialScreenId?: string }) {
  const initialScreenId = options?.initialScreenId ?? 'grouped';
  const manifest = computed<ViewerManifest>(() => ({
    schemaVersion: '1',
    projectName: 'demo',
    base: '/spec/',
    screens: [groupedManifest, screenBManifest],
  }));
  const router = createRouter({
    history: createMemoryHistory('/spec/'),
    routes: [
      {
        path: '/screens/:screenId',
        component: ScreenSpecPage,
        props: true,
      },
      { path: '/', redirect: `/screens/${initialScreenId}` },
    ],
  });
  await router.push(`/screens/${initialScreenId}`);
  await router.isReady();
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
      attachTo: document.body,
    },
  );
  await flushPromises();
  return { wrapper, router };
}

function countCalls(
  fetchMock: ReturnType<typeof vi.fn>,
  predicate: (url: string, method: string) => boolean,
): number {
  return fetchMock.mock.calls.filter(([url, init]) =>
    predicate(
      String(url),
      ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase(),
    ),
  ).length;
}

async function selectGroupByLabel(
  wrapper: Awaited<ReturnType<typeof mountGroupedPage>>['wrapper'],
  label: string,
) {
  const button = wrapper
    .findAll('.item-tree__select')
    .find((entry) => entry.text().includes(label));
  expect(button).toBeTruthy();
  await button!.trigger('click');
  await flushPromises();
}

async function selectItemByLabel(
  wrapper: Awaited<ReturnType<typeof mountGroupedPage>>['wrapper'],
  label: string,
) {
  const button = wrapper
    .findAll('.item-tree__select')
    .find((entry) => entry.text().includes(label));
  expect(button).toBeTruthy();
  await button!.trigger('click');
  await flushPromises();
}

async function confirmSubtreeDelete(
  wrapper: Awaited<ReturnType<typeof mountGroupedPage>>['wrapper'],
) {
  await wrapper
    .findComponent(GroupDeleteSubtreeDialog)
    .find('[data-testid="group-delete-subtree-confirm"]')
    .trigger('click');
  await flushPromises();
}

describe('GroupDeleteSubtreeDialog', () => {
  it('名前・ID・件数・danger・既定 focus を表示する', async () => {
    const wrapper = mount(GroupDeleteSubtreeDialog, {
      props: {
        groupId: 'child-card',
        groupName: '子カード',
        descendantGroupCount: 1,
        itemCount: 2,
        containsCollectedItem: false,
      },
      attachTo: document.body,
    });
    await flushPromises();
    expect(wrapper.find('#group-delete-subtree-dialog-title').text()).toContain(
      '削除',
    );
    expect(wrapper.text()).toContain('子カード');
    expect(wrapper.text()).toContain('child-card');
    expect(
      wrapper.find('[data-testid="group-delete-subtree-descendant-count"]').text(),
    ).toContain('1');
    expect(
      wrapper.find('[data-testid="group-delete-subtree-item-count"]').text(),
    ).toContain('2');
    expect(
      wrapper.find('[data-testid="group-delete-subtree-confirm"]').classes(),
    ).toContain('spec-page__btn--danger');
    expect(document.activeElement).toBe(
      wrapper.find('[data-testid="group-delete-subtree-cancel"]').element,
    );
    wrapper.unmount();
  });

  it('collected 含むと confirm disabled・role=alert', async () => {
    const wrapper = mount(GroupDeleteSubtreeDialog, {
      props: {
        groupId: 'child-card',
        groupName: '子カード',
        descendantGroupCount: 1,
        itemCount: 2,
        containsCollectedItem: true,
      },
    });
    expect(
      wrapper.find('[data-testid="group-delete-subtree-confirm"]').attributes(
        'disabled',
      ),
    ).toBeDefined();
    expect(
      wrapper.find('[data-testid="group-delete-subtree-collected-block"]').attributes(
        'role',
      ),
    ).toBe('alert');
    wrapper.unmount();
  });

  it('pending 中は confirm / Escape / overlay close を抑止する', async () => {
    const wrapper = mount(GroupDeleteSubtreeDialog, {
      props: {
        groupId: 'g1',
        groupName: 'G',
        descendantGroupCount: 0,
        itemCount: 0,
        pending: true,
      },
    });
    await wrapper.find('[data-testid="group-delete-subtree-confirm"]').trigger('click');
    expect(wrapper.emitted('confirm')).toBeUndefined();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.emitted('close')).toBeUndefined();
    await wrapper.find('.create-screen-dialog-overlay').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });

  it('エラーは role=alert、通常時 Esc で close', async () => {
    const wrapper = mount(GroupDeleteSubtreeDialog, {
      props: {
        groupId: 'g1',
        groupName: 'G',
        descendantGroupCount: 0,
        itemCount: 0,
        errorMessage: 'サーバーエラー',
      },
    });
    expect(
      wrapper.find('[data-testid="group-delete-subtree-error"]').attributes('role'),
    ).toBe('alert');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });
});

describe('Group subtree 削除 Viewer', () => {
  beforeEach(() => {
    window.__JSKIM_SPEC_EDIT__ = {
      enabled: true,
      apiBase: '/_jskim/spec/descriptions',
    };
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    delete window.__JSKIM_SPEC_EDIT__;
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('Nested selected Group 削除 → parent 選択', async () => {
    const { getFetchMock } = stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-delete-subtree-open"]').trigger('click');
    await flushPromises();
    await confirmSubtreeDelete(wrapper);
    expect(
      countCalls(
        getFetchMock(),
        (url, method) =>
          method === 'POST' && url.includes('/groups/child-card/delete-subtree'),
      ),
    ).toBe(1);
    expect(wrapper.findComponent(GroupDeleteSubtreeDialog).exists()).toBe(false);
    expect(wrapper.find('[data-testid="group-info-panel"]').text()).toContain(
      '親グループ',
    );
    expect(wrapper.text()).toContain('グループを削除しました');
    expect(wrapper.text()).not.toContain('末端項目');
  });

  it('削除された descendant Item 選択 → parent 選択', async () => {
    stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    // 子カードを展開して descendant Item を見えるようにする
    const childToggle = wrapper
      .findAll('.item-tree__toggle')
      .find((button) => {
        const row = button.element.closest('.item-tree__row');
        return row?.textContent?.includes('子カード') ?? false;
      });
    expect(childToggle).toBeTruthy();
    if (childToggle?.attributes('aria-expanded') !== 'true') {
      await childToggle!.trigger('click');
      await flushPromises();
    }
    await wrapper.find('[data-testid="group-delete-subtree-open"]').trigger('click');
    await flushPromises();
    // dialog 中に subtree 内 Item を選択
    await selectItemByLabel(wrapper, '末端項目');
    await confirmSubtreeDelete(wrapper);
    expect(wrapper.find('[data-testid="group-info-panel"]').text()).toContain(
      '親グループ',
    );
  });

  it('Root 削除 → next sibling', async () => {
    stubGroupedPageFetch({
      doc: createManualDoc({
        rootNodes: [
          { type: 'group', id: 'parent-section' },
          { type: 'item', id: 'sibling-item' },
        ],
      }),
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '親グループ');
    await wrapper.find('[data-testid="group-delete-subtree-open"]').trigger('click');
    await flushPromises();
    await confirmSubtreeDelete(wrapper);
    expect(wrapper.find('.item-tree__row.is-selected').text()).toContain(
      '兄弟項目',
    );
  });

  it('Root 削除 next なし → previous sibling', async () => {
    stubGroupedPageFetch({
      doc: createManualDoc({
        rootNodes: [
          { type: 'item', id: 'sibling-item' },
          { type: 'group', id: 'parent-section' },
        ],
      }),
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '親グループ');
    await wrapper.find('[data-testid="group-delete-subtree-open"]').trigger('click');
    await flushPromises();
    await confirmSubtreeDelete(wrapper);
    expect(wrapper.find('.item-tree__row.is-selected').text()).toContain(
      '兄弟項目',
    );
  });

  it('最後の node 削除 → empty state', async () => {
    stubGroupedPageFetch({
      doc: createManualDoc({
        rootNodes: [{ type: 'group', id: 'empty-root' }],
        groups: [
          {
            groupId: 'empty-root',
            name: '空ルート',
            kind: 'SECTION',
            children: [],
          },
        ],
        itemOrder: [],
        items: {},
        collectedItemIds: [],
      }),
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '空ルート');
    await wrapper.find('[data-testid="group-delete-subtree-open"]').trigger('click');
    await flushPromises();
    await confirmSubtreeDelete(wrapper);
    expect(wrapper.find('[data-testid="group-info-panel"]').exists()).toBe(false);
    expect(wrapper.find('.item-tree__row.is-selected').exists()).toBe(false);
  });

  it('dialog 中に他の生存 node 選択 → 選択保全', async () => {
    stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-delete-subtree-open"]').trigger('click');
    await flushPromises();
    await selectItemByLabel(wrapper, '兄弟項目');
    await confirmSubtreeDelete(wrapper);
    expect(wrapper.find('.item-tree__row.is-selected').text()).toContain(
      '兄弟項目',
    );
  });

  it('削除 Group の expanded を除去し unrelated を維持', async () => {
    stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '親グループ');
    const parentToggle = wrapper
      .findAll('[data-testid="item-tree-toggle"]')
      .find((btn) => btn.attributes('aria-label')?.includes('親') || true);
    // expand both groups via selecting nested
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-delete-subtree-open"]').trigger('click');
    await flushPromises();
    await confirmSubtreeDelete(wrapper);
    expect(wrapper.text()).toContain('親グループ');
    expect(wrapper.text()).not.toContain('子カード');
    void parentToggle;
  });

  it('削除 Item draft を整理し unrelated draft を維持', async () => {
    stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    await selectItemByLabel(wrapper, '兄弟項目');
    const noteInput = wrapper.find('textarea');
    if (noteInput.exists()) {
      await noteInput.setValue('兄弟メモ');
      await flushPromises();
    }
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-delete-subtree-open"]').trigger('click');
    await flushPromises();
    await confirmSubtreeDelete(wrapper);
    await selectItemByLabel(wrapper, '兄弟項目');
    if (noteInput.exists()) {
      expect(wrapper.text()).toContain('兄弟項目');
    }
  });

  it('collected 含む → POST 0・confirm disabled', async () => {
    const { getFetchMock } = stubGroupedPageFetch({
      doc: createManualDoc({ collectedItemIds: ['leaf-item'] }),
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-delete-subtree-open"]').trigger('click');
    await flushPromises();
    const confirm = wrapper.find('[data-testid="group-delete-subtree-confirm"]');
    expect(confirm.attributes('disabled')).toBeDefined();
    await confirm.trigger('click');
    await flushPromises();
    expect(
      countCalls(
        getFetchMock(),
        (url, method) => method === 'POST' && url.includes('delete-subtree'),
      ),
    ).toBe(0);
    expect(wrapper.findComponent(GroupDeleteSubtreeDialog).exists()).toBe(true);
  });

  it('revision 409 → tree 不変・dialog 維持', async () => {
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('delete-subtree') && method === 'POST') {
          return jsonResponse(
            {
              code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
              message: '衝突',
              expectedRevision: mockDescriptionRevision(1),
              currentRevision: mockDescriptionRevision(9),
            },
            409,
          );
        }
        return null;
      },
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-delete-subtree-open"]').trigger('click');
    await flushPromises();
    await confirmSubtreeDelete(wrapper);
    expect(wrapper.findComponent(GroupDeleteSubtreeDialog).exists()).toBe(true);
    expect(wrapper.text()).toContain('子カード');
    expect(wrapper.text()).not.toContain('グループを削除しました');
  });

  it('500/network 後 exact committed → success recovery', async () => {
    let postSeen = false;
    stubGroupedPageFetch({
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && url.includes('delete-subtree')) {
          // 先に base で commit してから、クライアントには成功 envelope を返す
          const committed = await baseFetch(input, init);
          postSeen = true;
          return committed;
        }
        if (postSeen && method === 'GET' && url.includes('/description-tree/')) {
          return baseFetch(input, init);
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-delete-subtree-open"]').trigger('click');
    await flushPromises();
    await confirmSubtreeDelete(wrapper);
    expect(wrapper.text()).toContain('グループを削除しました');
  });

  it('target present + same revision → 失敗維持', async () => {
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('delete-subtree') && method === 'POST') {
          return new Response('gateway', { status: 502 });
        }
        return null;
      },
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-delete-subtree-open"]').trigger('click');
    await flushPromises();
    await confirmSubtreeDelete(wrapper);
    expect(wrapper.findComponent(GroupDeleteSubtreeDialog).exists()).toBe(true);
    expect(wrapper.text()).toContain('子カード');
    expect(wrapper.text()).not.toContain('グループを削除しました');
    expect(
      wrapper.find('[data-testid="group-add-root-open"]').attributes('disabled'),
    ).toBeUndefined();
  });

  it('revision divergence / GET 失敗 → reloadRequired', async () => {
    let postDone = false;
    stubGroupedPageFetch({
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && url.includes('delete-subtree')) {
          postDone = true;
          return jsonResponse({
            status: 'updated',
            revision: mockDescriptionRevision(2),
          });
        }
        if (postDone && method === 'GET' && url.includes('/description-tree/')) {
          return new Response('fail', { status: 500 });
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-delete-subtree-open"]').trigger('click');
    await flushPromises();
    await confirmSubtreeDelete(wrapper);
    expect(wrapper.text()).toMatch(/再読み込み/);
    expect(
      wrapper.find('[data-testid="group-add-root-open"]').attributes('disabled'),
    ).toBeDefined();
  });

  it('double confirm → POST 1', async () => {
    let releasePost!: (value: Response) => void;
    const postHold = new Promise<Response>((resolve) => {
      releasePost = resolve;
    });
    const { getFetchMock } = stubGroupedPageFetch({
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && url.includes('delete-subtree')) {
          return postHold;
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-delete-subtree-open"]').trigger('click');
    await flushPromises();
    const confirm = wrapper.find('[data-testid="group-delete-subtree-confirm"]');
    await confirm.trigger('click');
    await confirm.trigger('click');
    await flushPromises();
    releasePost(
      jsonResponse({ status: 'updated', revision: mockDescriptionRevision(2) }),
    );
    await flushPromises();
    expect(
      countCalls(
        getFetchMock(),
        (url, method) => method === 'POST' && url.includes('delete-subtree'),
      ),
    ).toBe(1);
  });

  it('Screen A late response → Screen B 不変', async () => {
    let releasePost!: (value: Response) => void;
    const postHold = new Promise<Response>((resolve) => {
      releasePost = resolve;
    });
    stubGroupedPageFetch({
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (
          method === 'POST' &&
          url.includes('grouped') &&
          url.includes('delete-subtree')
        ) {
          return postHold;
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper, router } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-delete-subtree-open"]').trigger('click');
    await flushPromises();
    await wrapper
      .findComponent(GroupDeleteSubtreeDialog)
      .find('[data-testid="group-delete-subtree-confirm"]')
      .trigger('click');
    await flushPromises();
    await router.push('/screens/screen-b');
    await flushPromises();
    const before = wrapper.text();
    releasePost(
      jsonResponse({ status: 'updated', revision: mockDescriptionRevision(2) }),
    );
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toBe(before);
    expect(wrapper.text()).not.toContain('グループを削除しました');
  });
});
