import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import ScreenSpecPage from '../../src/viewer/pages/ScreenSpecPage.vue';
import GroupEditDialog from '../../src/viewer/components/GroupEditDialog.vue';
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
      grouped: createGroupedDoc(),
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
    predicate(String(url), ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase()),
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

describe('Item Group metadata 編集', () => {
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

  it('editingEnabled 時のみ編集ボタンが表示され dialog が初期化される', async () => {
    stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();

    const childSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('子カード'));
    expect(childSelect).toBeTruthy();
    await childSelect!.trigger('click');
    await flushPromises();

    expect(wrapper.findComponent(GroupInfoPanel).exists()).toBe(true);
    const editButton = wrapper.find('[data-testid="group-edit-open"]');
    expect(editButton.exists()).toBe(true);
    await editButton.trigger('click');
    await flushPromises();

    const dialog = wrapper.findComponent(GroupEditDialog);
    expect(dialog.exists()).toBe(true);
    expect(dialog.find('[data-field="group-id"]').text()).toBe('child-card');
    expect(
      (dialog.find('[data-field="group-name"]').element as HTMLInputElement).value,
    ).toBe('子カード');
  });

  it('editingEnabled=false では編集ボタンをレンダリングしない', async () => {
    delete window.__JSKIM_SPEC_EDIT__;
    stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage({ editingEnabled: false });

    const childSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('子カード'));
    await childSelect!.trigger('click');
    await flushPromises();

    expect(wrapper.findComponent(GroupInfoPanel).exists()).toBe(true);
    expect(wrapper.find('[data-testid="group-edit-open"]').exists()).toBe(false);
    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(false);
  });

  it('成功時: metadata 更新・選択/expanded 維持・dialog close・resource 非呼出', async () => {
    const { getFetchMock } = stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();

    const parentToggle = wrapper
      .findAll('.item-tree__toggle')
      .find((button) => button.attributes('aria-label') === '折りたたむ');
    expect(parentToggle).toBeTruthy();

    const childSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('子カード'));
    await childSelect!.trigger('click');
    await flushPromises();

    const screenFetchesBefore = countCalls(
      getFetchMock(),
      (url, method) => method === 'GET' && url.includes('/data/screens/'),
    );
    const snapshotFetchesBefore = countCalls(
      getFetchMock(),
      (url, method) => method === 'GET' && url.includes('/data/snapshots/'),
    );
    const styleFetchesBefore = countCalls(
      getFetchMock(),
      (url, method) => method === 'GET' && url.includes('/data/theme/'),
    );

    await wrapper.find('[data-testid="group-edit-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupEditDialog);
    await dialog.find('[data-field="group-name"]').setValue('改名カード');
    await dialog.find('[data-field="group-kind"]').setValue('CONTENT');
    await dialog.find('[data-field="group-description"]').setValue('新しい説明');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(false);
    expect(wrapper.findComponent(GroupInfoPanel).text()).toContain('改名カード');
    expect(wrapper.findComponent(GroupInfoPanel).text()).toContain('コンテンツ');
    expect(wrapper.findComponent(GroupInfoPanel).text()).toContain('新しい説明');
    expect(
      wrapper.find('.item-tree__row.is-selected .item-tree__label').text(),
    ).toContain('改名カード');
    expect(
      wrapper
        .findAll('.item-tree__toggle')
        .some((button) => button.attributes('aria-expanded') === 'true'),
    ).toBe(true);

    const patchCalls = getFetchMock().mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/groups/child-card') &&
        ((init as RequestInit | undefined)?.method ?? '').toUpperCase() === 'PATCH',
    );
    expect(patchCalls).toHaveLength(1);
    const putCalls = getFetchMock().mock.calls.filter(
      ([, init]) =>
        ((init as RequestInit | undefined)?.method ?? '').toUpperCase() === 'PUT',
    );
    expect(putCalls).toHaveLength(0);

    expect(
      countCalls(
        getFetchMock(),
        (url, method) => method === 'GET' && url.includes('/data/screens/'),
      ),
    ).toBe(screenFetchesBefore);
    expect(
      countCalls(
        getFetchMock(),
        (url, method) => method === 'GET' && url.includes('/data/snapshots/'),
      ),
    ).toBe(snapshotFetchesBefore);
    expect(
      countCalls(
        getFetchMock(),
        (url, method) => method === 'GET' && url.includes('/data/theme/'),
      ),
    ).toBe(styleFetchesBefore);
  });

  it('未変更 draft では PATCH 0 回', async () => {
    const { getFetchMock } = stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    const childSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('子カード'));
    await childSelect!.trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="group-edit-open"]').trigger('click');
    await flushPromises();
    await wrapper.findComponent(GroupEditDialog).find('form').trigger('submit');
    await flushPromises();
    expect(
      countCalls(
        getFetchMock(),
        (url, method) => method === 'PATCH' && url.includes('/groups/'),
      ),
    ).toBe(0);
  });

  it('409 では dialog/draft 維持、reloadRequired=false', async () => {
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
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
    const childSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('子カード'));
    await childSelect!.trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="group-edit-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupEditDialog);
    await dialog.find('[data-field="group-name"]').setValue('衝突名');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(true);
    expect(
      (wrapper.find('[data-field="group-name"]').element as HTMLInputElement).value,
    ).toBe('衝突名');
    expect(wrapper.text()).toContain('他の操作によって画面設計書が更新されました');
    expect(wrapper.find('.spec-page__banner[data-status="reload-failed"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-testid="group-edit-save"]').attributes('disabled'),
    ).toBeUndefined();
    // Group 409 は Item conflict recovery action を出さない（no-op ボタン禁止）
    expect(wrapper.find('[data-action="recover-item-conflict"]').exists()).toBe(false);
    expect(wrapper.find('[data-action="recover-reload-failed"]').exists()).toBe(false);
  });

  it('Group 409 後も Item draft を Item conflict と誤認しない', async () => {
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          return jsonResponse(
            {
              code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
              message: '衝突',
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
    editor.updateItemField('leaf-item', 'name', 'Item草案');
    expect(editor.itemDirty.value).toBe(true);

    const outcome = await editor.updateGroupMetadata({
      groupId: 'child-card',
      expectedRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
      name: '衝突名',
      kind: 'CARD',
      description: '子の説明',
    });
    await flushPromises();

    expect(outcome.status).toBe('mutation-rejected');
    expect(editor.status.value).toBe('conflict');
    expect(editor.itemDraft.value?.name).toBe('Item草案');
    expect(editor.itemDirty.value).toBe(true);
    expect(editor.unresolvedItemConflict.value).toBe(false);
    expect(editor.captureConflictItemRecoveryTarget()).toBeNull();
    root.unmount();
  });

  it('PATCH 成功 + Tree GET 失敗 → committed-refresh-failed、dialog 維持、追加 mutation 0', async () => {
    let mutationDone = false;
    const { getFetchMock } = stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          mutationDone = true;
          return jsonResponse({ status: 'updated', revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000002' });
        }
        return null;
      },
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (
          mutationDone &&
          method === 'GET' &&
          url.includes('/description-tree/grouped')
        ) {
          return new Response('reload failed', { status: 500 });
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper } = await mountGroupedPage();
    const childSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('子カード'));
    await childSelect!.trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="group-edit-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupEditDialog);
    await dialog.find('[data-field="group-name"]').setValue('再読込失敗');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(true);
    expect(wrapper.text()).toContain('最新内容を再読み込み');
    await dialog.find('form').trigger('submit');
    await flushPromises();
    expect(
      countCalls(
        getFetchMock(),
        (url, method) => method === 'PATCH' && url.includes('/groups/child-card'),
      ),
    ).toBe(1);
  });

  it('commit-unknown: reload 後 metadata 一致 → dialog close', async () => {
    const { state } = stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          const entry = state.get('grouped');
          if (entry?.doc.groups) {
            const group = entry.doc.groups.find((g) => g.groupId === 'child-card');
            if (group) {
              group.name = '一致名';
              group.kind = 'ACTIONS';
              group.description = '一致説明';
              entry.revision = 'sha256:00000000000000000000000000000000000000000000000000000000000000c0';
            }
          }
          return Promise.reject(new Error('network reset'));
        }
        return null;
      },
    });
    const { wrapper } = await mountGroupedPage();
    const childSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('子カード'));
    await childSelect!.trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="group-edit-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupEditDialog);
    await dialog.find('[data-field="group-name"]').setValue('一致名');
    await dialog.find('[data-field="group-kind"]').setValue('ACTIONS');
    await dialog.find('[data-field="group-description"]').setValue('一致説明');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(false);
    expect(wrapper.findComponent(GroupInfoPanel).text()).toContain('一致名');
  });

  it('commit-unknown: reload 後 metadata 不一致 → dialog 維持・retry 可', async () => {
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          return Promise.reject(new Error('network reset'));
        }
        return null;
      },
    });
    const { wrapper } = await mountGroupedPage();
    const childSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('子カード'));
    await childSelect!.trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="group-edit-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupEditDialog);
    await dialog.find('[data-field="group-name"]').setValue('未反映名');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(true);
    expect(
      (wrapper.find('[data-field="group-name"]').element as HTMLInputElement).value,
    ).toBe('未反映名');
    expect(wrapper.text()).toContain('保存後に別の変更が反映されました');
    expect(
      wrapper.find('[data-testid="group-edit-save"]').attributes('disabled'),
    ).toBeUndefined();
  });

  it('Screen 切替中の遅延 reload は新 Screen を汚染しない', async () => {
    let patchSeen = false;
    let reloadStarted = false;
    let releaseReload!: () => void;
    const reloadHold = new Promise<void>((resolve) => {
      releaseReload = resolve;
    });
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          patchSeen = true;
          return jsonResponse({ status: 'updated', revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000002' });
        }
        return null;
      },
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (
          patchSeen &&
          method === 'GET' &&
          url.includes('/description-tree/grouped')
        ) {
          reloadStarted = true;
          await reloadHold;
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper, router } = await mountGroupedPage();
    const childSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('子カード'));
    await childSelect!.trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="group-edit-open"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent(GroupEditDialog);
    await dialog.find('[data-field="group-name"]').setValue('遅延名');
    const savePromise = dialog.find('form').trigger('submit').then(() => flushPromises());
    await vi.waitFor(() => {
      expect(patchSeen).toBe(true);
      expect(reloadStarted).toBe(true);
    });

    await router.push('/screens/screen-b');
    await flushPromises();
    expect(wrapper.text()).toContain('Screen B');
    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(false);

    releaseReload();
    await savePromise;
    await flushPromises();
    expect(wrapper.text()).toContain('Screen B');
    expect(wrapper.text()).not.toContain('遅延名');
  });

  it('XSS: 悪意ある name/description は text として表示される', async () => {
    stubDescriptionTreeFetch(
      {
        grouped: createGroupedDoc({
          groups: [
            {
              groupId: 'parent-section',
              name: '親グループ',
              kind: 'SECTION',
              children: [{ type: 'group', id: 'child-card' }],
            },
            {
              groupId: 'child-card',
              name: '<script>alert(1)</script>',
              kind: 'CARD',
              description: '<img src=x onerror=alert(1)>',
              children: [{ type: 'item', id: 'leaf-item' }],
            },
          ],
        }),
      },
      {
        extraHandler: (url) => {
          if (url.endsWith('/data/screens/grouped.json')) {
            return jsonResponse(groupedScreen);
          }
          if (url.endsWith('/data/snapshots/grouped/default.html')) {
            return textResponse('<main></main>');
          }
          if (url.endsWith('/data/theme/preview.css')) {
            return textResponse('/* preview */');
          }
          return null;
        },
      },
    );
    const { wrapper } = await mountGroupedPage();
    const childSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('<script>alert(1)</script>'));
    expect(childSelect).toBeTruthy();
    await childSelect!.trigger('click');
    await flushPromises();

    const panel = wrapper.findComponent(GroupInfoPanel);
    expect(panel.html()).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(panel.html()).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(panel.find('script').exists()).toBe(false);
    expect(panel.find('img').exists()).toBe(false);
  });

  it('composable: unchanged envelope を error にしない', async () => {
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          return jsonResponse({ status: 'unchanged', revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001' });
        }
        return null;
      },
    });
    const { harness, root } = await mountEditorHarness();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('grouped');
    await flushPromises();
    const outcome = await editor.updateGroupMetadata({
      groupId: 'child-card',
      expectedRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
      name: '子カード',
      kind: 'CARD',
      description: '子の説明',
    });
    expect(outcome.status).toBe('committed-refreshed');
    expect(editor.reloadRequired.value).toBe(false);
    root.unmount();
  });

  it('unmount 後の reload resolve は state を更新しない', async () => {
    let patchSeen = false;
    let reloadStarted = false;
    let releaseReload!: () => void;
    const reloadHold = new Promise<void>((resolve) => {
      releaseReload = resolve;
    });
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          patchSeen = true;
          return jsonResponse({ status: 'updated', revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000002' });
        }
        return null;
      },
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (
          patchSeen &&
          method === 'GET' &&
          url.includes('/description-tree/grouped')
        ) {
          reloadStarted = true;
          await reloadHold;
        }
        return baseFetch(input, init);
      },
    });
    const { harness, root } = await mountEditorHarness();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('grouped');
    await flushPromises();
    const pending = editor.updateGroupMetadata({
      groupId: 'child-card',
      expectedRevision: editor.revision.value!,
      name: 'unmount名',
      kind: 'CARD',
      description: 'x',
    });
    await vi.waitFor(() => {
      expect(patchSeen).toBe(true);
      expect(reloadStarted).toBe(true);
    });
    root.unmount();
    releaseReload();
    await expect(pending).resolves.toEqual({ status: 'stale-or-aborted' });
  });

  it('unmount 後の reload reject は state を更新しない', async () => {
    let patchSeen = false;
    let reloadStarted = false;
    let rejectReload!: (reason?: unknown) => void;
    const reloadHold = new Promise<void>((_resolve, reject) => {
      rejectReload = reject;
    });
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          patchSeen = true;
          return jsonResponse({ status: 'updated', revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000002' });
        }
        return null;
      },
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (
          patchSeen &&
          method === 'GET' &&
          url.includes('/description-tree/grouped')
        ) {
          reloadStarted = true;
          await reloadHold;
        }
        return baseFetch(input, init);
      },
    });
    const { harness, root } = await mountEditorHarness();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('grouped');
    await flushPromises();
    const pending = editor.updateGroupMetadata({
      groupId: 'child-card',
      expectedRevision: editor.revision.value!,
      name: 'unmount名',
      kind: 'CARD',
      description: 'x',
    });
    await vi.waitFor(() => {
      expect(patchSeen).toBe(true);
      expect(reloadStarted).toBe(true);
    });
    root.unmount();
    rejectReload(new Error('late reject'));
    await expect(pending).resolves.toEqual({ status: 'stale-or-aborted' });
  });
});

