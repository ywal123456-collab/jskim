import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ScreenSpecPage from '../../src/viewer/pages/ScreenSpecPage.vue';
import DomPreview from '../../src/viewer/components/DomPreview.vue';
import type { ManifestScreen, ScreenData, ViewerManifest } from '../../src/viewer/types';

const designOnlyManifestScreen: ManifestScreen = {
  id: 'design-screen',
  name: '設計のみ画面',
  path: '',
  dataFile: 'screens/design-screen.json',
  status: 'design-only',
  hasDescription: true,
  hasImplementation: false,
  hasPreview: false,
};

const designOnlyScreen: ScreenData = {
  id: 'design-screen',
  name: '設計のみ画面',
  description: '設計だけの画面です。',
  path: '',
  itemOrder: ['title'],
  items: {
    title: { name: 'タイトル', type: 'text', description: '', note: '' },
  },
  states: [],
  interactions: [],
  status: 'design-only',
  hasDescription: true,
  hasImplementation: false,
  hasPreview: false,
};

const implOnlyManifestScreen: ManifestScreen = {
  id: 'impl-screen',
  name: '実装のみ画面',
  path: '/impl.html',
  dataFile: 'screens/impl-screen.json',
  status: 'implementation-only',
  hasDescription: false,
  hasImplementation: true,
  hasPreview: true,
};

const implOnlyScreen: ScreenData = {
  id: 'impl-screen',
  name: '実装のみ画面',
  description: '',
  path: '/impl.html',
  itemOrder: [],
  items: {},
  states: [
    {
      id: 'default',
      name: '初期',
      viewer: { visible: true, order: 1 },
      snapshotFile: 'snapshots/impl-screen/default.html',
    },
  ],
  interactions: [],
  status: 'implementation-only',
  hasDescription: false,
  hasImplementation: true,
  hasPreview: true,
};

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

function mockFetchFor(
  screens: Record<string, ScreenData>,
  snapshots: Record<string, string> = {},
  description?: Record<string, unknown>,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (
        description &&
        url.includes('/_jskim/spec/descriptions/') &&
        (!init || init.method === 'GET' || !init.method)
      ) {
        return jsonResponse(description);
      }
      for (const [dataFile, data] of Object.entries(screens)) {
        if (url.endsWith(`/data/screens/${dataFile}.json`)) {
          return jsonResponse(data);
        }
      }
      for (const [snapshotFile, html] of Object.entries(snapshots)) {
        if (url.endsWith(`/data/snapshots/${snapshotFile}`)) {
          return textResponse(html);
        }
      }
      if (url.endsWith('/data/theme/preview.css')) {
        return textResponse('/* preview */');
      }
      return new Response('not found', { status: 404 });
    }),
  );
}

async function mountPage(options: {
  screenId: string;
  manifestScreens: ManifestScreen[];
  editingEnabled?: boolean;
  openCreateScreen?: () => void;
}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/screens/:screenId', component: ScreenSpecPage, props: true }],
  });
  await router.push(`/screens/${options.screenId}`);
  await router.isReady();

  const manifest = computed<ViewerManifest>(() => ({
    schemaVersion: '1',
    projectName: 'sample',
    base: '/spec/',
    screens: options.manifestScreens,
  }));

  const wrapper = mount(
    { template: '<router-view />' },
    {
      global: {
        plugins: [router],
        provide: {
          manifest,
          editingEnabled: options.editingEnabled ?? false,
          openCreateScreen: options.openCreateScreen ?? (() => {}),
        },
      },
    },
  );
  await flushPromises();
  return wrapper;
}

