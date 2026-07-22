import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import ScreenSpecPage from '../../src/viewer/pages/ScreenSpecPage.vue';
import GroupUngroupDialog from '../../src/viewer/components/GroupUngroupDialog.vue';
import GroupInfoPanel from '../../src/viewer/components/GroupInfoPanel.vue';
import { useDescriptionEditor } from '../../src/viewer/editing/useDescriptionEditor';
import type { ManifestScreen, ScreenData, ViewerManifest } from '../../src/viewer/types';
import {
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

function createGroupedDoc(overrides?: Partial<MockTreeDoc>): MockTreeDoc {
  return {
    screen: { id: 'grouped', name: 'Grouped', description: '' },
    itemOrder: ['leaf-item', 'root-item'],
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
    },
    collectedItemIds: ['leaf-item'],
    rootNodes: [
      { type: 'group', id: 'parent-section' },
      { type: 'item', id: 'root-item' },
    ],
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
  itemOrder: ['leaf-item', 'root-item'],
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

describe('Item Group 解除 Viewer', () => {
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

  it('child Group 解除: parent 選択・子昇格・delete-subtree 非呼出', async () => {
    const { getFetchMock } = stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-ungroup-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupUngroupDialog);
    expect(dialog.exists()).toBe(true);
    expect(dialog.find('[data-testid="group-ungroup-promote-to"]').text()).toContain(
      '親グループ',
    );
    await dialog.find('[data-testid="group-ungroup-confirm"]').trigger('click');
    await flushPromises();

    expect(
      countCalls(
        getFetchMock(),
        (url, method) =>
          method === 'POST' && url.includes('/groups/child-card/delete'),
      ),
    ).toBe(1);
    expect(
      countCalls(
        getFetchMock(),
        (url) => url.includes('delete-subtree'),
      ),
    ).toBe(0);
    expect(wrapper.findComponent(GroupUngroupDialog).exists()).toBe(false);
    expect(wrapper.find('[data-testid="group-info-panel"]').text()).toContain(
      '親グループ',
    );
    expect(wrapper.text()).toContain('グループを解除しました');
    expect(wrapper.text()).toContain('末端項目');
  });

  it('root Group 解除: 最初の昇格 child を選択', async () => {
    stubGroupedPageFetch({
      doc: createGroupedDoc({
        rootNodes: [
          { type: 'item', id: 'root-item' },
          { type: 'group', id: 'parent-section' },
        ],
        groups: [
          {
            groupId: 'parent-section',
            name: '親グループ',
            kind: 'SECTION',
            children: [
              { type: 'group', id: 'child-card' },
              { type: 'item', id: 'leaf-item' },
            ],
          },
          {
            groupId: 'child-card',
            name: '子カード',
            kind: 'CARD',
            children: [],
          },
        ],
      }),
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '親グループ');
    await wrapper.find('[data-testid="group-ungroup-open"]').trigger('click');
    await flushPromises();
    await wrapper
      .findComponent(GroupUngroupDialog)
      .find('[data-testid="group-ungroup-confirm"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="group-info-panel"]').text()).toContain(
      '子カード',
    );
  });

  it('empty root Group 解除後は selection clear', async () => {
    stubGroupedPageFetch({
      doc: createGroupedDoc({
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
    await wrapper.find('[data-testid="group-ungroup-open"]').trigger('click');
    await flushPromises();
    await wrapper
      .findComponent(GroupUngroupDialog)
      .find('[data-testid="group-ungroup-confirm"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="group-info-panel"]').exists()).toBe(false);
    expect(wrapper.find('.item-tree__row.is-selected').exists()).toBe(false);
  });

  it('server 409 では dialog 維持・Item recovery なし', async () => {
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/') && url.endsWith('/delete') && method === 'POST') {
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
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-ungroup-open"]').trigger('click');
    await flushPromises();
    await wrapper
      .findComponent(GroupUngroupDialog)
      .find('[data-testid="group-ungroup-confirm"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(GroupUngroupDialog).exists()).toBe(true);
    expect(wrapper.find('[data-testid="group-ungroup-error"]').text().length).toBeGreaterThan(
      0,
    );
    expect(
      wrapper
        .findAll('button')
        .some((button) => button.text().includes('衝突した項目')),
    ).toBe(false);
  });

  it('invalid mutation revision → success 禁止・reloadRequired・後続 mutation 0', async () => {
    const { getFetchMock } = stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card/delete') && method === 'POST') {
          return jsonResponse({
            status: 'updated',
            revision: 'same-invalid-revision',
          });
        }
        return null;
      },
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-ungroup-open"]').trigger('click');
    await flushPromises();
    await wrapper
      .findComponent(GroupUngroupDialog)
      .find('[data-testid="group-ungroup-confirm"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).not.toContain('グループを解除しました');
    expect(wrapper.find('[data-testid="group-add-root-open"]').attributes('disabled')).toBeDefined();
    const postsBefore = countCalls(
      getFetchMock(),
      (url, method) => method === 'POST',
    );
    await wrapper.find('[data-testid="group-add-root-open"]').trigger('click');
    await flushPromises();
    expect(
      countCalls(getFetchMock(), (url, method) => method === 'POST'),
    ).toBe(postsBefore);
  });

  it('invalid Tree GET revision → refresh failure・success 禁止・reloadRequired', async () => {
    let postDone = false;
    const { getFetchMock } = stubGroupedPageFetch({
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && url.includes('/delete')) {
          const res = await baseFetch(input, init);
          postDone = true;
          return res;
        }
        if (postDone && method === 'GET' && url.includes('/description-tree/')) {
          const res = await baseFetch(input, init);
          const body = (await res.json()) as Record<string, unknown>;
          body.revision = 'same-invalid-revision';
          return jsonResponse(body);
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-ungroup-open"]').trigger('click');
    await flushPromises();
    await wrapper
      .findComponent(GroupUngroupDialog)
      .find('[data-testid="group-ungroup-confirm"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).not.toContain('グループを解除しました');
    expect(wrapper.text()).toMatch(/再読み込み/);
    expect(wrapper.find('[data-testid="group-add-root-open"]').attributes('disabled')).toBeDefined();
    expect(
      countCalls(
        getFetchMock(),
        (url, method) =>
          method === 'POST' && url.includes('/groups/child-card/delete'),
      ),
    ).toBe(1);
  });

  it('同一 invalid revision + exact structure でも match-exact success 禁止', async () => {
    const SAME_INVALID = 'same-invalid-revision';
    let postDone = false;
    stubGroupedPageFetch({
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && url.includes('/groups/child-card/delete')) {
          postDone = true;
          return jsonResponse({ status: 'updated', revision: SAME_INVALID });
        }
        if (postDone && method === 'GET' && url.includes('/description-tree/')) {
          const res = await baseFetch(input, init);
          const body = (await res.json()) as {
            revision: string;
            description: {
              rootNodes: unknown[];
              groups: Array<{
                groupId: string;
                name: string;
                kind: string;
                description?: string;
                children: unknown[];
              }>;
            };
          };
          // mock は POST を処理していないので、exact-looking へ手で昇格
          body.revision = SAME_INVALID;
          body.description.groups = body.description.groups
            .filter((group) => group.groupId !== 'child-card')
            .map((group) =>
              group.groupId === 'parent-section'
                ? {
                    ...group,
                    children: [{ type: 'item', id: 'leaf-item' }],
                  }
                : group,
            );
          return jsonResponse(body);
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-ungroup-open"]').trigger('click');
    await flushPromises();
    await wrapper
      .findComponent(GroupUngroupDialog)
      .find('[data-testid="group-ungroup-confirm"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).not.toContain('グループを解除しました');
    expect(wrapper.find('[data-testid="group-add-root-open"]').attributes('disabled')).toBeDefined();
  });

  it('authoritative mismatch（target still present）は success 禁止・reloadRequired', async () => {
    const { getFetchMock } = stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card/delete') && method === 'POST') {
          // success を返すだけで state は変えない
          return jsonResponse({ status: 'updated', revision: 'sha256:00000000000000000000000000000000000000000000000000000000000000f1' });
        }
        return null;
      },
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-ungroup-open"]').trigger('click');
    await flushPromises();
    await wrapper
      .findComponent(GroupUngroupDialog)
      .find('[data-testid="group-ungroup-confirm"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).not.toContain('グループを解除しました');
    expect(wrapper.text()).toMatch(
      /想定と一致しませんでした|別の更新が確認されました/,
    );
    const addRoot = wrapper.find('[data-testid="group-add-root-open"]');
    expect(addRoot.attributes('disabled')).toBeDefined();
    const postsBefore = countCalls(
      getFetchMock(),
      (url, method) =>
        method === 'POST' &&
        (url.includes('/groups') || url.includes('/items')),
    );
    await addRoot.trigger('click');
    await flushPromises();
    expect(
      countCalls(
        getFetchMock(),
        (url, method) =>
          method === 'POST' &&
          (url.includes('/groups') || url.includes('/items')),
      ),
    ).toBe(postsBefore);
  });

  it('server 404 では dialog 維持・reloadRequired を強制しない', async () => {
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/') && url.endsWith('/delete') && method === 'POST') {
          return jsonResponse(
            { code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND', message: 'なし' },
            404,
          );
        }
        return null;
      },
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-ungroup-open"]').trigger('click');
    await flushPromises();
    await wrapper
      .findComponent(GroupUngroupDialog)
      .find('[data-testid="group-ungroup-confirm"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(GroupUngroupDialog).exists()).toBe(true);
    expect(wrapper.find('[data-testid="group-add-root-open"]').attributes('disabled')).toBeUndefined();
  });

  it('double submit は POST 1 回', async () => {
    let releasePost!: (value: Response) => void;
    const postHold = new Promise<Response>((resolve) => {
      releasePost = resolve;
    });
    const { getFetchMock } = stubGroupedPageFetch({
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && url.includes('/delete')) {
          return postHold;
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-ungroup-open"]').trigger('click');
    await flushPromises();
    const confirm = wrapper
      .findComponent(GroupUngroupDialog)
      .find('[data-testid="group-ungroup-confirm"]');
    await confirm.trigger('click');
    await confirm.trigger('click');
    await flushPromises();
    releasePost(jsonResponse({ status: 'updated', revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000002' }));
    await flushPromises();
    expect(
      countCalls(
        getFetchMock(),
        (url, method) =>
          method === 'POST' && url.includes('/groups/child-card/delete'),
      ),
    ).toBe(1);
  });

  it('submit 前 sibling/metadata 変化は POST 0', async () => {
    const { getFetchMock } = stubGroupedPageFetch({
      doc: createGroupedDoc({
        itemOrder: ['leaf-item', 'root-item', 'tail-item'],
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
          'tail-item': {
            name: '後続項目',
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
            children: [
              { type: 'item', id: 'root-item' },
              { type: 'group', id: 'child-card' },
              { type: 'item', id: 'tail-item' },
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
      }),
    });
    const { harness, root } = await mountEditorHarness();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('grouped');
    await flushPromises();
    const { captureActiveGroupUngroupContext } = await import(
      '../../src/viewer/editing/group-ungroup-helpers'
    );
    const capture = captureActiveGroupUngroupContext(
      editor.snapshot.value!,
      'child-card',
    )!;
    expect(capture.siblingOrder.length).toBeGreaterThan(1);
    const cases: Array<{ label: string; capture: typeof capture }> = [
      {
        label: '後 sibling 欠落',
        capture: {
          ...capture,
          siblingOrder: capture.siblingOrder.slice(0, -1),
        },
      },
      {
        label: 'sibling reorder',
        capture: {
          ...capture,
          siblingOrder: [...capture.siblingOrder].reverse(),
          targetIndex: capture.siblingOrder.length - 1 - capture.targetIndex,
        },
      },
      {
        label: 'child 変更',
        capture: {
          ...capture,
          directChildren: [],
        },
      },
      {
        label: 'metadata 変更',
        capture: { ...capture, name: '改名カード' },
      },
      {
        label: 'parent 変更',
        capture: { ...capture, parentGroupId: null },
      },
    ];
    for (const entry of cases) {
      const postsBefore = countCalls(
        getFetchMock(),
        (url, method) => method === 'POST' && url.includes('/delete'),
      );
      const outcome = await editor.ungroupGroup({
        expectedRevision: editor.revision.value!,
        capture: entry.capture,
      });
      expect(outcome.status, entry.label).toBe('mutation-rejected');
      expect(
        countCalls(
          getFetchMock(),
          (url, method) => method === 'POST' && url.includes('/delete'),
        ),
        entry.label,
      ).toBe(postsBefore);
    }
    root.unmount();
  });

  it('commit-unknown + mismatch → reloadRequired・blind retry なし', async () => {
    const { getFetchMock } = stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card/delete') && method === 'POST') {
          return new Response('gateway', { status: 502 });
        }
        return null;
      },
    });
    const { wrapper } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-ungroup-open"]').trigger('click');
    await flushPromises();
    await wrapper
      .findComponent(GroupUngroupDialog)
      .find('[data-testid="group-ungroup-confirm"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).not.toContain('グループを解除しました');
    expect(wrapper.find('[data-testid="group-add-root-open"]').attributes('disabled')).toBeDefined();
    const deletePosts = countCalls(
      getFetchMock(),
      (url, method) =>
        method === 'POST' && url.includes('/groups/child-card/delete'),
    );
    expect(deletePosts).toBe(1);
    await wrapper.find('[data-testid="group-ungroup-open"]').trigger('click').catch(() => undefined);
    await flushPromises();
    expect(
      countCalls(
        getFetchMock(),
        (url, method) =>
          method === 'POST' && url.includes('/groups/child-card/delete'),
      ),
    ).toBe(1);
  });

  it('reload failure → reloadRequired', async () => {
    let postDone = false;
    stubGroupedPageFetch({
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && url.includes('/delete')) {
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
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-ungroup-open"]').trigger('click');
    await flushPromises();
    await wrapper
      .findComponent(GroupUngroupDialog)
      .find('[data-testid="group-ungroup-confirm"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('再読み込みできませんでした');
  });

  it('Screen A→B late completion は B 不変', async () => {
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
          url.includes('/delete')
        ) {
          return postHold;
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper, router } = await mountGroupedPage();
    await selectGroupByLabel(wrapper, '子カード');
    await wrapper.find('[data-testid="group-ungroup-open"]').trigger('click');
    await flushPromises();
    await wrapper
      .findComponent(GroupUngroupDialog)
      .find('[data-testid="group-ungroup-confirm"]')
      .trigger('click');
    await flushPromises();
    await router.push('/screens/screen-b');
    await flushPromises();
    const before = wrapper.text();
    releasePost(jsonResponse({ status: 'updated', revision: 'sha256:00000000000000000000000000000000000000000000000000000000000000e2' }));
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toBe(before);
    expect(wrapper.text()).not.toContain('グループを解除しました');
  });

  it('unresolved Item conflict では ungroup HTTP 0', async () => {
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
    const postsBefore = countCalls(
      getFetchMock(),
      (url, method) => method === 'POST' && url.includes('/delete'),
    );
    const outcome = await editor.ungroupGroup({
      expectedRevision: editor.revision.value!,
      capture: {
        groupId: 'child-card',
        name: '子カード',
        kind: 'CARD',
        description: '子の説明',
        parentGroupId: 'parent-section',
        parentName: '親グループ',
        depth: 2,
        targetIndex: 0,
        directChildren: [{ type: 'item', id: 'leaf-item' }],
        siblingOrder: [
          { type: 'group', id: 'child-card' },
        ],
        itemSnapshots: {
          'leaf-item': {
            name: '末端項目',
            type: 'text',
            description: '',
            note: '',
          },
        },
        groupSnapshots: {},
      },
    });
    expect(outcome.status).toBe('mutation-rejected');
    expect(
      countCalls(
        getFetchMock(),
        (url, method) => method === 'POST' && url.includes('/delete'),
      ),
    ).toBe(postsBefore);
    root.unmount();
  });

  it('read-only では ungroup action なし', async () => {
    delete window.__JSKIM_SPEC_EDIT__;
    stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage({ editingEnabled: false });
    await selectGroupByLabel(wrapper, '子カード');
    expect(wrapper.findComponent(GroupInfoPanel).exists()).toBe(true);
    expect(wrapper.find('[data-testid="group-ungroup-open"]').exists()).toBe(
      false,
    );
    expect(wrapper.findComponent(GroupUngroupDialog).exists()).toBe(false);
  });

  it('expanded: target のみ除去し unrelated を維持', async () => {
    stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    // parent 展開維持、child を選択して解除
    await selectGroupByLabel(wrapper, '子カード');
    const beforeExpanded = wrapper
      .findAll('.item-tree__toggle')
      .filter((button) => button.attributes('aria-expanded') === 'true').length;
    await wrapper.find('[data-testid="group-ungroup-open"]').trigger('click');
    await flushPromises();
    await wrapper
      .findComponent(GroupUngroupDialog)
      .find('[data-testid="group-ungroup-confirm"]')
      .trigger('click');
    await flushPromises();
    const afterExpanded = wrapper
      .findAll('.item-tree__toggle')
      .filter((button) => button.attributes('aria-expanded') === 'true').length;
    expect(afterExpanded).toBeLessThanOrEqual(beforeExpanded);
    expect(wrapper.text()).toContain('グループを解除しました');
  });
});