describe('Group update authoritative reconciliation P1', () => {
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

  async function openChildGroupDialog(wrapper: Awaited<ReturnType<typeof mountGroupedPage>>['wrapper']) {
    const childSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('子カード'));
    await childSelect!.trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="group-edit-open"]').trigger('click');
    await flushPromises();
    return wrapper.findComponent(GroupEditDialog);
  }

  it('A: PATCH 成功 + authoritative metadata mismatch → dialog 維持・success 禁止', async () => {
    const { state, getFetchMock } = stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          const entry = state.get('grouped');
          if (entry) {
            entry.revision = 'sha256:00000000000000000000000000000000000000000000000000000000000000ee';
          }
          return jsonResponse({
            status: 'updated',
            revision: 'sha256:00000000000000000000000000000000000000000000000000000000000000ee',
          });
        }
        return null;
      },
    });
    const { wrapper } = await mountGroupedPage();
    const dialog = await openChildGroupDialog(wrapper);
    await dialog.find('[data-field="group-name"]').setValue('Submitted');
    await dialog.find('[data-field="group-kind"]').setValue('CONTENT');
    await dialog.find('[data-field="group-description"]').setValue('Submitted description');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(true);
    expect(
      (wrapper.find('[data-field="group-name"]').element as HTMLInputElement).value,
    ).toBe('Submitted');
    expect(wrapper.text()).not.toContain('保存しました');
    expect(wrapper.text()).toContain('保存後に別の変更が反映されました');
    expect(wrapper.find('.spec-page__banner[data-status="reload-failed"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-testid="group-edit-save"]').attributes('disabled'),
    ).toBeUndefined();

    await dialog.find('form').trigger('submit');
    await flushPromises();
    const patchBodies = getFetchMock()
      .mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/groups/child-card') &&
          ((init as RequestInit | undefined)?.method ?? '').toUpperCase() === 'PATCH',
      )
      .map(([, init]) =>
        JSON.parse(String((init as RequestInit).body)) as { expectedRevision: string },
      );
    expect(patchBodies.length).toBeGreaterThanOrEqual(2);
    expect(patchBodies[1]?.expectedRevision).toBe('sha256:00000000000000000000000000000000000000000000000000000000000000ee');
  });

  function stripChildCardFromTreeResponse(data: {
    revision: string;
    description: {
      groups: Array<{ groupId: string; children: unknown[] }>;
    };
  }, revision: string) {
    data.revision = revision;
    data.description.groups = data.description.groups.filter(
      (group) => group.groupId !== 'child-card',
    );
    const parent = data.description.groups.find(
      (group) => group.groupId === 'parent-section',
    );
    if (parent) {
      parent.children = [{ type: 'item', id: 'leaf-item' }];
    }
  }

  it('B: PATCH 成功 + target absent → dialog 終了・selection prune', async () => {
    let patchDone = false;
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          patchDone = true;
          return jsonResponse({ status: 'updated', revision: 'sha256:00000000000000000000000000000000000000000000000000000000000000e0' });
        }
        return null;
      },
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (
          patchDone &&
          method === 'GET' &&
          url.includes('/description-tree/grouped')
        ) {
          const response = await baseFetch(input, init);
          const data = (await response.json()) as {
            revision: string;
            sourceSchemaVersion: string;
            collectedItemIds: string[];
            description: {
              schemaVersion: string;
              screen: { id: string; name: string; description: string };
              rootNodes: Array<{ type: string; id: string }>;
              groups: Array<{ groupId: string; children: unknown[] }>;
              items: Record<string, unknown>;
              excludedItems: Record<string, unknown>;
            };
          };
          stripChildCardFromTreeResponse(data, 'sha256:00000000000000000000000000000000000000000000000000000000000000e0');
          return jsonResponse(data);
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper } = await mountGroupedPage();
    const dialog = await openChildGroupDialog(wrapper);
    await dialog.find('[data-field="group-name"]').setValue('消える名前');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(false);
    expect(wrapper.findComponent(GroupInfoPanel).exists()).toBe(false);
    expect(wrapper.find('.item-tree__row.is-selected').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('保存しました');
    expect(wrapper.text()).toContain('対象のグループが見つからない');
    expect(wrapper.find('.spec-page__banner[data-status="reload-failed"]').exists()).toBe(
      false,
    );
  });

  it('C: commit-unknown + target absent → dialog 終了・retry 禁止', async () => {
    let patchAttempted = false;
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          patchAttempted = true;
          return Promise.reject(new Error('network reset'));
        }
        return null;
      },
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (
          patchAttempted &&
          method === 'GET' &&
          url.includes('/description-tree/grouped')
        ) {
          const response = await baseFetch(input, init);
          const data = (await response.json()) as {
            revision: string;
            sourceSchemaVersion: string;
            collectedItemIds: string[];
            description: {
              schemaVersion: string;
              screen: { id: string; name: string; description: string };
              rootNodes: Array<{ type: string; id: string }>;
              groups: Array<{ groupId: string; children: unknown[] }>;
              items: Record<string, unknown>;
              excludedItems: Record<string, unknown>;
            };
          };
          stripChildCardFromTreeResponse(data, 'sha256:00000000000000000000000000000000000000000000000000000000000000e5');
          return jsonResponse(data);
        }
        return baseFetch(input, init);
      },
    });

    const { wrapper } = await mountGroupedPage();
    const dialog = await openChildGroupDialog(wrapper);
    await dialog.find('[data-field="group-name"]').setValue('不明名');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(false);
    expect(wrapper.findComponent(GroupInfoPanel).exists()).toBe(false);
    expect(wrapper.text()).not.toContain('保存しました');
    expect(wrapper.text()).toContain('対象のグループが見つからない');
  });

  it('D: PATCH 404 + target absent → target-absent 終了', async () => {
    let patchDone = false;
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          patchDone = true;
          return jsonResponse(
            {
              code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
              message: 'Group が見つかりません。',
            },
            404,
          );
        }
        return null;
      },
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (
          patchDone &&
          method === 'GET' &&
          url.includes('/description-tree/grouped')
        ) {
          const response = await baseFetch(input, init);
          const data = (await response.json()) as {
            revision: string;
            sourceSchemaVersion: string;
            collectedItemIds: string[];
            description: {
              schemaVersion: string;
              screen: { id: string; name: string; description: string };
              rootNodes: Array<{ type: string; id: string }>;
              groups: Array<{ groupId: string; children: unknown[] }>;
              items: Record<string, unknown>;
              excludedItems: Record<string, unknown>;
            };
          };
          data.revision = 'sha256:00000000000000000000000000000000000000000000000000000000000000e6';
          data.description.groups = data.description.groups.filter(
            (group) => group.groupId !== 'child-card',
          );
          const parent = data.description.groups.find(
            (group) => group.groupId === 'parent-section',
          );
          if (parent) {
            parent.children = [{ type: 'item', id: 'leaf-item' }];
          }
          return jsonResponse(data);
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper } = await mountGroupedPage();
    const dialog = await openChildGroupDialog(wrapper);
    await dialog.find('[data-field="group-name"]').setValue('404名');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(false);
    expect(wrapper.text()).toContain('対象のグループが見つからない');
  });

  it('E: PATCH 404 + target exists → dialog 維持・revision 更新', async () => {
    let patchDone = false;
    const { getFetchMock } = stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          patchDone = true;
          return jsonResponse(
            {
              code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
              message: 'Group が見つかりません。',
            },
            404,
          );
        }
        return null;
      },
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (
          patchDone &&
          method === 'GET' &&
          url.includes('/description-tree/grouped')
        ) {
          const response = await baseFetch(input, init);
          const data = (await response.json()) as {
            revision: string;
            description: unknown;
            sourceSchemaVersion: string;
            collectedItemIds: string[];
          };
          data.revision = 'sha256:00000000000000000000000000000000000000000000000000000000000000e7';
          return jsonResponse(data);
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper } = await mountGroupedPage();
    const dialog = await openChildGroupDialog(wrapper);
    await dialog.find('[data-field="group-name"]').setValue('残存名');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(true);
    expect(
      (wrapper.find('[data-field="group-name"]').element as HTMLInputElement).value,
    ).toBe('残存名');
    expect(wrapper.find('.spec-page__banner[data-status="reload-failed"]').exists()).toBe(
      false,
    );

    await dialog.find('form').trigger('submit');
    await flushPromises();
    const patchBodies = getFetchMock()
      .mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/groups/child-card') &&
          ((init as RequestInit | undefined)?.method ?? '').toUpperCase() === 'PATCH',
      )
      .map(([, init]) =>
        JSON.parse(String((init as RequestInit).body)) as { expectedRevision: string },
      );
    expect(patchBodies.at(-1)?.expectedRevision).toBe('sha256:00000000000000000000000000000000000000000000000000000000000000e7');
  });

  it('F: dialog 捕獲 revision R1 を使い外部 reload R2 で置換しない', async () => {
    const { state, getFetchMock } = stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    await openChildGroupDialog(wrapper);
    const entry = state.get('grouped');
    expect(entry).toBeTruthy();
    entry!.revision = 'sha256:00000000000000000000000000000000000000000000000000000000000000e8';
    await wrapper.find('.item-tree-panel__reload').trigger('click');
    await flushPromises();

    const dialog = wrapper.findComponent(GroupEditDialog);
    await dialog.find('[data-field="group-name"]').setValue('捕獲名');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    const patchBodies = getFetchMock()
      .mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/groups/child-card') &&
          ((init as RequestInit | undefined)?.method ?? '').toUpperCase() === 'PATCH',
      )
      .map(([, init]) =>
        JSON.parse(String((init as RequestInit).body)) as { expectedRevision: string },
      );
    expect(patchBodies).toHaveLength(1);
    expect(patchBodies[0]?.expectedRevision).toBe('sha256:0000000000000000000000000000000000000000000000000000000000000001');
  });

  it('H: authoritative snapshot から Group が消えたら selectedTreeNode を prune', async () => {
    const { state } = stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    const childSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('子カード'));
    await childSelect!.trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(GroupInfoPanel).exists()).toBe(true);

    const entry = state.get('grouped');
    entry!.doc.groups = [
      {
        groupId: 'parent-section',
        name: '親グループ',
        kind: 'SECTION',
        description: '親の説明',
        children: [{ type: 'item', id: 'leaf-item' }],
      },
    ];
    entry!.revision = 'sha256:00000000000000000000000000000000000000000000000000000000000000e9';
    await wrapper.find('.item-tree-panel__reload').trigger('click');
    await flushPromises();

    expect(wrapper.findComponent(GroupInfoPanel).exists()).toBe(false);
    expect(wrapper.find('.item-tree__row.is-selected').exists()).toBe(false);
  });

  it('I/J: Screen 切替後の旧 generation 完了は新 Screen dialog を汚染しない', async () => {
    let patchSeen = false;
    let holdNextGroupedGet = false;
    let releaseReload!: () => void;
    const reloadHold = new Promise<void>((resolve) => {
      releaseReload = resolve;
    });
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          patchSeen = true;
          holdNextGroupedGet = true;
          return jsonResponse({ status: 'updated', revision: 'sha256:00000000000000000000000000000000000000000000000000000000000000e1' });
        }
        return null;
      },
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (
          holdNextGroupedGet &&
          method === 'GET' &&
          url.includes('/description-tree/grouped')
        ) {
          holdNextGroupedGet = false;
          await reloadHold;
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper, router } = await mountGroupedPage();
    const dialog = await openChildGroupDialog(wrapper);
    await dialog.find('[data-field="group-name"]').setValue('遅延生成1');
    void dialog.find('form').trigger('submit');
    await vi.waitFor(() => expect(patchSeen).toBe(true));

    await router.push('/screens/screen-b');
    await flushPromises();
    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(false);

    await router.push('/screens/grouped');
    await flushPromises();
    const dialog2 = await openChildGroupDialog(wrapper);
    await dialog2.find('[data-field="group-name"]').setValue('生成2');
    expect(
      (wrapper.find('[data-field="group-name"]').element as HTMLInputElement).value,
    ).toBe('生成2');

    releaseReload();
    await flushPromises();
    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(true);
    expect(
      (wrapper.find('[data-field="group-name"]').element as HTMLInputElement).value,
    ).toBe('生成2');
    expect(wrapper.text()).not.toContain('遅延生成1');
  });
});

