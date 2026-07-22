import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { useDescriptionEditor } from '../../src/viewer/editing/useDescriptionEditor';
import ItemDescriptionTable from '../../src/viewer/components/ItemDescriptionTable.vue';
import type { ScreenData } from '../../src/viewer/types';
import {
  stubDescriptionTreeFetch,
  type MockTreeDoc,
} from '../helpers/description-tree-fetch-mock';

function createBaseTreeDoc(overrides?: Partial<MockTreeDoc>): MockTreeDoc {
  return {
    screen: {
      id: 'demo',
      name: 'Demo',
      description: '説明',
      ...overrides?.screen,
    },
    itemOrder: overrides?.itemOrder ?? ['title'],
    excludedItems: overrides?.excludedItems ?? {},
    items: overrides?.items ?? {
      title: {
        name: 'タイトル',
        type: 'text',
        description: '見出し',
        note: '',
      },
    },
    collectedItemIds: overrides?.collectedItemIds,
    rootNodes: overrides?.rootNodes,
    groups: overrides?.groups,
  };
}

const screen: ScreenData = {
  id: 'demo',
  name: 'Demo',
  description: '説明',
  path: '/demo.html',
  itemOrder: ['title'],
  items: {
    title: {
      name: 'タイトル',
      type: 'text',
      description: '見出し',
      note: '',
    },
  },
  states: [
    {
      id: 'default',
      name: '初期',
      viewer: { visible: true, order: 1 },
      snapshotFile: 'snapshots/demo/default.html',
    },
  ],
  interactions: [],
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

const EditorHarness = defineComponent({
  name: 'EditorHarness',
  setup() {
    const screenId = ref('demo');
    const editor = useDescriptionEditor(() => screenId.value);

    function onNameInput(event: Event) {
      const target = event.target as HTMLInputElement;
      editor.updateScreenField('name', target.value);
    }

    return { editor, screenId, onNameInput };
  },
  template: `
    <div>
      <span data-status>{{ editor.status.value }}</span>
      <span data-dirty>{{ editor.dirty.value }}</span>
      <input
        data-name
        :value="editor.draftDocument.value?.screen.name || ''"
        @input="onNameInput"
      />
      <button data-save type="button" @click="editor.saveScreenMetadata()">save</button>
      <button data-cancel type="button" @click="editor.cancel()">cancel</button>
      <pre data-conflict>{{ editor.conflictError.value?.code || '' }}</pre>
    </div>
  `,
});

describe('Description Viewer editing', () => {
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

  async function mountEditor() {
    const router = createRouter({
      history: createMemoryHistory('/spec/'),
      routes: [
        { path: '/screens/:screenId', component: EditorHarness },
        { path: '/', redirect: '/screens/demo' },
      ],
    });
    await router.push('/screens/demo');
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
    const wrapper = root.findComponent(EditorHarness);
    return { wrapper, router, root };
  }

  it('field 変更で dirty、原復で clean、保存成功で clean', async () => {
    const { getFetchMock } = stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    expect(wrapper.find('[data-dirty]').text()).toBe('false');

    await wrapper.find('[data-name]').setValue('変更');
    await nextTick();
    expect(wrapper.find('[data-dirty]').text()).toBe('true');

    await wrapper.find('[data-cancel]').trigger('click');
    await nextTick();
    expect(wrapper.find('[data-dirty]').text()).toBe('false');
    expect((wrapper.find('[data-name]').element as HTMLInputElement).value).toBe(
      'Demo',
    );

    await wrapper.find('[data-name]').setValue('保存名');
    await wrapper.find('[data-save]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-dirty]').text()).toBe('false');
    expect(['saved', 'clean']).toContain(wrapper.find('[data-status]').text());
    expect(getFetchMock()).toHaveBeenCalledWith(
      '/_jskim/spec/description-tree/demo/screen',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('409 conflict と保存中の重複防止', async () => {
    let patchCount = 0;
    let resolvePatch: ((value: Response) => void) | null = null;
    stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
    const baseFetch = global.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.endsWith('/screen') && method === 'PATCH') {
          patchCount += 1;
          if (patchCount === 1) {
            return new Promise<Response>((resolve) => {
              resolvePatch = resolve;
            });
          }
        }
        return baseFetch(input, init);
      }),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();
    await wrapper.find('[data-name]').setValue('x');

    const p1 = wrapper.vm.editor.saveScreenMetadata();
    const p2 = wrapper.vm.editor.saveScreenMetadata();
    expect(patchCount).toBe(1);
    resolvePatch!(
      new Response(
        JSON.stringify({
          code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
          message: '衝突',
        }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    await Promise.all([p1, p2]);
    await flushPromises();
    expect(wrapper.find('[data-status]').text()).toBe('conflict');
    expect(wrapper.find('[data-conflict]').text()).toBe(
      'SPEC_DESCRIPTION_REVISION_CONFLICT',
    );
    expect(wrapper.find('[data-dirty]').text()).toBe('true');
  });

  it('editable 時は itemId 読み取り専用・項目名を編集できる', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    });
    await router.push('/');
    await router.isReady();

    const wrapper = mount(ItemDescriptionTable, {
      props: {
        screen,
        selectedItemId: 'title',
        editable: true,
        draftItems: {
          title: {
            name: 'タイトル',
            type: 'text',
            description: '見出し',
            note: '',
          },
        },
      },
      global: { plugins: [router] },
    });

    expect(wrapper.find('.item-table__id code').text()).toBe('title');
    expect(wrapper.find('input').exists()).toBe(true);
    await wrapper.find('input').setValue('新名称');
    expect(wrapper.emitted('update-item')![0]).toEqual([
      'title',
      'name',
      '新名称',
    ]);
  });

  it('dirty 時は beforeunload を登録する', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });

    const { wrapper, root } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    root.unmount();
    expect(removeSpy).toHaveBeenCalledWith(
      'beforeunload',
      expect.any(Function),
    );
  });

  it('createItem で root 末尾に新規項目を追加する', async () => {
    const { state } = stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    const ok = await wrapper.vm.editor.createItem({
      itemId: 'new-field',
      name: '新規項目',
      type: 'text',
      description: '説明',
      note: '備考',
    });
    expect(ok.status).toBe('committed-refreshed');
    await flushPromises();
    expect(state.get('demo')?.doc.itemOrder).toEqual(['title', 'new-field']);
    expect(wrapper.vm.editor.draftDocument.value?.items['new-field']).toEqual({
      name: '新規項目',
      type: 'text',
      description: '説明',
      note: '備考',
    });
    expect(wrapper.vm.editor.dirty.value).toBe(false);
  });

  it('moveItemUp / moveItemDown で root 順序を並び替える（境界では何もしない）', async () => {
    stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        itemOrder: ['a', 'b', 'c'],
        items: {
          a: { name: '', type: '', description: '', note: '' },
          b: { name: '', type: '', description: '', note: '' },
          c: { name: '', type: '', description: '', note: '' },
        },
      }),
    });

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    expect(await wrapper.vm.editor.moveItemUp('a')).toEqual({ status: 'mutation-rejected' });
    expect(wrapper.vm.editor.flattenActiveItemIds()).toEqual(['a', 'b', 'c']);

    expect(await wrapper.vm.editor.moveItemDown('a')).toEqual({ status: 'committed-refreshed' });
    await flushPromises();
    expect(wrapper.vm.editor.flattenActiveItemIds()).toEqual(['b', 'a', 'c']);

    expect(await wrapper.vm.editor.moveItemUp('a')).toEqual({ status: 'committed-refreshed' });
    await flushPromises();
    expect(wrapper.vm.editor.flattenActiveItemIds()).toEqual(['a', 'b', 'c']);

    expect(await wrapper.vm.editor.moveItemDown('c')).toEqual({ status: 'mutation-rejected' });
  });

  it('duplicateItem は原項目の直後に挿入し、deleteItem は manual-only を削除する', async () => {
    stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        itemOrder: ['title', 'manual'],
        items: {
          title: {
            name: 'タイトル',
            type: 'text',
            description: '',
            note: '',
          },
          manual: {
            name: '手動',
            type: 'text',
            description: 'd',
            note: 'n',
          },
        },
        collectedItemIds: ['title'],
      }),
    });

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    expect(wrapper.vm.editor.isCollectedItem('title')).toBe(true);
    expect(wrapper.vm.editor.isCollectedItem('manual')).toBe(false);

    const duplicated = await wrapper.vm.editor.duplicateItem('title', {
      itemId: 'title-copy',
      name: 'タイトル',
      type: 'text',
      description: '',
      note: '',
    });
    expect(duplicated.status).toBe('committed-refreshed');
    await flushPromises();
    expect(wrapper.vm.editor.flattenActiveItemIds()).toEqual([
      'title',
      'title-copy',
      'manual',
    ]);

    expect(await wrapper.vm.editor.deleteItem('title')).toEqual({ status: 'mutation-rejected' });
    expect((await wrapper.vm.editor.deleteItem('manual')).status).toBe('committed-refreshed');
    await flushPromises();
    expect(wrapper.vm.editor.flattenActiveItemIds()).toEqual([
      'title',
      'title-copy',
    ]);
    expect(wrapper.vm.editor.draftDocument.value?.items.manual).toBeUndefined();
  });

  it('excludeItem / restoreItem は説明を保持する', async () => {
    stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        itemOrder: ['title', 'manual'],
        items: {
          title: {
            name: 'タイトル',
            type: 'text',
            description: '見出し説明',
            note: '備考',
          },
          manual: {
            name: '手動',
            type: 'text',
            description: '',
            note: '',
          },
        },
        collectedItemIds: ['title'],
      }),
    });

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    expect((await wrapper.vm.editor.excludeItem('title')).status).toBe('committed-refreshed');
    await flushPromises();
    expect(wrapper.vm.editor.draftDocument.value?.items.title).toBeUndefined();
    expect(wrapper.vm.editor.flattenActiveItemIds()).toEqual(['manual']);
    expect(wrapper.vm.editor.draftDocument.value?.excludedItems.title).toEqual({
      name: 'タイトル',
      type: 'text',
      description: '見出し説明',
      note: '備考',
    });

    expect((await wrapper.vm.editor.restoreItem('title')).status).toBe('committed-refreshed');
    await flushPromises();
    expect(wrapper.vm.editor.flattenActiveItemIds()).toEqual(['manual', 'title']);
    expect(wrapper.vm.editor.draftDocument.value?.excludedItems).toEqual({});
    expect(wrapper.vm.editor.draftDocument.value?.items.title.description).toBe(
      '見出し説明',
    );
  });

  it('exclude で MANUAL_ITEM_EXCLUDE が返ると draft を保持したままエラー表示する', async () => {
    stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        itemOrder: ['title', 'manual'],
        items: {
          title: {
            name: 'タイトル',
            type: 'text',
            description: '見出し',
            note: '',
          },
          manual: { name: '手動', type: 'text', description: '', note: '' },
        },
        collectedItemIds: ['title'],
      }),
    });

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    const ok = await wrapper.vm.editor.excludeItem('manual');
    expect(ok.status).toBe('mutation-rejected');
    expect(wrapper.vm.editor.status.value).toBe('error');
    expect(wrapper.vm.editor.statusMessage.value).toContain(
      '不要な場合は項目を削除してください',
    );
    expect(wrapper.vm.editor.draftDocument.value?.items.manual).toBeTruthy();
  });

  it('Item A 保存は PATCH A のみで Item B には触れない', async () => {
    const { getFetchMock } = stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        itemOrder: ['item-a', 'item-b'],
        items: {
          'item-a': {
            name: 'A',
            type: 'text',
            description: '',
            note: '',
          },
          'item-b': {
            name: 'B',
            type: 'text',
            description: '',
            note: '',
          },
        },
      }),
    });

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('item-a');
    wrapper.vm.editor.updateItemField('item-a', 'name', 'A変更');
    await wrapper.vm.editor.saveItemMetadata('item-a');
    await flushPromises();

    const fetchMock = getFetchMock();
    const itemPatchCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/items/item-a') &&
        (init?.method ?? 'GET').toUpperCase() === 'PATCH',
    );
    const itemBPatchCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/items/item-b') &&
        (init?.method ?? 'GET').toUpperCase() === 'PATCH',
    );
    expect(itemPatchCalls).toHaveLength(1);
    expect(itemBPatchCalls).toHaveLength(0);
  });

  it('Item A draft 中に B を編集すると B 保存は PATCH B のみ', async () => {
    const { getFetchMock } = stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        itemOrder: ['item-a', 'item-b'],
        items: {
          'item-a': {
            name: 'A',
            type: 'text',
            description: '',
            note: '',
          },
          'item-b': {
            name: 'B',
            type: 'text',
            description: '',
            note: '',
          },
        },
      }),
    });

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('item-a');
    wrapper.vm.editor.updateItemField('item-a', 'name', 'A draft');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);

    wrapper.vm.editor.beginItemEdit('item-b');
    wrapper.vm.editor.updateItemField('item-b', 'name', 'B draft');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);

    await wrapper.vm.editor.saveItemMetadata('item-b');
    await flushPromises();

    const fetchMock = getFetchMock();
    const itemAPatchCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/items/item-a') &&
        (init?.method ?? 'GET').toUpperCase() === 'PATCH',
    );
    const itemBPatchCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/items/item-b') &&
        (init?.method ?? 'GET').toUpperCase() === 'PATCH',
    );
    expect(itemAPatchCalls).toHaveLength(0);
    expect(itemBPatchCalls).toHaveLength(1);
  });

  it('Item 保存成功後も dirty な Screen draft を保持する', async () => {
    const { getFetchMock, state } = stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        itemOrder: ['title'],
        items: {
          title: {
            name: 'タイトル',
            type: 'text',
            description: '',
            note: '',
          },
        },
      }),
    });

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.updateScreenField('name', 'Screen draft');
    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', 'Item saved');

    expect(wrapper.vm.editor.screenDirty.value).toBe(true);
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);

    await wrapper.vm.editor.saveItemMetadata('title');
    await flushPromises();

    expect(wrapper.vm.editor.screenDirty.value).toBe(true);
    expect(wrapper.vm.editor.itemDirty.value).toBe(false);
    expect(wrapper.vm.editor.draftDocument.value?.screen.name).toBe('Screen draft');
    expect(wrapper.vm.editor.draftDocument.value?.items.title.name).toBe('Item saved');
    expect(wrapper.vm.editor.revision.value).not.toBe('sha256:r1');
    expect(state.get('demo')?.doc.screen.name).toBe('Demo');

    const fetchMock = getFetchMock();
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/screen') &&
          (init?.method ?? 'GET').toUpperCase() === 'PATCH',
      ),
    ).toHaveLength(0);
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/items/title') &&
          (init?.method ?? 'GET').toUpperCase() === 'PATCH',
      ),
    ).toHaveLength(1);
  });

  it('Screen 保存成功後も dirty な Item draft を保持する', async () => {
    const { getFetchMock, state } = stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        itemOrder: ['title'],
        items: {
          title: {
            name: 'タイトル',
            type: 'text',
            description: '',
            note: '',
          },
        },
      }),
    });

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.updateScreenField('name', 'Screen saved');
    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', 'Item draft');

    expect(wrapper.vm.editor.screenDirty.value).toBe(true);
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);

    await wrapper.vm.editor.saveScreenMetadata();
    await flushPromises();

    expect(wrapper.vm.editor.screenDirty.value).toBe(false);
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);
    expect(wrapper.vm.editor.draftDocument.value?.screen.name).toBe('Screen saved');
    expect(wrapper.vm.editor.draftDocument.value?.items.title.name).toBe('Item draft');
    expect(state.get('demo')?.doc.screen.name).toBe('Screen saved');
    expect(wrapper.vm.editor.revision.value).not.toBe('sha256:r1');

    const fetchMock = getFetchMock();
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/screen') &&
          (init?.method ?? 'GET').toUpperCase() === 'PATCH',
      ),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/items/title') &&
          (init?.method ?? 'GET').toUpperCase() === 'PATCH',
      ),
    ).toHaveLength(0);
  });

  it('deprecated save() は Screen と Item を順に保存し revision を引き継ぐ', async () => {
    const { getFetchMock, state } = stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        itemOrder: ['title'],
        items: {
          title: {
            name: 'タイトル',
            type: 'text',
            description: '',
            note: '',
          },
        },
      }),
    });

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.updateScreenField('name', 'Screen saved');
    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', 'Item saved');

    const ok = await wrapper.vm.editor.save();
    await flushPromises();

    expect(ok.status).toBe('committed-refreshed');
    expect(wrapper.vm.editor.dirty.value).toBe(false);
    expect(state.get('demo')?.doc.screen.name).toBe('Screen saved');
    expect(state.get('demo')?.doc.items.title.name).toBe('Item saved');

    const fetchMock = getFetchMock();
    const screenPatches = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/screen') &&
        (init?.method ?? 'GET').toUpperCase() === 'PATCH',
    );
    const itemPatches = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/items/title') &&
        (init?.method ?? 'GET').toUpperCase() === 'PATCH',
    );
    expect(screenPatches).toHaveLength(1);
    expect(itemPatches).toHaveLength(1);

    const screenBody = JSON.parse(String(screenPatches[0][1]?.body));
    const itemBody = JSON.parse(String(itemPatches[0][1]?.body));
    expect(screenBody.expectedRevision).toBe('sha256:r1');
    expect(itemBody.expectedRevision).not.toBe('sha256:r1');
  });

  it('mutation 成功後の Tree GET 失敗でも dirty draft を保持する', async () => {
    stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        itemOrder: ['title'],
        items: {
          title: {
            name: 'タイトル',
            type: 'text',
            description: '',
            note: '',
          },
        },
      }),
    });
    const baseFetch = global.fetch;
    let itemPatchDone = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/items/title') && method === 'PATCH') {
          itemPatchDone = true;
        }
        if (
          itemPatchDone &&
          method === 'GET' &&
          url.includes('/description-tree/demo')
        ) {
          return new Response('reload failed', { status: 500 });
        }
        return baseFetch(input, init);
      }),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.updateScreenField('name', 'Screen draft');
    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', 'Item draft');

    await wrapper.vm.editor.saveItemMetadata('title');
    await flushPromises();

    expect(wrapper.vm.editor.status.value).toBe('reload-failed');
    expect(wrapper.vm.editor.screenDirty.value).toBe(true);
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);
    expect(wrapper.vm.editor.draftDocument.value?.screen.name).toBe('Screen draft');
    expect(wrapper.vm.editor.draftDocument.value?.items.title.name).toBe('Item draft');
  });

  it('409 conflict 後も draft を保持し自動 retry しない', async () => {
    stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
    const baseFetch = global.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.endsWith('/screen') && method === 'PATCH') {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
              message: '衝突',
            }),
            {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        return baseFetch(input, init);
      }),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.updateScreenField('name', 'Screen draft');
    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', 'Item draft');

    const ok = await wrapper.vm.editor.saveScreenMetadata();
    await flushPromises();

    expect(ok.status).toBe('mutation-rejected');
    expect(wrapper.vm.editor.status.value).toBe('conflict');
    expect(wrapper.vm.editor.screenDirty.value).toBe(true);
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);
    expect(wrapper.vm.editor.draftDocument.value?.screen.name).toBe('Screen draft');
    expect(wrapper.vm.editor.draftDocument.value?.items.title.name).toBe('Item draft');
  });

  it('Screen 切替後は mutationPending が解除され stale 応答で B の状態を変更しない', async () => {
    let resolveScreenAPatch: (() => void) | undefined;
    stubDescriptionTreeFetch(
      {
        'screen-a': createBaseTreeDoc({
          screen: { id: 'screen-a', name: 'Screen A', description: '' },
        }),
        'screen-b': createBaseTreeDoc({
          screen: { id: 'screen-b', name: 'Screen B', description: '' },
        }),
      },
      {
        onFetch: (url, method) => {
          if (
            url.includes('/description-tree/screen-a') &&
            url.endsWith('/screen') &&
            method === 'PATCH'
          ) {
            return new Promise<Response>((resolve) => {
              resolveScreenAPatch = () => {
                resolve(
                  new Response(
                    JSON.stringify({ status: 'updated', revision: 'sha256:r2' }),
                    {
                      status: 200,
                      headers: { 'Content-Type': 'application/json' },
                    },
                  ),
                );
              };
            });
          }
          return null;
        },
      },
    );

    const SwitchableHarness = defineComponent({
      name: 'SwitchableHarness',
      setup() {
        const screenId = ref('screen-a');
        const editor = useDescriptionEditor(() => screenId.value);
        return { editor, screenId };
      },
      template: `
        <div>
          <span data-pending>{{ editor.mutationPending.value }}</span>
          <span data-revision>{{ editor.revision.value || '' }}</span>
        </div>
      `,
    });

    const router = createRouter({
      history: createMemoryHistory('/spec/'),
      routes: [
        { path: '/screens/:screenId', component: SwitchableHarness },
        { path: '/', redirect: '/screens/screen-a' },
      ],
    });
    await router.push('/screens/screen-a');
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
    const wrapper = root.findComponent(SwitchableHarness);

    await wrapper.vm.editor.loadDescription('screen-a');
    await flushPromises();
    wrapper.vm.editor.updateScreenField('name', 'A draft');
    const savePromise = wrapper.vm.editor.saveScreenMetadata();
    expect(wrapper.vm.editor.mutationPending.value).toBe(true);

    wrapper.vm.screenId = 'screen-b';
    await wrapper.vm.editor.loadDescription('screen-b', { reason: 'screen-change' });
    await flushPromises();
    expect(wrapper.vm.editor.mutationPending.value).toBe(false);

    const bRevision = wrapper.vm.editor.revision.value;
    const bSnapshotName =
      wrapper.vm.editor.draftDocument.value?.screen.name ?? '';

    if (resolveScreenAPatch) {
      resolveScreenAPatch();
    }
    await savePromise;
    await flushPromises();

    expect(wrapper.vm.editor.revision.value).toBe(bRevision);
    expect(wrapper.vm.editor.draftDocument.value?.screen.name).toBe(bSnapshotName);
    expect(wrapper.vm.editor.mutationPending.value).toBe(false);

    wrapper.vm.editor.updateScreenField('name', 'B saved');
    const ok = await wrapper.vm.editor.saveScreenMetadata();
    await flushPromises();
    expect(ok.status).toBe('committed-refreshed');
    root.unmount();
  });

  it('B mutation 中に A の finally が B の pending を解除しない', async () => {
    let resolveScreenAPatch: (() => void) | undefined;
    let resolveScreenBPatch: (() => void) | undefined;
    stubDescriptionTreeFetch(
      {
        'screen-a': createBaseTreeDoc({
          screen: { id: 'screen-a', name: 'Screen A', description: '' },
        }),
        'screen-b': createBaseTreeDoc({
          screen: { id: 'screen-b', name: 'Screen B', description: '' },
        }),
      },
      {
        onFetch: (url, method) => {
          if (
            url.includes('/description-tree/screen-a') &&
            url.endsWith('/screen') &&
            method === 'PATCH'
          ) {
            return new Promise<Response>((resolve) => {
              resolveScreenAPatch = () => {
                resolve(
                  new Response(
                    JSON.stringify({ status: 'updated', revision: 'sha256:a2' }),
                    {
                      status: 200,
                      headers: { 'Content-Type': 'application/json' },
                    },
                  ),
                );
              };
            });
          }
          if (
            url.includes('/description-tree/screen-b') &&
            url.endsWith('/screen') &&
            method === 'PATCH'
          ) {
            return new Promise<Response>((resolve) => {
              resolveScreenBPatch = () => {
                resolve(
                  new Response(
                    JSON.stringify({ status: 'updated', revision: 'sha256:b2' }),
                    {
                      status: 200,
                      headers: { 'Content-Type': 'application/json' },
                    },
                  ),
                );
              };
            });
          }
          return null;
        },
      },
    );

    const SwitchableHarness = defineComponent({
      name: 'SwitchableHarness',
      setup() {
        const screenId = ref('screen-a');
        const editor = useDescriptionEditor(() => screenId.value);
        return { editor, screenId };
      },
      template: `<span data-pending>{{ editor.mutationPending.value }}</span>`,
    });

    const router = createRouter({
      history: createMemoryHistory('/spec/'),
      routes: [
        { path: '/screens/:screenId', component: SwitchableHarness },
        { path: '/', redirect: '/screens/screen-a' },
      ],
    });
    await router.push('/screens/screen-a');
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
    const wrapper = root.findComponent(SwitchableHarness);

    await wrapper.vm.editor.loadDescription('screen-a');
    await flushPromises();
    wrapper.vm.editor.updateScreenField('name', 'A draft');
    void wrapper.vm.editor.saveScreenMetadata();

    wrapper.vm.screenId = 'screen-b';
    await wrapper.vm.editor.loadDescription('screen-b', { reason: 'screen-change' });
    await flushPromises();

    wrapper.vm.editor.updateScreenField('name', 'B draft');
    void wrapper.vm.editor.saveScreenMetadata();
    expect(wrapper.vm.editor.mutationPending.value).toBe(true);

    if (resolveScreenAPatch) {
      resolveScreenAPatch();
    }
    await flushPromises();
    expect(wrapper.vm.editor.mutationPending.value).toBe(true);

    if (resolveScreenBPatch) {
      resolveScreenBPatch();
    }
    await flushPromises();
    expect(wrapper.vm.editor.mutationPending.value).toBe(false);
    root.unmount();
  });

  it('same-target delete 後は item draft を除去する', async () => {
    const { getFetchMock } = stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        itemOrder: ['title', 'manual'],
        items: {
          title: {
            name: 'タイトル',
            type: 'text',
            description: '',
            note: '',
          },
          manual: {
            name: '手動',
            type: 'text',
            description: '',
            note: '',
          },
        },
        collectedItemIds: ['title'],
      }),
    });

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('manual');
    wrapper.vm.editor.updateItemField('manual', 'name', '手動 draft');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);

    await wrapper.vm.editor.deleteItem('manual');
    await flushPromises();

    expect(wrapper.vm.editor.itemDraftItemId.value).toBeNull();
    expect(wrapper.vm.editor.itemDraft.value).toBeNull();
    expect(wrapper.vm.editor.itemDirty.value).toBe(false);
    expect(
      getFetchMock().mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/items/manual') &&
          (init?.method ?? 'GET').toUpperCase() === 'PATCH',
      ),
    ).toHaveLength(0);
  });

  it('same-target exclude 後は item draft を除去する', async () => {
    stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        itemOrder: ['title', 'layout'],
        items: {
          title: {
            name: 'タイトル',
            type: 'text',
            description: '',
            note: '',
          },
          layout: {
            name: '枠',
            type: 'container',
            description: '',
            note: '',
          },
        },
        collectedItemIds: ['title', 'layout'],
      }),
    });

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('layout');
    wrapper.vm.editor.updateItemField('layout', 'name', '枠 draft');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);

    await wrapper.vm.editor.excludeItem('layout');
    await flushPromises();

    expect(wrapper.vm.editor.itemDraftItemId.value).toBeNull();
    expect(wrapper.vm.editor.itemDraft.value).toBeNull();
    expect(wrapper.vm.editor.itemDirty.value).toBe(false);
  });

  it('別 Item delete 後も既存 item draft を保持する', async () => {
    stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        itemOrder: ['title', 'manual'],
        items: {
          title: {
            name: 'タイトル',
            type: 'text',
            description: '',
            note: '',
          },
          manual: {
            name: '手動',
            type: 'text',
            description: '',
            note: '',
          },
        },
        collectedItemIds: ['title'],
      }),
    });

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', 'タイトル draft');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);

    await wrapper.vm.editor.deleteItem('manual');
    await flushPromises();

    expect(wrapper.vm.editor.itemDraftItemId.value).toBe('title');
    expect(wrapper.vm.editor.itemDraft.value?.name).toBe('タイトル draft');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);
  });

  it('delete 後に同 ID を restore しても過去 draft は復活しない', async () => {
    stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        itemOrder: ['title', 'manual'],
        items: {
          title: {
            name: 'タイトル',
            type: 'text',
            description: '',
            note: '',
          },
          manual: {
            name: '手動',
            type: 'text',
            description: '旧説明',
            note: '',
          },
        },
        collectedItemIds: ['title'],
      }),
    });

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('manual');
    wrapper.vm.editor.updateItemField('manual', 'name', '手動 draft');
    await wrapper.vm.editor.deleteItem('manual');
    await flushPromises();

    expect(wrapper.vm.editor.itemDraftItemId.value).toBeNull();

    await wrapper.vm.editor.createItem({
      itemId: 'manual',
      name: '手動',
      type: 'text',
      description: '旧説明',
      note: '',
    });
    await flushPromises();

    expect(wrapper.vm.editor.itemDraftItemId.value).toBeNull();
    expect(wrapper.vm.editor.itemDraft.value).toBeNull();
    expect(wrapper.vm.editor.itemDirty.value).toBe(false);
    expect(wrapper.vm.editor.draftDocument.value?.items.manual?.name).toBe('手動');
  });

  it('orphan Item（definition のみ）では hidden item draft/dirty を clear する', async () => {
    const { state } = stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        rootNodes: [{ type: 'group', id: 'parent' }],
        groups: [
          {
            groupId: 'parent',
            name: '親',
            kind: 'SECTION',
            children: [{ type: 'item', id: 'leaf' }],
          },
        ],
        itemOrder: ['leaf'],
        items: {
          leaf: {
            name: '末端',
            type: 'text',
            description: '',
            note: '',
          },
        },
        collectedItemIds: ['leaf'],
      }),
    });
    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('leaf');
    wrapper.vm.editor.updateItemField('leaf', 'name', '孤児 draft');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);

    const entry = state.get('demo')!;
    entry.revision = 'sha256:r-orphan-item';
    entry.doc.groups = [
      {
        groupId: 'parent',
        name: '親',
        kind: 'SECTION',
        children: [],
      },
    ];
    expect(entry.doc.items.leaf).toBeTruthy();

    await wrapper.vm.editor.reloadTree();
    await flushPromises();

    expect(wrapper.vm.editor.itemDraftItemId.value).toBeNull();
    expect(wrapper.vm.editor.itemDraft.value).toBeNull();
    expect(wrapper.vm.editor.itemDirty.value).toBe(false);
    expect(wrapper.vm.editor.dirty.value).toBe(false);
  });

  it('active nested Item draft は Group metadata reload 後も維持する', async () => {
    stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        rootNodes: [{ type: 'group', id: 'parent' }],
        groups: [
          {
            groupId: 'parent',
            name: '親',
            kind: 'SECTION',
            description: '親説明',
            children: [{ type: 'item', id: 'leaf' }],
          },
        ],
        itemOrder: ['leaf'],
        items: {
          leaf: {
            name: '末端',
            type: 'text',
            description: '',
            note: '',
          },
        },
        collectedItemIds: ['leaf'],
      }),
    });
    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('leaf');
    wrapper.vm.editor.updateItemField('leaf', 'name', '維持 draft');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);

    const outcome = await wrapper.vm.editor.updateGroupMetadata({
      groupId: 'parent',
      expectedRevision: wrapper.vm.editor.revision.value!,
      name: '親改名',
      kind: 'SECTION',
      description: '親説明',
    });
    await flushPromises();

    expect(outcome.status).toBe('committed-refreshed');
    expect(wrapper.vm.editor.itemDraftItemId.value).toBe('leaf');
    expect(wrapper.vm.editor.itemDraft.value?.name).toBe('維持 draft');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);
  });

  it('excluded Item へ移動した draft target を clear する', async () => {
    stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        itemOrder: ['title', 'layout'],
        items: {
          title: {
            name: 'タイトル',
            type: 'text',
            description: '',
            note: '',
          },
          layout: {
            name: '枠',
            type: 'text',
            description: '',
            note: '',
          },
        },
        collectedItemIds: ['title', 'layout'],
      }),
    });
    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('layout');
    wrapper.vm.editor.updateItemField('layout', 'name', '除外前 draft');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);

    await wrapper.vm.editor.excludeItem('layout');
    await flushPromises();

    expect(wrapper.vm.editor.itemDraftItemId.value).toBeNull();
    expect(wrapper.vm.editor.itemDraft.value).toBeNull();
    expect(wrapper.vm.editor.itemDirty.value).toBe(false);
  });

  it('reload-failed 中の cancelItemEdit / clearItemEditDraft は global status を汚さない', async () => {
    stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
    const baseFetch = global.fetch;
    let itemPatchDone = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/items/title') && method === 'PATCH') {
          itemPatchDone = true;
        }
        if (
          itemPatchDone &&
          method === 'GET' &&
          url.includes('/description-tree/demo')
        ) {
          return new Response('reload failed', { status: 500 });
        }
        return baseFetch(input, init);
      }),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', 'Item draft');
    await wrapper.vm.editor.saveItemMetadata('title');
    await flushPromises();

    expect(wrapper.vm.editor.status.value).toBe('reload-failed');
    expect(wrapper.vm.editor.reloadRequired.value).toBe(true);
    const message = wrapper.vm.editor.statusMessage.value;
    expect(message).toBeTruthy();

    wrapper.vm.editor.clearItemEditDraft();
    expect(wrapper.vm.editor.itemDraftItemId.value).toBeNull();
    expect(wrapper.vm.editor.status.value).toBe('reload-failed');
    expect(wrapper.vm.editor.reloadRequired.value).toBe(true);
    expect(wrapper.vm.editor.statusMessage.value).toBe(message);

    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', '再編集');
    wrapper.vm.editor.cancelItemEdit();
    expect(wrapper.vm.editor.itemDraftItemId.value).toBeNull();
    expect(wrapper.vm.editor.status.value).toBe('reload-failed');
    expect(wrapper.vm.editor.reloadRequired.value).toBe(true);
    expect(wrapper.vm.editor.statusMessage.value).toBe(message);
  });

  it('通常 dirty の明示的 cancelItemEdit は clean に戻す', async () => {
    stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', '取消対象');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);
    expect(wrapper.vm.editor.status.value).toBe('dirty');

    wrapper.vm.editor.cancelItemEdit();
    expect(wrapper.vm.editor.itemDraftItemId.value).toBeNull();
    expect(wrapper.vm.editor.itemDirty.value).toBe(false);
    expect(wrapper.vm.editor.status.value).toBe('clean');
    expect(wrapper.vm.editor.reloadRequired.value).toBe(false);
  });

  it('A: conflict recovery 成功で Item draft を authoritative 値へ置換する', async () => {
    const { state } = stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
    const baseFetch = global.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/items/title') && method === 'PATCH') {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
              message: '他の変更と衝突しました。',
            }),
            {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        return baseFetch(input, init);
      }),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', '草案名称');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);

    const entry = state.get('demo')!;
    entry.doc.items.title.name = 'サーバ側更新';
    entry.revision = 'sha256:r-server';

    const outcome = await wrapper.vm.editor.saveItemMetadata('title');
    await flushPromises();
    expect(outcome.status).toBe('mutation-rejected');
    expect(wrapper.vm.editor.status.value).toBe('conflict');
    expect(wrapper.vm.editor.itemDraft.value?.name).toBe('草案名称');

    const target = wrapper.vm.editor.captureConflictItemRecoveryTarget();
    expect(target).toBeTruthy();
    await wrapper.vm.editor.reloadConflictedItemLatest(target!);
    await flushPromises();

    expect(wrapper.vm.editor.status.value).toBe('clean');
    expect(wrapper.vm.editor.conflictError.value).toBeNull();
    expect(wrapper.vm.editor.itemDraftItemId.value).toBe('title');
    expect(wrapper.vm.editor.itemDraft.value?.name).toBe('サーバ側更新');
    expect(wrapper.vm.editor.itemDirty.value).toBe(false);
    expect(wrapper.vm.editor.revision.value).toBe('sha256:r-server');
  });

  it('B: conflict recovery GET 失敗では stale draft と conflict UI を維持する', async () => {
    const { state } = stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
    const baseFetch = global.fetch;
    let failNextTreeGet = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/items/title') && method === 'PATCH') {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
              message: '衝突',
            }),
            {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        if (
          failNextTreeGet &&
          method === 'GET' &&
          url.includes('/description-tree/demo') &&
          !url.includes('/items/')
        ) {
          failNextTreeGet = false;
          return new Response('reload failed', { status: 500 });
        }
        return baseFetch(input, init);
      }),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', '草案名称');
    state.get('demo')!.doc.items.title.name = 'サーバ側更新';
    state.get('demo')!.revision = 'sha256:r-server';
    await wrapper.vm.editor.saveItemMetadata('title');
    await flushPromises();
    expect(wrapper.vm.editor.status.value).toBe('conflict');

    failNextTreeGet = true;
    const target = wrapper.vm.editor.captureConflictItemRecoveryTarget();
    expect(target).toBeTruthy();
    await wrapper.vm.editor.reloadConflictedItemLatest(target!);
    await flushPromises();

    expect(wrapper.vm.editor.status.value).toBe('conflict');
    expect(wrapper.vm.editor.itemDraft.value?.name).toBe('草案名称');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);
    expect(wrapper.vm.editor.unresolvedItemConflict.value).toBe(true);
  });

  it('C: recovery 成功後 target absent なら draft/selection target を clear する', async () => {
    const { state } = stubDescriptionTreeFetch({
      demo: createBaseTreeDoc({
        rootNodes: [{ type: 'item', id: 'title' }],
        itemOrder: ['title'],
      }),
    });
    const baseFetch = global.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/items/title') && method === 'PATCH') {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
              message: '衝突',
            }),
            {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        return baseFetch(input, init);
      }),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', '草案名称');
    await wrapper.vm.editor.saveItemMetadata('title');
    await flushPromises();

    const entry = state.get('demo')!;
    entry.revision = 'sha256:r-gone';
    entry.doc.rootNodes = [];
    entry.doc.itemOrder = [];
    delete entry.doc.items.title;

    const target = wrapper.vm.editor.captureConflictItemRecoveryTarget();
    expect(target).toBeTruthy();
    await wrapper.vm.editor.reloadConflictedItemLatest(target!);
    await flushPromises();

    expect(wrapper.vm.editor.itemDraftItemId.value).toBeNull();
    expect(wrapper.vm.editor.itemDraft.value).toBeNull();
    expect(wrapper.vm.editor.conflictError.value).toBeNull();
    expect(wrapper.vm.editor.statusMessage.value).toContain(
      '対象の項目が見つからない',
    );
  });

  it('D: 一般 same-screen reload は dirty Item draft を保持する', async () => {
    stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', '維持したい草案');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);

    await wrapper.vm.editor.reloadLatest();
    await flushPromises();

    expect(wrapper.vm.editor.itemDraft.value?.name).toBe('維持したい草案');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);
  });

  it('F: Screen 切替後の stale conflict recovery は新 Screen を壊さない', async () => {
    const { state } = stubDescriptionTreeFetch({
      demo: createBaseTreeDoc(),
      other: createBaseTreeDoc({
        screen: { id: 'other', name: 'Other', description: '' },
        items: {
          title: {
            name: '他画面項目',
            type: 'text',
            description: '',
            note: '',
          },
        },
      }),
    });
    let releaseRecoveryGet!: () => void;
    const recoveryGetGate = new Promise<void>((resolve) => {
      releaseRecoveryGet = resolve;
    });
    const baseFetch = global.fetch;
    let blockNextTreeGet = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/items/title') && method === 'PATCH') {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
              message: '衝突',
            }),
            {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        if (
          blockNextTreeGet &&
          method === 'GET' &&
          url.includes('/description-tree/demo') &&
          !url.includes('/items/')
        ) {
          blockNextTreeGet = false;
          await recoveryGetGate;
        }
        return baseFetch(input, init);
      }),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', '草案名称');
    state.get('demo')!.doc.items.title.name = 'サーバ側更新';
    state.get('demo')!.revision = 'sha256:r-server';
    await wrapper.vm.editor.saveItemMetadata('title');
    await flushPromises();
    expect(wrapper.vm.editor.status.value).toBe('conflict');

    blockNextTreeGet = true;
    const target = wrapper.vm.editor.captureConflictItemRecoveryTarget();
    expect(target).toBeTruthy();
    const pendingReload = wrapper.vm.editor.reloadConflictedItemLatest(target!);
    await flushPromises();

    wrapper.vm.screenId = 'other';
    await wrapper.vm.editor.loadDescription('other', { reason: 'screen-change' });
    await flushPromises();
    expect(wrapper.vm.editor.revision.value).toBe('sha256:r1');
    expect(wrapper.vm.editor.itemDraftItemId.value).toBeNull();

    releaseRecoveryGet();
    await pendingReload;
    await flushPromises();

    expect(wrapper.vm.screenId).toBe('other');
    expect(wrapper.vm.editor.revision.value).toBe('sha256:r1');
    expect(wrapper.vm.editor.status.value).not.toBe('conflict');
    expect(wrapper.vm.editor.itemDraft.value?.name).not.toBe('サーバ側更新');
  });

  it('G: same Item 新 lifecycle 中の stale recovery は新 draft を壊さない', async () => {
    const { state } = stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
    let releaseRecoveryGet!: () => void;
    const recoveryGetGate = new Promise<void>((resolve) => {
      releaseRecoveryGet = resolve;
    });
    const baseFetch = global.fetch;
    let blockNextTreeGet = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/items/title') && method === 'PATCH') {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
              message: '衝突',
            }),
            {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        if (
          blockNextTreeGet &&
          method === 'GET' &&
          url.includes('/description-tree/demo') &&
          !url.includes('/items/')
        ) {
          blockNextTreeGet = false;
          await recoveryGetGate;
        }
        return baseFetch(input, init);
      }),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', '草案名称');
    state.get('demo')!.doc.items.title.name = 'サーバ側更新';
    state.get('demo')!.revision = 'sha256:r-server';
    await wrapper.vm.editor.saveItemMetadata('title');
    await flushPromises();

    blockNextTreeGet = true;
    const target = wrapper.vm.editor.captureConflictItemRecoveryTarget();
    expect(target).toBeTruthy();
    const pendingReload = wrapper.vm.editor.reloadConflictedItemLatest(target!);
    await flushPromises();

    // lifecycle 無効化後に同 Item を新規編集
    wrapper.vm.editor.cancel();
    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', '新しい編集');
    expect(wrapper.vm.editor.itemDraft.value?.name).toBe('新しい編集');

    releaseRecoveryGet();
    await pendingReload;
    await flushPromises();

    expect(wrapper.vm.editor.itemDraft.value?.name).toBe('新しい編集');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);
  });

  it('A2: conflict 中の generic reloadLatest は draft 置換も conflict 解除もしない', async () => {
    const { state } = stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
    const baseFetch = global.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/items/title') && method === 'PATCH') {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
              message: '衝突',
            }),
            {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        return baseFetch(input, init);
      }),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', '草案名称');
    state.get('demo')!.doc.items.title.name = 'サーバ側更新';
    state.get('demo')!.revision = 'sha256:r-server';
    await wrapper.vm.editor.saveItemMetadata('title');
    await flushPromises();
    expect(wrapper.vm.editor.status.value).toBe('conflict');
    expect(wrapper.vm.editor.unresolvedItemConflict.value).toBe(true);

    await wrapper.vm.editor.reloadLatest();
    await flushPromises();

    expect(wrapper.vm.editor.status.value).toBe('conflict');
    expect(wrapper.vm.editor.itemDraft.value?.name).toBe('草案名称');
    expect(wrapper.vm.editor.itemDirty.value).toBe(true);
    expect(wrapper.vm.editor.revision.value).toBe('sha256:r-server');
    expect(wrapper.vm.editor.unresolvedItemConflict.value).toBe(true);

    const blocked = await wrapper.vm.editor.saveItemMetadata('title');
    expect(blocked.status).toBe('mutation-rejected');
    const patchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/items/title') &&
        (init?.method ?? 'GET').toUpperCase() === 'PATCH',
    );
    expect(patchCalls).toHaveLength(1);
  });

  it('A/B: duplicate missing source は conflict capability を壊さず Save/PATCH を遮断する', async () => {
    const { state } = stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
    const baseFetch = global.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/items/title') && method === 'PATCH') {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
              message: '衝突',
            }),
            {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        return baseFetch(input, init);
      }),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', '草案名称');
    state.get('demo')!.doc.items.title.name = 'サーバ側更新';
    state.get('demo')!.revision = 'sha256:r-server';
    await wrapper.vm.editor.saveItemMetadata('title');
    await flushPromises();

    const conflictMessage = wrapper.vm.editor.statusMessage.value;
    expect(wrapper.vm.editor.status.value).toBe('conflict');
    expect(wrapper.vm.editor.unresolvedItemConflict.value).toBe(true);
    expect(wrapper.vm.editor.captureConflictItemRecoveryTarget()?.itemId).toBe(
      'title',
    );

    const dupOutcome = await wrapper.vm.editor.duplicateItem('missing-item', {
      itemId: 'copy-1',
      name: '複製',
      type: 'text',
      description: '',
      note: '',
    });
    await flushPromises();

    expect(dupOutcome.status).toBe('mutation-rejected');
    expect(wrapper.vm.editor.status.value).toBe('conflict');
    expect(wrapper.vm.editor.statusMessage.value).toBe(conflictMessage);
    expect(wrapper.vm.editor.unresolvedItemConflict.value).toBe(true);
    expect(wrapper.vm.editor.captureConflictItemRecoveryTarget()?.itemId).toBe(
      'title',
    );
    expect(wrapper.vm.editor.itemDraft.value?.name).toBe('草案名称');

    const saveOutcome = await wrapper.vm.editor.saveItemMetadata('title');
    expect(saveOutcome.status).toBe('mutation-rejected');
    const patchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/items/title') &&
        (init?.method ?? 'GET').toUpperCase() === 'PATCH',
    );
    expect(patchCalls).toHaveLength(1);
    const createCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/items') &&
        (init?.method ?? 'GET').toUpperCase() === 'POST' &&
        !String(url).includes('/delete') &&
        !String(url).includes('/exclude'),
    );
    expect(createCalls).toHaveLength(0);
  });

  it('C: delete missing target も conflict capability を壊さない', async () => {
    const { state } = stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
    const baseFetch = global.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/items/title') && method === 'PATCH') {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
              message: '衝突',
            }),
            {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        return baseFetch(input, init);
      }),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', '草案名称');
    state.get('demo')!.doc.items.title.name = 'サーバ側更新';
    state.get('demo')!.revision = 'sha256:r-server';
    await wrapper.vm.editor.saveItemMetadata('title');
    await flushPromises();
    const conflictMessage = wrapper.vm.editor.statusMessage.value;

    const deleteOutcome = await wrapper.vm.editor.deleteItem('missing-item');
    await flushPromises();

    expect(deleteOutcome.status).toBe('mutation-rejected');
    expect(wrapper.vm.editor.status.value).toBe('conflict');
    expect(wrapper.vm.editor.statusMessage.value).toBe(conflictMessage);
    expect(wrapper.vm.editor.unresolvedItemConflict.value).toBe(true);
    expect(wrapper.vm.editor.captureConflictItemRecoveryTarget()?.itemId).toBe(
      'title',
    );
    const deleteCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/delete') &&
        (init?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('D: capability は status ではなく recovery target を SoT にする', async () => {
    const { state } = stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
    const baseFetch = global.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/items/title') && method === 'PATCH') {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
              message: '衝突',
            }),
            {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        return baseFetch(input, init);
      }),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', '草案名称');
    state.get('demo')!.doc.items.title.name = 'サーバ側更新';
    state.get('demo')!.revision = 'sha256:r-server';
    await wrapper.vm.editor.saveItemMetadata('title');
    await flushPromises();

    // production event: invalid mutation は status を書き換えない（先行 guard）
    await wrapper.vm.editor.duplicateItem('missing', {
      itemId: 'x',
      name: 'x',
      type: 'text',
      description: '',
      note: '',
    });
    expect(wrapper.vm.editor.unresolvedItemConflict.value).toBe(true);
    expect(wrapper.vm.editor.captureConflictItemRecoveryTarget()).toBeTruthy();
  });

  it('reloadAfterFailure は statusMessage を空にしても unresolved capability を維持する', async () => {
    const { state } = stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
    const baseFetch = global.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/items/title') && method === 'PATCH') {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
              message: '衝突',
            }),
            {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        return baseFetch(input, init);
      }),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.beginItemEdit('title');
    wrapper.vm.editor.updateItemField('title', 'name', '草案名称');
    state.get('demo')!.doc.items.title.name = 'サーバ側更新';
    state.get('demo')!.revision = 'sha256:r-server';
    await wrapper.vm.editor.saveItemMetadata('title');
    await flushPromises();
    expect(wrapper.vm.editor.unresolvedItemConflict.value).toBe(true);

    await wrapper.vm.editor.reloadAfterFailure();
    await flushPromises();

    expect(wrapper.vm.editor.statusMessage.value).toBe('');
    expect(['dirty', 'clean']).toContain(wrapper.vm.editor.status.value);
    expect(wrapper.vm.editor.unresolvedItemConflict.value).toBe(true);
    expect(wrapper.vm.editor.captureConflictItemRecoveryTarget()?.itemId).toBe(
      'title',
    );
    expect(wrapper.vm.editor.itemDraft.value?.name).toBe('草案名称');

    const blocked = await wrapper.vm.editor.saveItemMetadata('title');
    expect(blocked.status).toBe('mutation-rejected');
  });
});
