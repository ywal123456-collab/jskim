import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import ScreenSpecPage from '../../src/viewer/pages/ScreenSpecPage.vue';
import GroupCreateDialog from '../../src/viewer/components/GroupCreateDialog.vue';
import GroupInfoPanel from '../../src/viewer/components/GroupInfoPanel.vue';
import { useDescriptionEditor } from '../../src/viewer/editing/useDescriptionEditor';
import type { ManifestScreen, ScreenData, ViewerManifest } from '../../src/viewer/types';
import {
  stubDescriptionTreeFetch,
  type MockTreeDoc,
  type MockTreeGroup,
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

function createGroupedDoc(overrides?: Partial<MockTreeDoc>): MockTreeDoc {
  return {
    screen: { id: 'grouped', name: 'Grouped', description: '' },
    itemOrder: ['leaf-item'],
    items: {
      'leaf-item': {
        name: '末端項目',
        type: 'text',
        description: '',
        note: '',
      },
    },
    collectedItemIds: ['leaf-item'],
    rootNodes: [{ type: 'group', id: 'parent-section' }],
    groups: [
      {
        groupId: 'parent-section',
        name: '親グループ',
        kind: 'SECTION',
        description: '親の説明',
        children: [{ type: 'group', id: 'child-card' }],
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

function buildDepth8Groups(): {
  rootNodes: MockTreeDoc['rootNodes'];
  groups: MockTreeGroup[];
} {
  const groups: MockTreeGroup[] = [];
  for (let depth = 1; depth <= 8; depth += 1) {
    const groupId = `g${depth}`;
    const childId = depth < 8 ? `g${depth + 1}` : null;
    groups.push({
      groupId,
      name: `Depth ${depth}`,
      kind: 'SECTION',
      children: childId ? [{ type: 'group', id: childId }] : [],
    });
  }
  return {
    rootNodes: [{ type: 'group', id: 'g1' }],
    groups,
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
  itemOrder: ['leaf-item'],
  items: {
    'leaf-item': {
      name: '末端項目',
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
      grouped: options?.doc ?? createGroupedDoc(),
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

async function mountGroupedPage(options?: {
  editingEnabled?: boolean;
  initialScreenId?: string;
}) {
  const editingEnabled = options?.editingEnabled ?? true;
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
          editingEnabled,
          openCreateScreen: () => {},
        },
      },
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

const EditorHarness = defineComponent({
  setup() {
    const editor = useDescriptionEditor(() => 'grouped');
    return { editor };
  },
  template: '<span />',
});

async function mountEditorHarness() {
  const router = createRouter({
    history: createMemoryHistory('/spec/'),
    routes: [
      { path: '/screens/:screenId', component: EditorHarness },
      { path: '/', redirect: '/screens/grouped' },
    ],
  });
  await router.push('/screens/grouped');
  await router.isReady();
  const root = mount(
    defineComponent({
      setup() {
        return () => h(RouterView);
      },
    }),
    { global: { plugins: [router] } },
  );
  await flushPromises();
  return {
    root,
    harness: root.findComponent(EditorHarness),
  };
}

describe('Item Group 作成 Viewer', () => {
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

  it('root Group 作成: dialog → POST → reload → 選択・成功', async () => {
    const { getFetchMock } = stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();

    const addRoot = wrapper.find('[data-testid="group-add-root-open"]');
    expect(addRoot.exists()).toBe(true);
    await addRoot.trigger('click');
    await flushPromises();

    const dialog = wrapper.findComponent(GroupCreateDialog);
    expect(dialog.exists()).toBe(true);
    expect(dialog.find('#group-create-dialog-title').text()).toBe('グループを追加');
    await dialog.find('[data-field="group-id"]').setValue('new-root-group');
    await dialog.find('[data-field="group-name"]').setValue('新規ルート');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    expect(
      countCalls(
        getFetchMock(),
        (url, method) =>
          method === 'POST' && url.endsWith('/groups') && !url.includes('/groups/'),
      ),
    ).toBe(1);
    expect(wrapper.findComponent(GroupCreateDialog).exists()).toBe(false);
    expect(wrapper.find('[data-testid="group-info-panel"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="group-info-panel"]').text()).toContain(
      '新規ルート',
    );
    expect(wrapper.text()).toContain('グループを追加しました');
  });

  it('child Group 作成: parent 直下 match・ancestor expand', async () => {
    const { getFetchMock } = stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();

    // parent を折りたたみ
    const parentToggle = wrapper
      .findAll('.item-tree__toggle')
      .find((button) => button.attributes('aria-label') === '折りたたむ');
    expect(parentToggle).toBeTruthy();
    await parentToggle!.trigger('click');
    await flushPromises();
    expect(
      wrapper
        .findAll('.item-tree__toggle')
        .some((button) => button.attributes('aria-expanded') === 'false'),
    ).toBe(true);

    const parentSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('親グループ'));
    await parentSelect!.trigger('click');
    await flushPromises();

    await wrapper.find('[data-testid="group-add-child-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupCreateDialog);
    expect(dialog.find('#group-create-dialog-title').text()).toBe('子グループを追加');
    await dialog.find('[data-field="group-id"]').setValue('new-child-group');
    await dialog.find('[data-field="group-name"]').setValue('新規子');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    const postBodies = getFetchMock().mock.calls
      .filter(
        ([url, init]) =>
          String(url).endsWith('/groups') &&
          ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase() ===
            'POST',
      )
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]).toMatchObject({
      groupId: 'new-child-group',
      parentGroupId: 'parent-section',
    });

    expect(wrapper.find('[data-testid="group-info-panel"]').text()).toContain(
      '新規子',
    );
    // parent は再展開される
    expect(
      wrapper
        .findAll('.item-tree__toggle')
        .some((button) => button.attributes('aria-expanded') === 'true'),
    ).toBe(true);
  });

  it('depth 8 では子追加 disabled・handler でも HTTP 0', async () => {
    const depth = buildDepth8Groups();
    const { getFetchMock } = stubGroupedPageFetch({
      doc: createGroupedDoc({
        rootNodes: depth.rootNodes,
        groups: depth.groups,
        itemOrder: [],
        items: {},
        collectedItemIds: [],
      }),
    });
    const { wrapper } = await mountGroupedPage();

    // expand chain and select g8
    for (let depthIndex = 1; depthIndex <= 8; depthIndex += 1) {
      const select = wrapper
        .findAll('.item-tree__select')
        .find((button) => button.text().includes(`Depth ${depthIndex}`));
      if (!select) {
        const toggle = wrapper
          .findAll('.item-tree__toggle')
          .find((button) => button.attributes('aria-expanded') === 'false');
        if (toggle) {
          await toggle.trigger('click');
          await flushPromises();
        }
      }
      const again = wrapper
        .findAll('.item-tree__select')
        .find((button) => button.text().includes(`Depth ${depthIndex}`));
      if (again && depthIndex === 8) {
        await again.trigger('click');
        await flushPromises();
      } else if (again && depthIndex < 8) {
        const rowToggle = again
          .element.closest('.item-tree__row')
          ?.querySelector('.item-tree__toggle') as HTMLButtonElement | null;
        if (rowToggle && rowToggle.getAttribute('aria-expanded') === 'false') {
          rowToggle.click();
          await flushPromises();
        }
      }
    }

    const g8 = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('Depth 8'));
    expect(g8).toBeTruthy();
    await g8!.trigger('click');
    await flushPromises();

    const addChild = wrapper.find('[data-testid="group-add-child-open"]');
    expect(addChild.exists()).toBe(true);
    expect(addChild.attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="group-depth-limit-note"]').exists()).toBe(
      true,
    );
    await addChild.trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(GroupCreateDialog).exists()).toBe(false);
    expect(
      countCalls(
        getFetchMock(),
        (url, method) => method === 'POST' && url.includes('/groups'),
      ),
    ).toBe(0);
  });

  it('client duplicate ID は dialog 維持・HTTP 0', async () => {
    const { getFetchMock } = stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    await wrapper.find('[data-testid="group-add-root-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupCreateDialog);
    await dialog.find('[data-field="group-id"]').setValue('parent-section');
    await dialog.find('[data-field="group-name"]').setValue('重複');
    const postsBefore = countCalls(
      getFetchMock(),
      (url, method) => method === 'POST' && url.includes('/groups'),
    );
    await dialog.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.findComponent(GroupCreateDialog).exists()).toBe(true);
    expect(dialog.find('[data-error="groupId"]').text()).toContain(
      '既に使用されています',
    );
    expect(
      countCalls(
        getFetchMock(),
        (url, method) => method === 'POST' && url.includes('/groups'),
      ),
    ).toBe(postsBefore);
  });

  it('server 409 では dialog/draft 維持・Item recovery なし', async () => {
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.endsWith('/groups') && method === 'POST') {
          return jsonResponse(
            {
              code: 'SPEC_DESCRIPTION_GROUP_ALREADY_EXISTS',
              message: 'exists',
            },
            409,
          );
        }
        return null;
      },
    });
    const { wrapper } = await mountGroupedPage();
    await wrapper.find('[data-testid="group-add-root-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupCreateDialog);
    await dialog.find('[data-field="group-id"]').setValue('brand-new');
    await dialog.find('[data-field="group-name"]').setValue('名前');
    await dialog.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.findComponent(GroupCreateDialog).exists()).toBe(true);
    expect(
      (dialog.find('[data-field="group-id"]').element as HTMLInputElement).value,
    ).toBe('brand-new');
    expect(wrapper.find('[data-testid="group-create-error"]').text()).toContain(
      '既に使用されています',
    );
    expect(
      wrapper
        .findAll('button')
        .some((button) => button.text().includes('衝突した項目')),
    ).toBe(false);
  });

  it('authoritative metadata mismatch は success 禁止', async () => {
    const { state, getFetchMock } = stubGroupedPageFetch({
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        const res = await baseFetch(input, init);
        if (method === 'POST' && url.endsWith('/groups')) {
          const entry = state.get('grouped');
          if (entry) {
            const created = entry.doc.groups?.find(
              (group) => group.groupId === 'mismatch-meta',
            );
            if (created) {
              created.name = '別の名前';
            }
          }
        }
        return res;
      },
    });
    const { wrapper } = await mountGroupedPage();
    await wrapper.find('[data-testid="group-add-root-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupCreateDialog);
    await dialog.find('[data-field="group-id"]').setValue('mismatch-meta');
    await dialog.find('[data-field="group-name"]').setValue('期待名');
    await dialog.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).not.toContain('グループを追加しました');
    expect(wrapper.text()).toContain('追加後に別の変更が反映されました');
    expect(
      countCalls(
        getFetchMock(),
        (url, method) => method === 'POST' && url.endsWith('/groups'),
      ),
    ).toBe(1);
  });

  it('parent mismatch を検出する', async () => {
    const { state } = stubGroupedPageFetch({
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        const res = await baseFetch(input, init);
        if (method === 'POST' && url.endsWith('/groups')) {
          const entry = state.get('grouped');
          if (entry?.doc.groups && entry.doc.rootNodes) {
            const parent = entry.doc.groups.find(
              (group) => group.groupId === 'parent-section',
            );
            if (parent) {
              parent.children = parent.children.filter(
                (child) => child.id !== 'wrong-parent',
              );
            }
            entry.doc.rootNodes.push({ type: 'group', id: 'wrong-parent' });
          }
        }
        return res;
      },
    });
    const { wrapper } = await mountGroupedPage();
    const parentSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('親グループ'));
    await parentSelect!.trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="group-add-child-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupCreateDialog);
    await dialog.find('[data-field="group-id"]').setValue('wrong-parent');
    await dialog.find('[data-field="group-name"]').setValue('子のつもり');
    await dialog.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).not.toContain('グループを追加しました');
    expect(wrapper.text()).toContain('配置が想定と異なります');
  });

  it('active absent は success 禁止・reloadRequired', async () => {
    const { state } = stubGroupedPageFetch({
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        const res = await baseFetch(input, init);
        if (method === 'POST' && url.endsWith('/groups')) {
          const entry = state.get('grouped');
          if (entry?.doc.rootNodes) {
            entry.doc.rootNodes = entry.doc.rootNodes.filter(
              (node) => node.id !== 'ghost-group',
            );
          }
        }
        return res;
      },
    });
    const { wrapper } = await mountGroupedPage();
    await wrapper.find('[data-testid="group-add-root-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupCreateDialog);
    await dialog.find('[data-field="group-id"]').setValue('ghost-group');
    await dialog.find('[data-field="group-name"]').setValue('幽霊');
    await dialog.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).not.toContain('グループを追加しました');
    expect(wrapper.text()).toContain('追加結果を確認できませんでした');
  });

  it('reload failure → reloadRequired', async () => {
    let postDone = false;
    stubGroupedPageFetch({
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && url.endsWith('/groups')) {
          const res = await baseFetch(input, init);
          postDone = true;
          return res;
        }
        if (postDone && method === 'GET' && url.includes('/description-tree/')) {
          return new Response('fail', { status: 500 });
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper } = await mountGroupedPage();
    await wrapper.find('[data-testid="group-add-root-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupCreateDialog);
    await dialog.find('[data-field="group-id"]').setValue('reload-fail-g');
    await dialog.find('[data-field="group-name"]').setValue('名前');
    await dialog.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('再読み込みできませんでした');
  });

  it('commit unknown は blind retry 禁止', async () => {
    const { getFetchMock } = stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.endsWith('/groups') && method === 'POST') {
          return new Response('{', {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return null;
      },
    });
    const { wrapper } = await mountGroupedPage();
    await wrapper.find('[data-testid="group-add-root-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupCreateDialog);
    await dialog.find('[data-field="group-id"]').setValue('ambiguous-g');
    await dialog.find('[data-field="group-name"]').setValue('名前');
    await dialog.find('form').trigger('submit');
    await flushPromises();
    expect(
      countCalls(
        getFetchMock(),
        (url, method) => method === 'POST' && url.endsWith('/groups'),
      ),
    ).toBe(1);
    expect(wrapper.text()).not.toContain('グループを追加しました');
  });

  it('Screen A create pending → B へ移動 → A late completion は B 不変', async () => {
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
          url.endsWith('/groups')
        ) {
          return postHold;
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper, router } = await mountGroupedPage();
    await wrapper.find('[data-testid="group-add-root-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupCreateDialog);
    await dialog.find('[data-field="group-id"]').setValue('late-a');
    await dialog.find('[data-field="group-name"]').setValue('遅延');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    await router.push('/screens/screen-b');
    await flushPromises();
    const bTextBefore = wrapper.text();

    releasePost(
      jsonResponse({ status: 'updated', revision: 'sha256:00000000000000000000000000000000000000000000000000000000000000e2' }, 201),
    );
    await flushPromises();
    await nextTick();

    expect(wrapper.text()).toBe(bTextBefore);
    expect(wrapper.text()).not.toContain('グループを追加しました');
  });

  it('close/reopen race: 旧 generation 完了は新 draft を汚染しない', async () => {
    let postSeen = false;
    let holdReload = false;
    let releaseReload!: () => void;
    const reloadHold = new Promise<void>((resolve) => {
      releaseReload = resolve;
    });
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.endsWith('/groups') && method === 'POST') {
          postSeen = true;
          holdReload = true;
          return jsonResponse({ status: 'updated', revision: 'sha256:00000000000000000000000000000000000000000000000000000000000000e1' }, 201);
        }
        return null;
      },
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (
          holdReload &&
          method === 'GET' &&
          url.includes('/description-tree/grouped')
        ) {
          holdReload = false;
          await reloadHold;
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper, router } = await mountGroupedPage();
    await wrapper.find('[data-testid="group-add-root-open"]').trigger('click');
    await flushPromises();
    const dialog1 = wrapper.findComponent(GroupCreateDialog);
    await dialog1.find('[data-field="group-id"]').setValue('gen-one');
    await dialog1.find('[data-field="group-name"]').setValue('一代');
    void dialog1.find('form').trigger('submit');
    await vi.waitFor(() => expect(postSeen).toBe(true));

    await router.push('/screens/screen-b');
    await flushPromises();
    await router.push('/screens/grouped');
    await flushPromises();
    await wrapper.find('[data-testid="group-add-root-open"]').trigger('click');
    await flushPromises();
    const dialog2 = wrapper.findComponent(GroupCreateDialog);
    await dialog2.find('[data-field="group-id"]').setValue('gen-two');
    await dialog2.find('[data-field="group-name"]').setValue('二代');
    expect(
      (dialog2.find('[data-field="group-id"]').element as HTMLInputElement).value,
    ).toBe('gen-two');

    releaseReload();
    await flushPromises();
    expect(wrapper.findComponent(GroupCreateDialog).exists()).toBe(true);
    expect(
      (wrapper.find('[data-field="group-id"]').element as HTMLInputElement).value,
    ).toBe('gen-two');
    expect(wrapper.text()).not.toContain('グループを追加しました');
  });

  it('expanded empty でも child create 成功時は parent chain のみ追加', async () => {
    stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    const parentSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('親グループ'));
    expect(parentSelect).toBeTruthy();
    await parentSelect!.trigger('click');
    await flushPromises();
    for (const toggle of wrapper.findAll('.item-tree__toggle')) {
      if (toggle.attributes('aria-expanded') === 'true') {
        await toggle.trigger('click');
        await flushPromises();
      }
    }
    await wrapper.find('[data-testid="group-add-child-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupCreateDialog);
    await dialog.find('[data-field="group-id"]').setValue('expand-child');
    await dialog.find('[data-field="group-name"]').setValue('展開確認');
    await dialog.find('form').trigger('submit');
    await flushPromises();
    const expandedToggles = wrapper
      .findAll('.item-tree__toggle')
      .filter((button) => button.attributes('aria-expanded') === 'true');
    expect(expandedToggles.length).toBeGreaterThanOrEqual(1);
  });

  it('unresolved Item conflict では create HTTP 0・conflict 不変', async () => {
    const { getFetchMock } = stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/items/leaf-item') && method === 'PATCH') {
          return jsonResponse(
            {
              code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
              message: '衝突',
              expectedRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
              currentRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000009',
            },
            409,
          );
        }
        return null;
      },
    });
    const { harness, root } = await mountEditorHarness();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('grouped');
    await flushPromises();
    editor.beginItemEdit('leaf-item');
    editor.updateItemField('leaf-item', 'name', '変更');
    await editor.saveItemMetadata('leaf-item');
    await flushPromises();
    expect(editor.unresolvedItemConflict.value).toBe(true);
    expect(editor.captureConflictItemRecoveryTarget()?.itemId).toBe('leaf-item');

    const postsBefore = countCalls(
      getFetchMock(),
      (url, method) => method === 'POST' && url.includes('/groups'),
    );
    const outcome = await editor.createGroup({
      groupId: 'blocked-g',
      expectedRevision: editor.revision.value!,
      name: '遮断',
      kind: 'SECTION',
      description: null,
      parentGroupId: null,
    });
    expect(outcome.status).toBe('mutation-rejected');
    expect(
      countCalls(
        getFetchMock(),
        (url, method) => method === 'POST' && url.includes('/groups'),
      ),
    ).toBe(postsBefore);
    expect(editor.unresolvedItemConflict.value).toBe(true);
    expect(editor.captureConflictItemRecoveryTarget()?.itemId).toBe('leaf-item');
    root.unmount();
  });

  it('depth 8 parent では createGroup が HTTP 0', async () => {
    const depth = buildDepth8Groups();
    const { getFetchMock } = stubGroupedPageFetch({
      doc: createGroupedDoc({
        rootNodes: depth.rootNodes,
        groups: depth.groups,
        itemOrder: [],
        items: {},
        collectedItemIds: [],
      }),
    });
    const { harness, root } = await mountEditorHarness();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('grouped');
    await flushPromises();
    const postsBefore = countCalls(
      getFetchMock(),
      (url, method) => method === 'POST' && url.includes('/groups'),
    );
    const outcome = await editor.createGroup({
      groupId: 'too-deep',
      expectedRevision: editor.revision.value!,
      name: '深すぎ',
      kind: 'SECTION',
      description: null,
      parentGroupId: 'g8',
    });
    expect(outcome.status).toBe('mutation-rejected');
    expect(
      countCalls(
        getFetchMock(),
        (url, method) => method === 'POST' && url.includes('/groups'),
      ),
    ).toBe(postsBefore);
    root.unmount();
  });

  it('read-only では create action/dialog なし', async () => {
    delete window.__JSKIM_SPEC_EDIT__;
    stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage({ editingEnabled: false });
    expect(wrapper.find('[data-testid="group-add-root-open"]').exists()).toBe(
      false,
    );
    const parentSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('親グループ'));
    await parentSelect!.trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(GroupInfoPanel).exists()).toBe(true);
    expect(wrapper.find('[data-testid="group-add-child-open"]').exists()).toBe(
      false,
    );
    expect(wrapper.findComponent(GroupCreateDialog).exists()).toBe(false);
  });
});