describe('ScreenSpecPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as { __JSKIM_SPEC_EDIT__?: unknown }).__JSKIM_SPEC_EDIT__;
  });

  it('design-only（hasPreview=false, states=[]）は No Preview を表示し StateSelector を隠す', async () => {
    mockFetchFor({ 'design-screen': designOnlyScreen });
    const wrapper = await mountPage({
      screenId: 'design-screen',
      manifestScreens: [designOnlyManifestScreen],
    });

    expect(wrapper.find('[data-testid="no-preview"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('この画面はまだ実装画面と連携されていません。');
    expect(wrapper.text()).toContain('jskim spec collect');
    expect(wrapper.find('.state-selector').exists()).toBe(false);
    expect(wrapper.find('.spec-page__status-badge').text()).toBe('設計のみ');
    expect(wrapper.findComponent(DomPreview).exists()).toBe(false);
  });

  it('implementation-only（hasPreview=true）は StateSelector と DomPreview を表示する', async () => {
    mockFetchFor(
      { 'impl-screen': implOnlyScreen },
      { 'impl-screen/default.html': '<div>impl</div>' },
    );
    const wrapper = await mountPage({
      screenId: 'impl-screen',
      manifestScreens: [implOnlyManifestScreen],
    });

    expect(wrapper.find('[data-testid="no-preview"]').exists()).toBe(false);
    expect(wrapper.find('.state-selector').exists()).toBe(true);
    expect(wrapper.find('.spec-page__status-badge').text()).toBe('実装のみ');
  });

  it('_empty かつ編集可能なら作成 button を含む空状態を表示する', async () => {
    const openCreateScreen = vi.fn();
    const wrapper = await mountPage({
      screenId: '_empty',
      manifestScreens: [],
      editingEnabled: true,
      openCreateScreen,
    });

    expect(wrapper.text()).toContain('画面を作成');
    const button = wrapper.find('.spec-page--empty button');
    expect(button.exists()).toBe(true);
    await button.trigger('click');
    expect(openCreateScreen).toHaveBeenCalledTimes(1);
  });

  it('_empty かつ読み取り専用なら「表示できる画面がありません。」のみ表示する', async () => {
    const wrapper = await mountPage({
      screenId: '_empty',
      manifestScreens: [],
      editingEnabled: false,
    });

    expect(wrapper.text()).toContain('表示できる画面がありません。');
    expect(wrapper.find('.spec-page--empty button').exists()).toBe(false);
  });

  it('編集モードで項目を追加し、上下ボタンで並び替えられる', async () => {
    window.__JSKIM_SPEC_EDIT__ = {
      enabled: true,
      apiBase: '/_jskim/spec/descriptions',
    };
    mockFetchFor(
      { 'design-screen': designOnlyScreen },
      {},
      {
        screenId: 'design-screen',
        revision: 'sha256:r1',
        exists: true,
        document: {
          schemaVersion: '1.1',
          screen: {
            id: 'design-screen',
            name: '設計のみ画面',
            description: '設計だけの画面です。',
          },
          itemOrder: ['title'],
          items: {
            title: { name: 'タイトル', type: 'text', description: '', note: '' },
          },
        },
      },
    );
    const wrapper = await mountPage({
      screenId: 'design-screen',
      manifestScreens: [designOnlyManifestScreen],
      editingEnabled: true,
    });

    expect(wrapper.find('.spec-page__section-header button').exists()).toBe(
      true,
    );
    await wrapper.find('.spec-page__section-header button').trigger('click');
    await flushPromises();

    await wrapper.find('[data-field="item-id"]').setValue('submit-button');
    await wrapper.find('[data-field="item-name"]').setValue('送信ボタン');
    await wrapper.find('[data-field="item-type"]').setValue('button');
    await wrapper.find('.create-screen-dialog form').trigger('submit');
    await flushPromises();

    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[1].findAll('td')[1].text()).toContain('submit-button');
    const nameInput = rows[1].find('td:nth-child(3) input')
      .element as HTMLInputElement;
    expect(nameInput.value).toBe('送信ボタン');

    await rows[1].find('[aria-label="上へ"]').trigger('click');
    await flushPromises();

    const reordered = wrapper.findAll('tbody tr');
    expect(reordered[0].findAll('td')[1].text()).toContain('submit-button');
    expect(reordered[1].findAll('td')[1].text()).toContain('title');
  });

  it('編集モードで collected 項目を除外すると Badge が消え、復元で戻る', async () => {
    window.__JSKIM_SPEC_EDIT__ = {
      enabled: true,
      apiBase: '/_jskim/spec/descriptions',
    };
    const linkedManifest: ManifestScreen = {
      id: 'linked-screen',
      name: '連携画面',
      path: '/linked.html',
      dataFile: 'screens/linked-screen.json',
      status: 'linked',
      hasDescription: true,
      hasImplementation: true,
      hasPreview: true,
    };
    const linkedScreen: ScreenData = {
      id: 'linked-screen',
      name: '連携画面',
      description: '',
      path: '/linked.html',
      itemOrder: ['title', 'layout'],
      items: {
        title: { name: 'タイトル', type: 'text', description: '', note: '' },
        layout: { name: '枠', type: 'container', description: '説明保持', note: '' },
      },
      states: [
        {
          id: 'default',
          name: '初期',
          viewer: { visible: true, order: 1 },
          snapshotFile: 'snapshots/linked-screen/default.html',
        },
      ],
      interactions: [],
      status: 'linked',
      hasDescription: true,
      hasImplementation: true,
      hasPreview: true,
    };

    mockFetchFor(
      { 'linked-screen': linkedScreen },
      {
        'linked-screen/default.html':
          '<div data-jskim-spec-item="title">t</div><div data-jskim-spec-item="layout">l</div>',
      },
      {
        screenId: 'linked-screen',
        revision: 'sha256:r1',
        exists: true,
        document: {
          schemaVersion: '1.2',
          screen: { id: 'linked-screen', name: '連携画面', description: '' },
          itemOrder: ['title', 'layout'],
          items: {
            title: { name: 'タイトル', type: 'text', description: '', note: '' },
            layout: {
              name: '枠',
              type: 'container',
              description: '説明保持',
              note: '',
            },
          },
          excludedItems: {},
        },
        collectedItemIds: ['title', 'layout'],
      },
    );

    const wrapper = await mountPage({
      screenId: 'linked-screen',
      manifestScreens: [linkedManifest],
      editingEnabled: true,
    });
    await flushPromises();

    const preview = wrapper.findComponent(DomPreview);
    expect(preview.exists()).toBe(true);
    await flushPromises();
    const shadowBefore = (preview.element as HTMLElement).shadowRoot!;
    expect(shadowBefore.querySelectorAll('.spec-badge')).toHaveLength(2);

    const layoutRow = wrapper.find('#item-row-layout');
    expect(layoutRow.exists()).toBe(true);
    await layoutRow.find('[aria-label="設計対象から除外"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('項目を設計対象から除外しますか？');
    await wrapper.find('[data-action="confirm-exclude"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('#item-row-layout').exists()).toBe(false);
    expect(wrapper.find('.excluded-items-panel__toggle').text()).toContain(
      '除外した項目（1）',
    );
    expect(wrapper.find('.spec-page__status').attributes('data-status')).toBe(
      'dirty',
    );

    await flushPromises();
    const shadowAfterExclude = (preview.element as HTMLElement).shadowRoot!;
    expect(shadowAfterExclude.querySelectorAll('.spec-badge')).toHaveLength(1);
    expect(
      shadowAfterExclude.querySelector('[data-jskim-spec-item="layout"] .spec-badge'),
    ).toBeNull();

    await wrapper.find('.excluded-items-panel__toggle').trigger('click');
    expect(wrapper.text()).toContain('実装あり');
    // 折りたたみ一覧では説明 field を編集しないが、項目名は表示する
    expect(wrapper.find('#excluded-item-row-layout').text()).toContain('枠');

    await wrapper
      .find('[aria-label="設計対象に戻す: layout"]')
      .trigger('click');
    await flushPromises();

    expect(wrapper.find('#item-row-layout').exists()).toBe(true);
    expect(wrapper.find('.excluded-items-panel').exists()).toBe(false);
    await flushPromises();
    const shadowAfterRestore = (preview.element as HTMLElement).shadowRoot!;
    expect(shadowAfterRestore.querySelectorAll('.spec-badge')).toHaveLength(2);
  });

  it('読み取り専用では除外 UI / 除外領域を出さない', async () => {
    const linkedManifest: ManifestScreen = {
      id: 'linked-ro',
      name: '連携',
      path: '/x.html',
      dataFile: 'screens/linked-ro.json',
      status: 'linked',
      hasDescription: true,
      hasImplementation: true,
      hasPreview: true,
    };
    const linkedScreen: ScreenData = {
      id: 'linked-ro',
      name: '連携',
      description: '',
      path: '/x.html',
      itemOrder: ['title'],
      items: {
        title: { name: 'T', type: 'text', description: '', note: '' },
      },
      states: [
        {
          id: 'default',
          name: '初期',
          viewer: { visible: true, order: 1 },
          snapshotFile: 'snapshots/linked-ro/default.html',
        },
      ],
      interactions: [],
      status: 'linked',
      hasDescription: true,
      hasImplementation: true,
      hasPreview: true,
    };
    mockFetchFor(
      { 'linked-ro': linkedScreen },
      { 'linked-ro/default.html': '<div data-jskim-spec-item="title">t</div>' },
    );
    const wrapper = await mountPage({
      screenId: 'linked-ro',
      manifestScreens: [linkedManifest],
      editingEnabled: false,
    });
    expect(wrapper.find('[aria-label="設計対象から除外"]').exists()).toBe(false);
    expect(wrapper.find('.excluded-items-panel').exists()).toBe(false);
  });
});