describe('Group update baseline・active tree P1', () => {
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

  async function openChildGroupDialog(
    wrapper: Awaited<ReturnType<typeof mountGroupedPage>>['wrapper'],
  ) {
    const childSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('子カード'));
    await childSelect!.trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="group-edit-open"]').trigger('click');
    await flushPromises();
    return wrapper.findComponent(GroupEditDialog);
  }

  function applyAuthoritativeChildMetadata(
    entry: {
      revision: string;
      doc: MockTreeDoc;
    },
    revision: string,
  ): void {
    entry.revision = revision;
    const child = entry.doc.groups?.find((group) => group.groupId === 'child-card');
    expect(child).toBeTruthy();
    child!.name = 'AuthoritativeB';
    child!.kind = 'CONTENT';
    child!.description = 'Auth description';
  }

  function orphanChildCardKeepingDefinition(entry: {
    revision: string;
    doc: MockTreeDoc;
  }, revision: string): void {
    entry.revision = revision;
    const parent = entry.doc.groups?.find(
      (group) => group.groupId === 'parent-section',
    );
    expect(parent).toBeTruthy();
    parent!.children = [{ type: 'item', id: 'leaf-item' }];
    // child-card definition は groups[] に残す（orphan）
    expect(
      entry.doc.groups?.some((group) => group.groupId === 'child-card'),
    ).toBe(true);
  }

  it('A: baseline A / draft A / authoritative B → 保存 enabled・retry R2', async () => {
    const { state, getFetchMock } = stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          const entry = state.get('grouped');
          if (entry) {
            applyAuthoritativeChildMetadata(entry, 'sha256:00000000000000000000000000000000000000000000000000000000000000b0');
          }
          return jsonResponse({
            status: 'updated',
            revision: 'sha256:00000000000000000000000000000000000000000000000000000000000000b0',
          });
        }
        return null;
      },
    });
    const { wrapper } = await mountGroupedPage();
    const dialog = await openChildGroupDialog(wrapper);
    await dialog.find('[data-field="group-name"]').setValue('一時名');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(true);
    await dialog.find('[data-field="group-name"]').setValue('子カード');
    await flushPromises();
    expect(
      wrapper.find('[data-testid="group-edit-save"]').attributes('disabled'),
    ).toBeUndefined();

    await dialog.find('form').trigger('submit');
    await flushPromises();
    const patchBodies = getFetchMock()
      .mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/groups/child-card') &&
          ((init as RequestInit | undefined)?.method ?? '').toUpperCase() ===
            'PATCH',
      )
      .map(([, init]) =>
        JSON.parse(String((init as RequestInit).body)) as {
          expectedRevision: string;
          name: string;
        },
      );
    expect(patchBodies.length).toBeGreaterThanOrEqual(2);
    expect(patchBodies[1]?.expectedRevision).toBe('sha256:00000000000000000000000000000000000000000000000000000000000000b0');
    expect(patchBodies[1]?.name).toBe('子カード');
  });

  it('B: draft C を保持し baseline B で retry body=C', async () => {
    const { state, getFetchMock } = stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          const entry = state.get('grouped');
          if (entry) {
            applyAuthoritativeChildMetadata(entry, 'sha256:00000000000000000000000000000000000000000000000000000000000000c1');
          }
          return jsonResponse({
            status: 'updated',
            revision: 'sha256:00000000000000000000000000000000000000000000000000000000000000c1',
          });
        }
        return null;
      },
    });
    const { wrapper } = await mountGroupedPage();
    const dialog = await openChildGroupDialog(wrapper);
    await dialog.find('[data-field="group-name"]').setValue('DraftC');
    await dialog.find('[data-field="group-kind"]').setValue('ACTIONS');
    await dialog.find('[data-field="group-description"]').setValue('C desc');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    expect(
      (wrapper.find('[data-field="group-name"]').element as HTMLInputElement).value,
    ).toBe('DraftC');
    expect(
      (wrapper.find('[data-field="group-kind"]').element as HTMLSelectElement).value,
    ).toBe('ACTIONS');
    expect(
      (wrapper.find('[data-field="group-description"]').element as HTMLTextAreaElement)
        .value,
    ).toBe('C desc');
    expect(
      wrapper.find('[data-testid="group-edit-save"]').attributes('disabled'),
    ).toBeUndefined();

    await dialog.find('form').trigger('submit');
    await flushPromises();
    const patchBodies = getFetchMock()
      .mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/groups/child-card') &&
          ((init as RequestInit | undefined)?.method ?? '').toUpperCase() ===
            'PATCH',
      )
      .map(([, init]) =>
        JSON.parse(String((init as RequestInit).body)) as {
          expectedRevision: string;
          name: string;
          kind: string;
          description: string | null;
        },
      );
    expect(patchBodies.at(-1)).toMatchObject({
      expectedRevision: 'sha256:00000000000000000000000000000000000000000000000000000000000000c1',
      name: 'DraftC',
      kind: 'ACTIONS',
      description: 'C desc',
    });
  });

  it('C: 新 baseline B に draft を合わせると no-change で PATCH 0', async () => {
    const { state, getFetchMock } = stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          const entry = state.get('grouped');
          if (entry) {
            applyAuthoritativeChildMetadata(entry, 'sha256:00000000000000000000000000000000000000000000000000000000000000c2');
          }
          return jsonResponse({
            status: 'updated',
            revision: 'sha256:00000000000000000000000000000000000000000000000000000000000000c2',
          });
        }
        return null;
      },
    });
    const { wrapper } = await mountGroupedPage();
    const dialog = await openChildGroupDialog(wrapper);
    await dialog.find('[data-field="group-name"]').setValue('一時');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    const patchesBefore = getFetchMock().mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/groups/child-card') &&
        ((init as RequestInit | undefined)?.method ?? '').toUpperCase() === 'PATCH',
    ).length;

    await dialog.find('[data-field="group-name"]').setValue('AuthoritativeB');
    await dialog.find('[data-field="group-kind"]').setValue('CONTENT');
    await dialog.find('[data-field="group-description"]').setValue('Auth description');
    await flushPromises();
    expect(
      wrapper.find('[data-testid="group-edit-save"]').attributes('disabled'),
    ).toBeDefined();
    await dialog.find('form').trigger('submit');
    await flushPromises();

    const patchesAfter = getFetchMock().mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/groups/child-card') &&
        ((init as RequestInit | undefined)?.method ?? '').toUpperCase() === 'PATCH',
    ).length;
    expect(patchesAfter).toBe(patchesBefore);
  });

  it('D: 404 + active target B → baseline/revision 更新・retry 可', async () => {
    let patchDone = false;
    const { state, getFetchMock } = stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          patchDone = true;
          const entry = state.get('grouped');
          if (entry) {
            applyAuthoritativeChildMetadata(entry, 'sha256:00000000000000000000000000000000000000000000000000000000000000ea');
          }
          return jsonResponse(
            {
              code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
              message: 'Group が見つかりません。',
            },
            404,
          );
        }
        return null;
      },
    });
    const { wrapper } = await mountGroupedPage();
    const dialog = await openChildGroupDialog(wrapper);
    await dialog.find('[data-field="group-name"]').setValue('残したい名');
    await dialog.find('form').trigger('submit');
    await flushPromises();
    expect(patchDone).toBe(true);
    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(true);
    expect(
      (wrapper.find('[data-field="group-name"]').element as HTMLInputElement).value,
    ).toBe('残したい名');
    expect(
      wrapper.find('[data-testid="group-edit-save"]').attributes('disabled'),
    ).toBeUndefined();

    await dialog.find('[data-field="group-name"]').setValue('子カード');
    await flushPromises();
    expect(
      wrapper.find('[data-testid="group-edit-save"]').attributes('disabled'),
    ).toBeUndefined();

    await dialog.find('form').trigger('submit');
    await flushPromises();
    const patchBodies = getFetchMock()
      .mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/groups/child-card') &&
          ((init as RequestInit | undefined)?.method ?? '').toUpperCase() ===
            'PATCH',
      )
      .map(([, init]) =>
        JSON.parse(String((init as RequestInit).body)) as {
          expectedRevision: string;
        },
      );
    expect(patchBodies.at(-1)?.expectedRevision).toBe('sha256:00000000000000000000000000000000000000000000000000000000000000ea');
  });

  it('E: orphan Group definition → target-absent（mismatch/success ではない）', async () => {
    const { state } = stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          const entry = state.get('grouped');
          if (entry) {
            orphanChildCardKeepingDefinition(entry, 'sha256:00000000000000000000000000000000000000000000000000000000000000c3');
          }
          return jsonResponse({
            status: 'updated',
            revision: 'sha256:00000000000000000000000000000000000000000000000000000000000000c3',
          });
        }
        return null;
      },
    });
    const { wrapper } = await mountGroupedPage();
    const dialog = await openChildGroupDialog(wrapper);
    await dialog.find('[data-field="group-name"]').setValue('孤児名');
    await dialog.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(false);
    expect(wrapper.findComponent(GroupInfoPanel).exists()).toBe(false);
    expect(wrapper.text()).not.toContain('保存しました');
    expect(wrapper.text()).not.toContain('保存後に別の変更が反映されました');
    expect(wrapper.text()).toContain('対象のグループが見つからない');
    expect(
      state.get('grouped')?.doc.groups?.some((g) => g.groupId === 'child-card'),
    ).toBe(true);
  });

  it('F: orphan Group selection を prune し GroupInfoPanel を消す', async () => {
    const { state } = stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    const childSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('子カード'));
    await childSelect!.trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(GroupInfoPanel).exists()).toBe(true);

    const entry = state.get('grouped');
    orphanChildCardKeepingDefinition(entry!, 'sha256:00000000000000000000000000000000000000000000000000000000000000eb');
    await wrapper.find('.item-tree-panel__reload').trigger('click');
    await flushPromises();

    expect(wrapper.findComponent(GroupInfoPanel).exists()).toBe(false);
    expect(wrapper.find('.item-tree__row.is-selected').exists()).toBe(false);
  });

  async function expandChildCardAndSelectLeafItem(
    wrapper: Awaited<ReturnType<typeof mountGroupedPage>>['wrapper'],
  ): Promise<void> {
    const childToggle = wrapper
      .findAll('.item-tree__toggle')
      .find((button) => button.attributes('aria-label') === '展開');
    expect(childToggle).toBeTruthy();
    await childToggle!.trigger('click');
    await flushPromises();
    const itemSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('末端項目'));
    expect(itemSelect).toBeTruthy();
    await itemSelect!.trigger('click');
    await flushPromises();
  }

  it('G: orphan Item selection を prune する', async () => {
    const { state } = stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    await expandChildCardAndSelectLeafItem(wrapper);
    expect(wrapper.find('.item-tree__row.is-selected').exists()).toBe(true);

    const entry = state.get('grouped')!;
    entry.revision = 'sha256:00000000000000000000000000000000000000000000000000000000000000ec';
    const child = entry.doc.groups?.find((group) => group.groupId === 'child-card');
    child!.children = [];
    // leaf-item definition は items に残す
    expect(entry.doc.items['leaf-item']).toBeTruthy();
    await wrapper.find('.item-tree-panel__reload').trigger('click');
    await flushPromises();

    expect(wrapper.find('.item-tree__row.is-selected').exists()).toBe(false);
  });

  it('H: excluded Item は active として残さない', async () => {
    const { state } = stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    await expandChildCardAndSelectLeafItem(wrapper);

    const entry = state.get('grouped')!;
    entry.revision = 'sha256:00000000000000000000000000000000000000000000000000000000000000ed';
    const child = entry.doc.groups?.find((group) => group.groupId === 'child-card');
    child!.children = [];
    const item = entry.doc.items['leaf-item'];
    delete entry.doc.items['leaf-item'];
    entry.doc.itemOrder = entry.doc.itemOrder.filter((id) => id !== 'leaf-item');
    entry.doc.excludedItems = {
      ...(entry.doc.excludedItems ?? {}),
      'leaf-item': item,
    };
    await wrapper.find('.item-tree-panel__reload').trigger('click');
    await flushPromises();

    expect(wrapper.find('.item-tree__row.is-selected').exists()).toBe(false);
  });

  it('I: nested Group selection は維持する', async () => {
    stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    const childSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('子カード'));
    await childSelect!.trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(GroupInfoPanel).exists()).toBe(true);
    await wrapper.find('.item-tree-panel__reload').trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(GroupInfoPanel).exists()).toBe(true);
    expect(wrapper.find('.item-tree__row.is-selected').text()).toContain('子カード');
  });

  it('J: nested Item selection は維持する', async () => {
    stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    await expandChildCardAndSelectLeafItem(wrapper);
    await wrapper.find('.item-tree-panel__reload').trigger('click');
    await flushPromises();
    expect(wrapper.find('.item-tree__row.is-selected').text()).toContain('末端項目');
  });

  it('L: Screen A orphan late completion は Screen B を汚染しない', async () => {
    let patchSeen = false;
    let holdGroupedGet = false;
    let releaseReload!: () => void;
    const reloadHold = new Promise<void>((resolve) => {
      releaseReload = resolve;
    });
    stubGroupedPageFetch({
      onFetch: (url, method) => {
        if (url.includes('/groups/child-card') && method === 'PATCH') {
          patchSeen = true;
          holdGroupedGet = true;
          return jsonResponse({ status: 'updated', revision: 'sha256:00000000000000000000000000000000000000000000000000000000000000e3' });
        }
        return null;
      },
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (
          holdGroupedGet &&
          method === 'GET' &&
          url.includes('/description-tree/grouped')
        ) {
          holdGroupedGet = false;
          await reloadHold;
          const response = await baseFetch(input, init);
          const data = (await response.json()) as {
            revision: string;
            description: {
              rootNodes: Array<{ type: string; id: string }>;
              groups: Array<{
                groupId: string;
                name: string;
                kind: string;
                description?: string;
                children: Array<{ type: string; id: string }>;
              }>;
              items: Record<string, unknown>;
            };
            sourceSchemaVersion: string;
            collectedItemIds: string[];
          };
          data.revision = 'sha256:00000000000000000000000000000000000000000000000000000000000000e3';
          const parent = data.description.groups.find(
            (group) => group.groupId === 'parent-section',
          );
          if (parent) {
            parent.children = [{ type: 'item', id: 'leaf-item' }];
          }
          return jsonResponse(data);
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper, router } = await mountGroupedPage();
    const dialog = await openChildGroupDialog(wrapper);
    await dialog.find('[data-field="group-name"]').setValue('A遅延');
    void dialog.find('form').trigger('submit');
    await vi.waitFor(() => expect(patchSeen).toBe(true));

    await router.push('/screens/screen-b');
    await flushPromises();
    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(false);
    expect(wrapper.findComponent(GroupInfoPanel).exists()).toBe(false);

    releaseReload();
    await flushPromises();
    expect(wrapper.findComponent(GroupEditDialog).exists()).toBe(false);
    expect(wrapper.text()).not.toContain('対象のグループが見つからない');
  });
});

