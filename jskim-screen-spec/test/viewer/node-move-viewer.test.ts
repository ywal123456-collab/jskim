import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ScreenSpecPage from '../../src/viewer/pages/ScreenSpecPage.vue';
import TreeNodeMoveControls from '../../src/viewer/components/TreeNodeMoveControls.vue';
import GroupEditDialog from '../../src/viewer/components/GroupEditDialog.vue';
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

function createMoveDoc(overrides?: Partial<MockTreeDoc>): MockTreeDoc {
  return {
    screen: { id: 'move-demo', name: 'Move Demo', description: '' },
    itemOrder: ['a', 'b', 'c', 'collected'],
    items: {
      a: { name: '項目A', type: 'text', description: '', note: '' },
      b: { name: '項目B', type: 'text', description: '', note: '' },
      c: { name: '項目C', type: 'text', description: '', note: '' },
      collected: {
        name: 'Collected Item',
        type: 'text',
        description: '',
        note: '',
      },
    },
    collectedItemIds: ['collected'],
    rootNodes: [
      { type: 'group', id: 'g-a' },
      { type: 'group', id: 'g-b' },
      { type: 'item', id: 'c' },
    ],
    groups: [
      {
        groupId: 'g-a',
        name: 'Group A',
        kind: 'SECTION',
        children: [{ type: 'item', id: 'a' }],
      },
      {
        groupId: 'g-b',
        name: 'Group B',
        kind: 'CARD',
        children: [
          { type: 'item', id: 'b' },
          { type: 'item', id: 'collected' },
        ],
      },
    ],
    ...overrides,
  };
}

