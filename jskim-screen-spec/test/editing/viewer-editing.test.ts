import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { useDescriptionEditor } from '../../src/viewer/editing/useDescriptionEditor';
import ItemDescriptionTable from '../../src/viewer/components/ItemDescriptionTable.vue';
import type { ScreenData } from '../../src/viewer/types';

const baseDocument = {
  schemaVersion: '1.2',
  screen: { id: 'demo', name: 'Demo', description: '説明' },
  itemOrder: ['title'],
  excludedItems: {},
  items: {
    title: {
      name: 'タイトル',
      type: 'text',
      description: '見出し',
      note: '',
    },
  },
};

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
      <button data-save type="button" @click="editor.save()">save</button>
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
    vi.restoreAllMocks();
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
    const fetchMock = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      if (!init || init.method === 'GET' || !init.method) {
        return new Response(
          JSON.stringify({
            screenId: 'demo',
            revision: 'sha256:r1',
            exists: true,
            document: baseDocument,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          screenId: 'demo',
          revision: 'sha256:r2',
          saved: true,
          written: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

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
    // 保存成功後は dirty=false により clean（UI 上は「保存済み」）
    expect(['saved', 'clean']).toContain(wrapper.find('[data-status]').text());
    expect(fetchMock).toHaveBeenCalledWith(
      '/_jskim/spec/descriptions/demo',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('409 conflict と保存中の重複防止', async () => {
    let putCount = 0;
    let resolvePut: ((value: Response) => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
        if (!init || init.method === 'GET' || !init.method) {
          return new Response(
            JSON.stringify({
              screenId: 'demo',
              revision: 'sha256:r1',
              exists: true,
              document: baseDocument,
            }),
            { status: 200 },
          );
        }
        putCount += 1;
        if (putCount === 1) {
          return new Promise((resolve) => {
            resolvePut = resolve;
          });
        }
        return new Response('should-not', { status: 500 });
      }),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();
    await wrapper.find('[data-name]').setValue('x');

    const p1 = wrapper.vm.editor.save();
    const p2 = wrapper.vm.editor.save();
    expect(putCount).toBe(1);
    resolvePut!(
      new Response(
        JSON.stringify({
          code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
          message: '衝突',
        }),
        { status: 409 },
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
        selectedItemId: null,
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            screenId: 'demo',
            revision: 'sha256:r1',
            exists: true,
            document: baseDocument,
          }),
          { status: 200 },
        ),
      ),
    );

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

  it('addItem で itemOrder 末尾に新規項目を追加する（重複は無視）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            screenId: 'demo',
            revision: 'sha256:r1',
            exists: true,
            document: baseDocument,
          }),
          { status: 200 },
        ),
      ),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    const added = wrapper.vm.editor.addItem({
      itemId: 'new-field',
      name: '新規項目',
      type: 'text',
      description: '説明',
      note: '備考',
    });
    expect(added).toBe(true);
    expect(wrapper.vm.editor.draftDocument.value?.itemOrder).toEqual([
      'title',
      'new-field',
    ]);
    expect(wrapper.vm.editor.draftDocument.value?.items['new-field']).toEqual({
      name: '新規項目',
      type: 'text',
      description: '説明',
      note: '備考',
    });
    expect(wrapper.vm.editor.dirty.value).toBe(true);

    const dup = wrapper.vm.editor.addItem({
      itemId: 'title',
      name: '重複',
      type: 'text',
      description: '',
      note: '',
    });
    expect(dup).toBe(false);
    expect(wrapper.vm.editor.draftDocument.value?.itemOrder).toEqual([
      'title',
      'new-field',
    ]);
  });

  it('moveItemUp / moveItemDown で itemOrder を並び替える（境界では何もしない）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            screenId: 'demo',
            revision: 'sha256:r1',
            exists: true,
            document: {
              ...baseDocument,
              itemOrder: ['a', 'b', 'c'],
              items: {
                a: { name: '', type: '', description: '', note: '' },
                b: { name: '', type: '', description: '', note: '' },
                c: { name: '', type: '', description: '', note: '' },
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    wrapper.vm.editor.moveItemUp('a');
    expect(wrapper.vm.editor.draftDocument.value?.itemOrder).toEqual([
      'a',
      'b',
      'c',
    ]);

    wrapper.vm.editor.moveItemDown('a');
    expect(wrapper.vm.editor.draftDocument.value?.itemOrder).toEqual([
      'b',
      'a',
      'c',
    ]);

    wrapper.vm.editor.moveItemUp('a');
    expect(wrapper.vm.editor.draftDocument.value?.itemOrder).toEqual([
      'a',
      'b',
      'c',
    ]);

    wrapper.vm.editor.moveItemDown('c');
    expect(wrapper.vm.editor.draftDocument.value?.itemOrder).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('duplicateItem は原項目の直後に挿入し、removeItem は manual-only のみ削除する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            screenId: 'demo',
            revision: 'sha256:r1',
            exists: true,
            document: {
              ...baseDocument,
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
            },
            collectedItemIds: ['title'],
          }),
          { status: 200 },
        ),
      ),
    );

    const { wrapper } = await mountEditor();
    await wrapper.vm.editor.loadDescription('demo');
    await flushPromises();

    expect(wrapper.vm.editor.isCollectedItem('title')).toBe(true);
    expect(wrapper.vm.editor.isCollectedItem('manual')).toBe(false);

    const duplicated = wrapper.vm.editor.duplicateItem('title', {
      itemId: 'title-copy',
      name: 'タイトル',
      type: 'text',
      description: '',
      note: '',
    });
    expect(duplicated).toBe(true);
    expect(wrapper.vm.editor.draftDocument.value?.itemOrder).toEqual([
      'title',
      'title-copy',
      'manual',
    ]);

    expect(wrapper.vm.editor.removeItem('title')).toBe(false);
    expect(wrapper.vm.editor.removeItem('manual')).toBe(true);
    expect(wrapper.vm.editor.draftDocument.value?.itemOrder).toEqual([
      'title',
      'title-copy',
    ]);
    expect(wrapper.vm.editor.draftDocument.value?.items.manual).toBeUndefined();
    expect(wrapper.vm.editor.dirty.value).toBe(true);
  });
});