describe('Item draft・expanded initialization P1', () => {
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

  async function expandChildAndSelectLeaf(
    wrapper: Awaited<ReturnType<typeof mountGroupedPage>>['wrapper'],
  ): Promise<void> {
    const childToggle = wrapper
      .findAll('.item-tree__toggle')
      .find((button) => button.attributes('aria-label') === '展開');
    expect(childToggle).toBeTruthy();
    await childToggle!.trigger('click');
    await flushPromises();
    const itemSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('末端項目'));
    expect(itemSelect).toBeTruthy();
    await itemSelect!.trigger('click');
    await flushPromises();
  }

  it('A: orphan Item は selection と hidden item draft/dirty を clear する', async () => {
    const { state } = stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    await expandChildAndSelectLeaf(wrapper);

    const nameInput = wrapper.find('#item-row-leaf-item td input');
    expect(nameInput.exists()).toBe(true);
    await nameInput.setValue('孤児 draft');
    await flushPromises();
    expect(wrapper.text()).toMatch(/未保存/);

    const entry = state.get('grouped')!;
    entry.revision = 'sha256:00000000000000000000000000000000000000000000000000000000000000ef';
    const child = entry.doc.groups?.find((group) => group.groupId === 'child-card');
    child!.children = [];
    expect(entry.doc.items['leaf-item']).toBeTruthy();

    await wrapper.find('.item-tree-panel__reload').trigger('click');
    await flushPromises();

    expect(wrapper.find('.item-tree__row.is-selected').exists()).toBe(false);
    expect(wrapper.find('#item-row-leaf-item').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/未保存の変更あり/);
  });

  it('B: active nested Item draft は same-screen reload 後も維持する', async () => {
    stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    await expandChildAndSelectLeaf(wrapper);
    const nameInput = wrapper.find('#item-row-leaf-item td input');
    await nameInput.setValue('維持 draft');
    await flushPromises();
    expect(wrapper.text()).toMatch(/未保存/);

    await wrapper.find('.item-tree-panel__reload').trigger('click');
    await flushPromises();

    expect(wrapper.find('.item-tree__row.is-selected').text()).toContain('末端項目');
    expect(
      (wrapper.find('#item-row-leaf-item td input').element as HTMLInputElement).value,
    ).toBe('維持 draft');
    expect(wrapper.text()).toMatch(/未保存/);
  });

  it('B2: Group metadata mutation reload 後も active Item draft を維持する', async () => {
    stubGroupedPageFetch();
    const { harness, root } = await mountEditorHarness();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('grouped');
    await flushPromises();

    editor.beginItemEdit('leaf-item');
    editor.updateItemField('leaf-item', 'name', 'Group更新中も維持');
    expect(editor.itemDirty.value).toBe(true);

    const outcome = await editor.updateGroupMetadata({
      groupId: 'child-card',
      expectedRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
      name: '更新後カード',
      kind: 'CARD',
      description: '子の説明',
    });
    await flushPromises();

    expect(outcome.status).toBe('committed-refreshed');
    expect(editor.itemDraftItemId.value).toBe('leaf-item');
    expect(editor.itemDraft.value?.name).toBe('Group更新中も維持');
    expect(editor.itemDirty.value).toBe(true);
    root.unmount();
  });

  it('D: editing すべて畳み → same-screen reload でも default 再展開しない', async () => {
    stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    const parentToggle = wrapper
      .findAll('.item-tree__toggle')
      .find((button) => button.attributes('aria-label') === '折りたたむ');
    expect(parentToggle).toBeTruthy();
    await parentToggle!.trigger('click');
    await flushPromises();
    expect(
      wrapper
        .findAll('.item-tree__toggle')
        .every((button) => button.attributes('aria-label') === '展開'),
    ).toBe(true);

    await wrapper.find('.item-tree-panel__reload').trigger('click');
    await flushPromises();

    expect(
      wrapper
        .findAll('.item-tree__toggle')
        .every((button) => button.attributes('aria-label') === '展開'),
    ).toBe(true);
    expect(
      wrapper
        .findAll('.item-tree__select')
        .some((button) => button.text().includes('子カード')),
    ).toBe(false);
  });

  it('E: 新 Screen の初回 load では defaults を適用する', async () => {
    stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage();
    expect(
      wrapper
        .findAll('.item-tree__toggle')
        .some((button) => button.attributes('aria-label') === '折りたたむ'),
    ).toBe(true);
    expect(
      wrapper
        .findAll('.item-tree__select')
        .some((button) => button.text().includes('子カード')),
    ).toBe(true);
  });

  it('G: Screen A 全畳み → B では B defaults（A empty を継がない）', async () => {
    stubGroupedPageFetch();
    const { wrapper, router } = await mountGroupedPage();
    const parentToggle = wrapper
      .findAll('.item-tree__toggle')
      .find((button) => button.attributes('aria-label') === '折りたたむ');
    await parentToggle!.trigger('click');
    await flushPromises();

    await router.push('/screens/screen-b');
    await flushPromises();
    // screen-b は flat items のみ（root group なし）でも tree は ready
    expect(wrapper.find('.item-tree-panel').exists()).toBe(true);

    await router.push('/screens/grouped');
    await flushPromises();
    expect(
      wrapper
        .findAll('.item-tree__toggle')
        .some((button) => button.attributes('aria-label') === '折りたたむ'),
    ).toBe(true);
    expect(
      wrapper
        .findAll('.item-tree__select')
        .some((button) => button.text().includes('子カード')),
    ).toBe(true);
  });

  it('H: read-only すべて畳み → reload でも再展開しない', async () => {
    delete window.__JSKIM_SPEC_EDIT__;
    stubGroupedPageFetch();
    const { wrapper } = await mountGroupedPage({ editingEnabled: false });
    const parentToggle = wrapper
      .findAll('.item-tree__toggle')
      .find((button) => button.attributes('aria-label') === '折りたたむ');
    expect(parentToggle).toBeTruthy();
    await parentToggle!.trigger('click');
    await flushPromises();

    await wrapper.find('.item-tree-panel__reload').trigger('click');
    await flushPromises();

    expect(
      wrapper
        .findAll('.item-tree__toggle')
        .every((button) => button.attributes('aria-label') === '展開'),
    ).toBe(true);
  });
});