const moveManifest: ManifestScreen = {
  id: 'move-demo',
  name: 'Move Demo',
  path: '/move-demo.html',
  dataFile: 'screens/move-demo.json',
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

const moveScreen: ScreenData = {
  id: 'move-demo',
  name: 'Move Demo',
  description: '',
  path: '/move-demo.html',
  itemOrder: ['a', 'b', 'c', 'collected'],
  items: {
    a: { name: '項目A', type: 'text', description: '', note: '' },
    b: { name: '項目B', type: 'text', description: '', note: '' },
    c: { name: '項目C', type: 'text', description: '', note: '' },
    collected: {
      name: 'Collected Item',
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
      snapshotFile: 'snapshots/move-demo/default.html',
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
  name: 'Screen B',
  description: '',
  path: '/screen-b.html',
  itemOrder: ['x'],
  items: {
    x: { name: 'X', type: 'text', description: '', note: '' },
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

function stubMovePageFetch(
  options?: {
    wrapFetch?: (
      input: RequestInfo | URL,
      init: RequestInit | undefined,
      baseFetch: typeof fetch,
    ) => Promise<Response>;
    onFetch?: (
      url: string,
      method: string,
      body: Record<string, unknown>,
    ) => Response | Promise<Response> | null;
  },
) {
  const stubbed = stubDescriptionTreeFetch(
    {
      'move-demo': createMoveDoc(),
      'screen-b': {
        screen: { id: 'screen-b', name: 'Screen B', description: '' },
        itemOrder: ['x'],
        items: {
          x: { name: 'X', type: 'text', description: '', note: '' },
        },
        collectedItemIds: [],
      },
    },
    {
      onFetch: options?.onFetch,
      extraHandler: (url) => {
        if (url.endsWith('/data/screens/move-demo.json')) {
          return jsonResponse(moveScreen);
        }
        if (url.endsWith('/data/screens/screen-b.json')) {
          return jsonResponse(screenBData);
        }
        if (url.endsWith('/data/snapshots/move-demo/default.html')) {
          return textResponse('<main data-move></main>');
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

async function mountMovePage(options?: { initialScreenId?: string }) {
  const initialScreenId = options?.initialScreenId ?? 'move-demo';
  const manifest = computed<ViewerManifest>(() => ({
    schemaVersion: '1',
    projectName: 'demo',
    base: '/spec/',
    screens: [moveManifest, screenBManifest],
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

function countPosts(
  fetchMock: ReturnType<typeof vi.fn>,
  predicate: (url: string) => boolean,
): number {
  return fetchMock.mock.calls.filter(([url, init]) => {
    const method = ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase();
    return method === 'POST' && predicate(String(url));
  }).length;
}

async function selectByLabel(
  wrapper: Awaited<ReturnType<typeof mountMovePage>>['wrapper'],
  label: string,
) {
  const button = wrapper
    .findAll('.item-tree__select')
    .find((entry) => entry.text().includes(label));
  expect(button).toBeTruthy();
  await button!.trigger('click');
  await flushPromises();
}

describe('TreeNodeMoveControls', () => {
  it('ボタン4つ・label/title・availability・emit', async () => {
    const wrapper = mount(TreeNodeMoveControls, {
      props: {
        canMoveUp: true,
        canMoveDown: false,
        canIndent: true,
        canOutdent: false,
      },
      attachTo: document.body,
    });
    const root = wrapper.find('[data-testid="tree-node-move-controls"]');
    expect(root.attributes('aria-label')).toBe('ノードの移動');
    expect(wrapper.find('[data-testid="tree-node-move-up"]').text()).toBe('上へ');
    expect(wrapper.find('[data-testid="tree-node-move-down"]').text()).toBe('下へ');
    expect(wrapper.find('[data-testid="tree-node-move-indent"]').text()).toBe(
      '下位へ',
    );
    expect(wrapper.find('[data-testid="tree-node-move-outdent"]').text()).toBe(
      '上位へ',
    );
    expect(
      wrapper.find('[data-testid="tree-node-move-up"]').attributes('title'),
    ).toContain('Alt+↑');
    expect(
      wrapper.find('[data-testid="tree-node-move-down"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.find('[data-testid="tree-node-move-outdent"]').attributes('disabled'),
    ).toBeDefined();

    await wrapper.find('[data-testid="tree-node-move-up"]').trigger('click');
    await wrapper.find('[data-testid="tree-node-move-down"]').trigger('click');
    await wrapper.find('[data-testid="tree-node-move-indent"]').trigger('click');
    expect(wrapper.emitted('move')).toEqual([['up'], ['indent']]);

    wrapper.unmount();
  });

  it('restoreFocus は disabled 時に次の enabled ボタンへ', async () => {
    const wrapper = mount(TreeNodeMoveControls, {
      props: {
        canMoveUp: false,
        canMoveDown: true,
        canIndent: false,
        canOutdent: false,
      },
      attachTo: document.body,
    });
    await (
      wrapper.vm as unknown as {
        restoreFocus: (d: 'up') => Promise<void>;
      }
    ).restoreFocus('up');
    await nextTick();
    expect(document.activeElement).toBe(
      wrapper.find('[data-testid="tree-node-move-down"]').element,
    );
    wrapper.unmount();
  });
});

describe('ScreenSpecPage node move UI', () => {
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

  it('Item/Group 選択時のみ controls を表示する', async () => {
    stubMovePageFetch();
    const { wrapper } = await mountMovePage();
    expect(wrapper.find('[data-testid="tree-node-move-controls"]').exists()).toBe(
      false,
    );
    await selectByLabel(wrapper, 'Group B');
    expect(wrapper.find('[data-testid="tree-node-move-controls"]').exists()).toBe(
      true,
    );
    await selectByLabel(wrapper, '項目C');
    expect(wrapper.find('[data-testid="tree-node-move-controls"]').exists()).toBe(
      true,
    );
    wrapper.unmount();
  });

  it('上へボタンで Group reorder・selection 維持', async () => {
    const { getFetchMock } = stubMovePageFetch();
    const { wrapper } = await mountMovePage();
    await selectByLabel(wrapper, 'Group B');
    await wrapper.find('[data-testid="tree-node-move-up"]').trigger('click');
    await flushPromises();
    expect(
      countPosts(getFetchMock(), (url) => url.includes('/children/reorder')),
    ).toBe(1);
    expect(wrapper.find('[data-testid="group-info-panel"]').text()).toContain(
      'Group B',
    );
    const labels = wrapper.findAll('.item-tree__select').map((n) => n.text());
    expect(labels.findIndex((t) => t.includes('Group B'))).toBeLessThan(
      labels.findIndex((t) => t.includes('Group A')),
    );
    wrapper.unmount();
  });

  it('indent 成功で destination Group を expanded', async () => {
    const { getFetchMock } = stubMovePageFetch();
    const { wrapper } = await mountMovePage();
    await selectByLabel(wrapper, '項目C');
    expect(
      wrapper.find('[data-testid="tree-node-move-indent"]').attributes('disabled'),
    ).toBeUndefined();
    await wrapper.find('[data-testid="tree-node-move-indent"]').trigger('click');
    await flushPromises();
    expect(
      countPosts(getFetchMock(), (url) => url.includes('/nodes/move')),
    ).toBe(1);
    // destination Group B が展開され、項目C が tree に見える
    expect(wrapper.text()).toContain('項目C');
    expect(wrapper.find('[data-testid="tree-node-move-controls"]').exists()).toBe(
      true,
    );
    // outdent 可能 = Group 内にいる
    expect(
      wrapper.find('[data-testid="tree-node-move-outdent"]').attributes('disabled'),
    ).toBeUndefined();
    wrapper.unmount();
  });

  it('collected Item の移動 controls は活性', async () => {
    stubMovePageFetch();
    const { wrapper } = await mountMovePage();
    await selectByLabel(wrapper, 'Group B');
    // Group 行の隣接 toggle で展開
    const groupSelect = wrapper
      .findAll('.item-tree__select')
      .find((entry) => entry.text().includes('Group B'));
    const row = groupSelect!.element.closest('.item-tree__row');
    const toggle = row?.querySelector('.item-tree__toggle') as HTMLButtonElement | null;
    if (toggle?.getAttribute('aria-expanded') === 'false') {
      toggle.click();
      await flushPromises();
    }
    await selectByLabel(wrapper, 'Collected Item');
    expect(
      wrapper.find('[data-testid="tree-node-move-up"]').attributes('disabled'),
    ).toBeUndefined();
    wrapper.unmount();
  });

  it('境界 unavailable は POST 0', async () => {
    const { getFetchMock } = stubMovePageFetch();
    const { wrapper } = await mountMovePage();
    await selectByLabel(wrapper, 'Group A');
    const before = countPosts(getFetchMock(), () => true);
    expect(
      wrapper.find('[data-testid="tree-node-move-up"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.find('[data-testid="tree-node-move-up"]').trigger('click');
    await flushPromises();
    expect(countPosts(getFetchMock(), () => true)).toBe(before);
    wrapper.unmount();
  });

  it('double click は POST 1', async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const stubbed = stubMovePageFetch({
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && url.includes('/children/reorder')) {
          await gate;
          return baseFetch(input, init);
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper } = await mountMovePage();
    await selectByLabel(wrapper, 'Group B');
    const btn = wrapper.find('[data-testid="tree-node-move-up"]');
    const p1 = btn.trigger('click');
    await flushPromises();
    await btn.trigger('click');
    await flushPromises();
    releaseGate();
    await p1;
    await flushPromises();
    expect(
      countPosts(stubbed.getFetchMock(), (url) =>
        url.includes('/children/reorder'),
      ),
    ).toBe(1);
    wrapper.unmount();
  });

  it('Alt+Arrow は button と同じ command・input/dialog/repeat では無視', async () => {
    const { getFetchMock } = stubMovePageFetch();
    const { wrapper } = await mountMovePage();
    await selectByLabel(wrapper, 'Group B');

    const beforeFirst = countPosts(getFetchMock(), (url) =>
      url.includes('/children/reorder'),
    );
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await flushPromises();
    expect(
      countPosts(getFetchMock(), (url) => url.includes('/children/reorder')) -
        beforeFirst,
    ).toBe(1);

    // dialog open 中は無視
    await wrapper.find('[data-testid="group-edit-open"]').trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(true);
    const beforeDialog = countPosts(getFetchMock(), () => true);
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await flushPromises();
    expect(countPosts(getFetchMock(), () => true)).toBe(beforeDialog);

    // dialog を閉じる
    await wrapper.findComponent(GroupEditDialog).vm.$emit('close');
    await flushPromises();

    // input focus 中は Viewer shortcut を実行しない
    const nameInput = wrapper.find('.spec-field input');
    (nameInput.element as HTMLInputElement).focus();
    const beforeInput = countPosts(getFetchMock(), (url) =>
      url.includes('/children/reorder'),
    );
    nameInput.element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await flushPromises();
    expect(
      countPosts(getFetchMock(), (url) => url.includes('/children/reorder')),
    ).toBe(beforeInput);

    // repeat 無視
    const beforeRepeat = countPosts(getFetchMock(), (url) =>
      url.includes('/children/reorder'),
    );
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        altKey: true,
        bubbles: true,
        cancelable: true,
        repeat: true,
      }),
    );
    await flushPromises();
    expect(
      countPosts(getFetchMock(), (url) => url.includes('/children/reorder')),
    ).toBe(beforeRepeat);

    wrapper.unmount();
  });

  it('境界 Alt+Arrow は preventDefault・POST 0', async () => {
    const { getFetchMock } = stubMovePageFetch();
    const { wrapper } = await mountMovePage();
    await selectByLabel(wrapper, 'Group A');
    const before = countPosts(getFetchMock(), () => true);
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    const prevented = !window.dispatchEvent(event) || event.defaultPrevented;
    await flushPromises();
    expect(prevented).toBe(true);
    expect(countPosts(getFetchMock(), () => true)).toBe(before);
    wrapper.unmount();
  });

  it('Screen A late response → B UI 後処理なし', async () => {
    let release!: (value: Response) => void;
    const hold = new Promise<Response>((resolve) => {
      release = resolve;
    });
    stubMovePageFetch({
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (
          method === 'POST' &&
          url.includes('move-demo') &&
          url.includes('/children/reorder')
        ) {
          return hold;
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper, router } = await mountMovePage();
    await selectByLabel(wrapper, 'Group B');
    const click = wrapper.find('[data-testid="tree-node-move-up"]').trigger('click');
    await flushPromises();
    await router.push('/screens/screen-b');
    await flushPromises();
    const beforeText = wrapper.text();
    release(
      new Response(
        JSON.stringify({
          status: 'updated',
          revision: mockDescriptionRevision(2),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await click;
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toBe(beforeText);
    wrapper.unmount();
  });
});