describe('Item draft clear と global status 分離 P1', () => {
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

  async function expandChildAndSelectLeaf(
    wrapper: Awaited<ReturnType<typeof mountGroupedPage>>['wrapper'],
  ): Promise<void> {
    const childToggle = wrapper
      .findAll('.item-tree__toggle')
      .find((button) => button.attributes('aria-label') === '展開');
    expect(childToggle).toBeTruthy();
    await childToggle!.trigger('click');
    await flushPromises();
    const itemSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('末端項目'));
    expect(itemSelect).toBeTruthy();
    await itemSelect!.trigger('click');
    await flushPromises();
  }

  it('A/B: Item refresh failure → Group 選択でも reload-failed banner/action を維持し、reload で復旧する', async () => {
    let itemPatchDone = false;
    let refreshFailOnce = true;
    stubGroupedPageFetch({
      wrapFetch: async (input, init, baseFetch) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/items/leaf-item') && method === 'PATCH') {
          itemPatchDone = true;
          return baseFetch(input, init);
        }
        if (
          itemPatchDone &&
          refreshFailOnce &&
          method === 'GET' &&
          url.includes('/description-tree/grouped')
        ) {
          refreshFailOnce = false;
          return new Response('reload failed', { status: 500 });
        }
        return baseFetch(input, init);
      },
    });
    const { wrapper } = await mountGroupedPage();
    await expandChildAndSelectLeaf(wrapper);

    const nameInput = wrapper.find('#item-row-leaf-item td input');
    await nameInput.setValue('保存後に失敗');
    await flushPromises();
    const saveItemBtn = wrapper
      .findAll('button.spec-page__btn')
      .find((button) => button.text().includes('項目を保存'));
    expect(saveItemBtn).toBeTruthy();
    await saveItemBtn!.trigger('click');
    await flushPromises();

    expect(wrapper.find('.spec-page__banner[data-status="reload-failed"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).toContain('再読み込み');
    const reloadBtn = wrapper.find(
      '.spec-page__banner[data-status="reload-failed"] button',
    );
    expect(reloadBtn.exists()).toBe(true);

    const childSelect = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('子カード'));
    expect(childSelect).toBeTruthy();
    await childSelect!.trigger('click');
    await flushPromises();

    expect(wrapper.findComponent(GroupInfoPanel).exists()).toBe(true);
    expect(wrapper.find('#item-row-leaf-item.is-selected').exists()).toBe(false);
    expect(wrapper.find('.spec-page__banner[data-status="reload-failed"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('.spec-page__banner[data-status="reload-failed"] button').exists(),
    ).toBe(true);
    expect(wrapper.find('.spec-page__banner[data-status="clean"]').exists()).toBe(false);

    await wrapper
      .find('.spec-page__banner[data-status="reload-failed"] button')
      .trigger('click');
    await flushPromises();

    expect(wrapper.find('.spec-page__banner[data-status="reload-failed"]').exists()).toBe(
      false,
    );
    expect(wrapper.findComponent(GroupInfoPanel).exists()).toBe(true);
    expect(wrapper.find('[data-testid="group-edit-open"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-testid="group-edit-open"]').attributes('disabled'),
    ).toBeUndefined();
  });
});
