import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import ScreenSpecPage from '../../src/viewer/pages/ScreenSpecPage.vue';
import CreateItemDialog from '../../src/viewer/components/CreateItemDialog.vue';
import DeleteItemDialog from '../../src/viewer/components/DeleteItemDialog.vue';
import DuplicateItemDialog from '../../src/viewer/components/DuplicateItemDialog.vue';
import ExcludeItemDialog from '../../src/viewer/components/ExcludeItemDialog.vue';
import { useDescriptionEditor } from '../../src/viewer/editing/useDescriptionEditor';
import type { DescriptionMutationOutcome } from '../../src/viewer/editing/useDescriptionEditor';
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

const linkedManifest: ManifestScreen = {
  id: 'linked-dialog',
  name: 'Dialog テスト',
  path: '/linked-dialog.html',
  dataFile: 'screens/linked-dialog.json',
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

const linkedScreen: ScreenData = {
  id: 'linked-dialog',
  name: 'Dialog テスト',
  description: '',
  path: '/linked-dialog.html',
  itemOrder: ['title', 'manual'],
  items: {
    title: { name: 'タイトル', type: 'text', description: '', note: '' },
    manual: { name: '手動', type: 'text', description: '', note: '' },
  },
  states: [
    {
      id: 'default',
      name: '初期',
      viewer: { visible: true, order: 1 },
      snapshotFile: 'snapshots/linked-dialog/default.html',
    },
  ],
  interactions: [],
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

function createLinkedTreeDoc(): MockTreeDoc {
  return {
    screen: { id: 'linked-dialog', name: 'Dialog テスト', description: '' },
    itemOrder: ['title', 'manual'],
    items: {
      title: { name: 'タイトル', type: 'text', description: '', note: '' },
      manual: { name: '手動', type: 'text', description: '', note: '' },
    },
    collectedItemIds: ['title'],
  };
}

function createBaseTreeDoc(): MockTreeDoc {
  return {
    screen: { id: 'demo', name: 'Demo', description: '説明' },
    itemOrder: ['title'],
    items: {
      title: {
        name: 'タイトル',
        type: 'text',
        description: '見出し',
        note: '',
      },
    },
    collectedItemIds: ['title'],
  };
}

function stubLinkedPageFetch(options?: {
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
    { 'linked-dialog': createLinkedTreeDoc() },
    {
      onFetch: options?.onFetch,
      extraHandler: (url) => {
        if (url.endsWith('/data/screens/linked-dialog.json')) {
          return jsonResponse(linkedScreen);
        }
        if (url.endsWith('/data/snapshots/linked-dialog/default.html')) {
          return textResponse('<main></main>');
        }
        if (url.endsWith('/data/theme/preview.css')) {
          return textResponse('/* preview */');
        }
        return undefined;
      },
    },
  );
  if (options?.wrapFetch) {
    const baseFetch = global.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        options.wrapFetch!(input, init, baseFetch),
      ),
    );
  }
  return stubbed;
}

async function mountLinkedPage(): Promise<ReturnType<typeof mount>> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/screens/:screenId', component: ScreenSpecPage, props: true }],
  });
  await router.push('/screens/linked-dialog');
  await router.isReady();

  const manifest = computed<ViewerManifest>(() => ({
    schemaVersion: '1',
    projectName: 'sample',
    base: '/spec/',
    screens: [linkedManifest],
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
  return wrapper;
}

const EditorHarness = defineComponent({
  setup() {
    const editor = useDescriptionEditor(() => 'demo');
    return { editor };
  },
  template: '<span />',
});

async function mountEditorHarness() {
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
  return root.findComponent(EditorHarness);
}

function countMutationPosts(
  fetchMock: ReturnType<typeof vi.fn>,
  suffix: string,
): number {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).includes(suffix) &&
      (init?.method ?? 'GET').toUpperCase() === 'POST',
  ).length;
}

describe('Description mutation outcome', () => {
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

  describe('destructive dialog refresh failure', () => {
    function stubRefreshFailureAfterMutation(
      mutationSuffix: string,
    ): ReturnType<typeof stubDescriptionTreeFetch> {
      let mutationDone = false;
      return stubLinkedPageFetch({
        onFetch: (url, method) => {
          if (url.includes(mutationSuffix) && method === 'POST') {
            mutationDone = true;
            return jsonResponse({ status: 'updated', revision: 'sha256:r2' });
          }
          return null;
        },
        wrapFetch: async (input, init, baseFetch) => {
          const url = String(input);
          const method = (init?.method ?? 'GET').toUpperCase();
          if (
            mutationDone &&
            method === 'GET' &&
            url.includes('/description-tree/linked-dialog')
          ) {
            return new Response('reload failed', { status: 500 });
          }
          return baseFetch(input, init);
        },
      });
    }

    it('Delete: POST 성공 + Tree GET 실패 → dialog close, reloadRequired, delete POST 1회', async () => {
      const { getFetchMock } = stubRefreshFailureAfterMutation('/items/manual/delete');
      const wrapper = await mountLinkedPage();

      await wrapper.find('#item-row-manual [aria-label="削除"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-action="confirm-delete"]').trigger('click');
      await flushPromises();

      expect(wrapper.text()).not.toContain('項目を削除しますか？');
      expect(wrapper.findComponent(DeleteItemDialog).exists()).toBe(false);
      expect(wrapper.text()).toContain('最新内容を再読み込み');

      await wrapper.find('#item-row-manual [aria-label="削除"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-action="confirm-delete"]').trigger('click');
      await flushPromises();

      expect(countMutationPosts(getFetchMock(), '/items/manual/delete')).toBe(1);
    });

    it('Duplicate: POST 성공 + Tree GET 실패 → dialog 유지, reloadRequired, duplicate POST 1회', async () => {
      const { getFetchMock } = stubRefreshFailureAfterMutation('/linked-dialog/items');
      const wrapper = await mountLinkedPage();

      await wrapper.find('#item-row-title [aria-label="複製"]').trigger('click');
      await flushPromises();
      await wrapper.findComponent(DuplicateItemDialog).find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain('項目を複製');
      expect(wrapper.findComponent(DuplicateItemDialog).exists()).toBe(true);
      expect(wrapper.text()).toContain('最新内容を再読み込み');
      expect(
        wrapper.findComponent(DuplicateItemDialog).find('button[type="submit"]').attributes('disabled'),
      ).toBeDefined();

      await wrapper.findComponent(DuplicateItemDialog).find('form').trigger('submit');
      await flushPromises();

      const createCalls = getFetchMock().mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/linked-dialog/items') &&
          (init?.method ?? 'GET').toUpperCase() === 'POST' &&
          !String(url).includes('/delete') &&
          !String(url).includes('/exclude'),
      );
      expect(createCalls).toHaveLength(1);
    });

    it('Exclude: POST 성공 + Tree GET 실패 → dialog close, reloadRequired, exclude POST 1회', async () => {
      const { getFetchMock } = stubRefreshFailureAfterMutation('/items/title/exclude');
      const wrapper = await mountLinkedPage();

      await wrapper
        .find('#item-row-title [aria-label="設計対象から除外"]')
        .trigger('click');
      await flushPromises();
      await wrapper.find('[data-action="confirm-exclude"]').trigger('click');
      await flushPromises();

      expect(wrapper.text()).not.toContain('項目を設計対象から除外しますか？');
      expect(wrapper.findComponent(ExcludeItemDialog).exists()).toBe(false);
      expect(wrapper.text()).toContain('最新内容を再読み込み');

      await wrapper
        .find('#item-row-title [aria-label="設計対象から除外"]')
        .trigger('click');
      await flushPromises();
      await wrapper.find('[data-action="confirm-exclude"]').trigger('click');
      await flushPromises();

      expect(countMutationPosts(getFetchMock(), '/items/title/exclude')).toBe(1);
    });
  });

  describe('Create dialog committed outcome', () => {
    function stubCreateRefreshFailure(): ReturnType<typeof stubDescriptionTreeFetch> {
      let mutationDone = false;
      return stubLinkedPageFetch({
        onFetch: (url, method) => {
          if (
            url.includes('/linked-dialog/items') &&
            method === 'POST' &&
            !url.includes('/delete') &&
            !url.includes('/exclude')
          ) {
            mutationDone = true;
            return jsonResponse({ status: 'updated', revision: 'sha256:r2' });
          }
          return null;
        },
        wrapFetch: async (input, init, baseFetch) => {
          const url = String(input);
          const method = (init?.method ?? 'GET').toUpperCase();
          if (
            mutationDone &&
            method === 'GET' &&
            url.includes('/description-tree/linked-dialog')
          ) {
            return new Response('reload failed', { status: 500 });
          }
          return baseFetch(input, init);
        },
      });
    }

    it('Create: POST 성공 + Tree GET 실패 → dialog 유지, reloadRequired, create POST 1회', async () => {
      const { getFetchMock } = stubCreateRefreshFailure();
      const wrapper = await mountLinkedPage();

      await wrapper.find('.spec-page__section-header button').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('項目を追加');

      await wrapper.find('[data-field="item-id"]').setValue('new-item');
      await wrapper.find('[data-field="item-name"]').setValue('新規');
      await wrapper.find('[data-field="item-type"]').setValue('text');
      await wrapper.find('.create-screen-dialog form').trigger('submit');
      await flushPromises();

      expect(wrapper.findComponent(CreateItemDialog).exists()).toBe(true);
      expect(wrapper.find('[data-field="item-id"]').element).toHaveProperty('value', 'new-item');
      expect(wrapper.text()).toContain('最新内容を再読み込み');
      expect(wrapper.find('.create-screen-dialog button[type="submit"]').attributes('disabled')).toBeDefined();

      await wrapper.find('.create-screen-dialog form').trigger('submit');
      await flushPromises();

      const createCalls = getFetchMock().mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/linked-dialog/items') &&
          (init?.method ?? 'GET').toUpperCase() === 'POST' &&
          !String(url).includes('/delete') &&
          !String(url).includes('/exclude'),
      );
      expect(createCalls).toHaveLength(1);
    });
  });

  describe('commit-unknown transport errors', () => {
    it('Delete: mutation fetch throw → dialog close, reloadRequired, delete POST 1회', async () => {
      const { getFetchMock } = stubLinkedPageFetch({
        onFetch: (url, method) => {
          if (url.includes('/items/manual/delete') && method === 'POST') {
            return Promise.reject(new Error('network reset'));
          }
          return null;
        },
      });
      const wrapper = await mountLinkedPage();

      await wrapper.find('#item-row-manual [aria-label="削除"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-action="confirm-delete"]').trigger('click');
      await flushPromises();

      expect(wrapper.text()).not.toContain('項目を削除しますか？');
      expect(wrapper.findComponent(DeleteItemDialog).exists()).toBe(false);
      expect(wrapper.text()).toContain('保存結果を確認できませんでした');

      await wrapper.find('#item-row-manual [aria-label="削除"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-action="confirm-delete"]').trigger('click');
      await flushPromises();

      expect(countMutationPosts(getFetchMock(), '/items/manual/delete')).toBe(1);
    });

    it('Create: mutation fetch throw → dialog 유지, reloadRequired, create POST 1회', async () => {
      const { getFetchMock } = stubLinkedPageFetch({
        onFetch: (url, method) => {
          if (
            url.includes('/linked-dialog/items') &&
            method === 'POST' &&
            !url.includes('/delete') &&
            !url.includes('/exclude')
          ) {
            return Promise.reject(new Error('network reset'));
          }
          return null;
        },
      });
      const wrapper = await mountLinkedPage();

      await wrapper.find('.spec-page__section-header button').trigger('click');
      await flushPromises();
      await wrapper.find('[data-field="item-id"]').setValue('new-item');
      await wrapper.find('[data-field="item-name"]').setValue('新規');
      await wrapper.find('[data-field="item-type"]').setValue('text');
      await wrapper.find('.create-screen-dialog form').trigger('submit');
      await flushPromises();

      expect(wrapper.findComponent(CreateItemDialog).exists()).toBe(true);
      expect(wrapper.find('[data-field="item-id"]').element).toHaveProperty('value', 'new-item');
      expect(wrapper.text()).toContain('保存結果を確認できませんでした');
      expect(wrapper.find('.create-screen-dialog button[type="submit"]').attributes('disabled')).toBeDefined();

      await wrapper.find('.create-screen-dialog form').trigger('submit');
      await flushPromises();

      const createCalls = getFetchMock().mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/linked-dialog/items') &&
          (init?.method ?? 'GET').toUpperCase() === 'POST' &&
          !String(url).includes('/delete') &&
          !String(url).includes('/exclude'),
      );
      expect(createCalls).toHaveLength(1);
    });
  });

  describe('composable commit-unknown classification', () => {
    it('transport error → commit-unknown, reloadRequired', async () => {
      stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
      const baseFetch = global.fetch;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = (init?.method ?? 'GET').toUpperCase();
          if (url.includes('/demo/screen') && method === 'PATCH') {
            throw new Error('connection reset');
          }
          return baseFetch(input, init);
        }),
      );

      const wrapper = await mountEditorHarness();
      await wrapper.vm.editor.loadDescription('demo');
      await flushPromises();

      wrapper.vm.editor.updateScreenField('name', 'changed');
      const outcome = await wrapper.vm.editor.saveScreenMetadata();
      expect(outcome.status).toBe('commit-unknown');
      expect(wrapper.vm.editor.reloadRequired.value).toBe(true);
      expect(wrapper.vm.editor.statusMessage.value).toContain(
        '保存結果を確認できませんでした',
      );
    });

    it('5xx error → commit-unknown', async () => {
      stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
      const baseFetch = global.fetch;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = (init?.method ?? 'GET').toUpperCase();
          if (url.includes('/demo/screen') && method === 'PATCH') {
            return new Response('server error', { status: 503 });
          }
          return baseFetch(input, init);
        }),
      );

      const wrapper = await mountEditorHarness();
      await wrapper.vm.editor.loadDescription('demo');
      await flushPromises();

      wrapper.vm.editor.updateScreenField('name', 'changed');
      const outcome = await wrapper.vm.editor.saveScreenMetadata();
      expect(outcome.status).toBe('commit-unknown');
      expect(wrapper.vm.editor.reloadRequired.value).toBe(true);
    });

    it('malformed success envelope → commit-unknown', async () => {
      stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
      const baseFetch = global.fetch;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = (init?.method ?? 'GET').toUpperCase();
          if (url.includes('/demo/screen') && method === 'PATCH') {
            return new Response(JSON.stringify({ broken: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return baseFetch(input, init);
        }),
      );

      const wrapper = await mountEditorHarness();
      await wrapper.vm.editor.loadDescription('demo');
      await flushPromises();

      wrapper.vm.editor.updateScreenField('name', 'changed');
      const outcome = await wrapper.vm.editor.saveScreenMetadata();
      expect(outcome.status).toBe('commit-unknown');
      expect(wrapper.vm.editor.reloadRequired.value).toBe(true);
    });

    it('400 error → mutation-rejected, reloadRequired false', async () => {
      stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
      const baseFetch = global.fetch;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = (init?.method ?? 'GET').toUpperCase();
          if (url.includes('/demo/screen') && method === 'PATCH') {
            return new Response(
              JSON.stringify({
                code: 'SPEC_DESCRIPTION_INVALID',
                message: '入力が不正です。',
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return baseFetch(input, init);
        }),
      );

      const wrapper = await mountEditorHarness();
      await wrapper.vm.editor.loadDescription('demo');
      await flushPromises();

      wrapper.vm.editor.updateScreenField('name', 'changed');
      const outcome = await wrapper.vm.editor.saveScreenMetadata();
      expect(outcome.status).toBe('mutation-rejected');
      expect(wrapper.vm.editor.reloadRequired.value).toBe(false);
    });

    it('commit-unknown 후 same-screen reload 성공 → reloadRequired 해제', async () => {
      stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
      const baseFetch = global.fetch;
      let patchAttempts = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = (init?.method ?? 'GET').toUpperCase();
          if (url.includes('/demo/screen') && method === 'PATCH') {
            patchAttempts += 1;
            if (patchAttempts === 1) {
              throw new Error('connection reset');
            }
          }
          return baseFetch(input, init);
        }),
      );

      const wrapper = await mountEditorHarness();
      await wrapper.vm.editor.loadDescription('demo');
      await flushPromises();

      wrapper.vm.editor.updateScreenField('name', 'changed');
      await wrapper.vm.editor.saveScreenMetadata();
      expect(wrapper.vm.editor.reloadRequired.value).toBe(true);

      await wrapper.vm.editor.reloadLatest();
      await flushPromises();
      expect(wrapper.vm.editor.reloadRequired.value).toBe(false);

      wrapper.vm.editor.updateScreenField('name', 'changed-again');
      const outcome = await wrapper.vm.editor.saveScreenMetadata();
      expect(outcome.status).toBe('committed-refreshed');
    });

    it('deprecated save: Screen commit-unknown → Item mutation 미실행', async () => {
      stubDescriptionTreeFetch({
        demo: {
          ...createBaseTreeDoc(),
          itemOrder: ['title'],
          items: {
            title: {
              name: 'タイトル',
              type: 'text',
              description: '',
              note: '',
            },
          },
        },
      });
      const baseFetch = global.fetch;
      let itemPatchCount = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = (init?.method ?? 'GET').toUpperCase();
          if (url.includes('/demo/screen') && method === 'PATCH') {
            throw new Error('connection reset');
          }
          if (url.includes('/items/title') && method === 'PATCH') {
            itemPatchCount += 1;
          }
          return baseFetch(input, init);
        }),
      );

      const wrapper = await mountEditorHarness();
      await wrapper.vm.editor.loadDescription('demo');
      await flushPromises();

      wrapper.vm.editor.updateScreenField('name', 'Screen draft');
      wrapper.vm.editor.beginItemEdit('title');
      wrapper.vm.editor.updateItemField('title', 'name', 'Item draft');

      const outcome = await wrapper.vm.editor.save();
      expect(outcome.status).toBe('commit-unknown');
      expect(itemPatchCount).toBe(0);
      expect(wrapper.vm.editor.reloadRequired.value).toBe(true);
    });
  });

  describe('composable reloadRequired gate', () => {
    it('metadata save: POST 성공 + refresh 실패 → committed-refresh-failed, reloadRequired, 추가 mutation 차단', async () => {
      stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
      const baseFetch = global.fetch;
      let patchDone = false;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = (init?.method ?? 'GET').toUpperCase();
          if (url.includes('/demo/screen') && method === 'PATCH') {
            patchDone = true;
          }
          if (
            patchDone &&
            method === 'GET' &&
            url.includes('/description-tree/demo')
          ) {
            return new Response('reload failed', { status: 500 });
          }
          return baseFetch(input, init);
        }),
      );

      const wrapper = await mountEditorHarness();
      await wrapper.vm.editor.loadDescription('demo');
      await flushPromises();

      wrapper.vm.editor.updateScreenField('name', 'changed');
      const outcome: DescriptionMutationOutcome =
        await wrapper.vm.editor.saveScreenMetadata();
      expect(outcome.status).toBe('committed-refresh-failed');
      expect(wrapper.vm.editor.reloadRequired.value).toBe(true);
      expect(wrapper.vm.editor.status.value).toBe('reload-failed');

      const blocked = await wrapper.vm.editor.createItem({
        itemId: 'new-item',
        name: '新規',
        type: 'text',
        description: '',
        note: '',
      });
      expect(blocked.status).toBe('mutation-rejected');
    });

    it('same-screen reload 성공 후 reloadRequired 해제, mutation 재허용', async () => {
      stubDescriptionTreeFetch({ demo: createBaseTreeDoc() });
      const baseFetch = global.fetch;
      let patchDone = false;
      let refreshGetCount = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = (init?.method ?? 'GET').toUpperCase();
          if (url.includes('/demo/screen') && method === 'PATCH') {
            patchDone = true;
          }
          if (
            patchDone &&
            method === 'GET' &&
            url.includes('/description-tree/demo')
          ) {
            refreshGetCount += 1;
            if (refreshGetCount === 1) {
              return new Response('reload failed', { status: 500 });
            }
          }
          return baseFetch(input, init);
        }),
      );

      const wrapper = await mountEditorHarness();
      await wrapper.vm.editor.loadDescription('demo');
      await flushPromises();

      wrapper.vm.editor.updateScreenField('name', 'changed');
      await wrapper.vm.editor.saveScreenMetadata();
      expect(wrapper.vm.editor.reloadRequired.value).toBe(true);

      await wrapper.vm.editor.reloadLatest();
      await flushPromises();
      expect(wrapper.vm.editor.reloadRequired.value).toBe(false);

      wrapper.vm.editor.updateScreenField('name', 'changed-again');
      const outcome = await wrapper.vm.editor.saveScreenMetadata();
      expect(outcome.status).toBe('committed-refreshed');
    });

    it('deprecated save: Screen committed-refreshed 후 Item은 실행, refresh 실패 시 Item 미실행', async () => {
      stubDescriptionTreeFetch({
        demo: {
          ...createBaseTreeDoc(),
          itemOrder: ['title'],
          items: {
            title: {
              name: 'タイトル',
              type: 'text',
              description: '',
              note: '',
            },
          },
        },
      });
      const baseFetch = global.fetch;
      let screenPatchDone = false;
      let itemPatchCount = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = (init?.method ?? 'GET').toUpperCase();
          if (url.includes('/demo/screen') && method === 'PATCH') {
            screenPatchDone = true;
          }
          if (url.includes('/items/title') && method === 'PATCH') {
            itemPatchCount += 1;
          }
          if (
            screenPatchDone &&
            method === 'GET' &&
            url.includes('/description-tree/demo')
          ) {
            return new Response('reload failed', { status: 500 });
          }
          return baseFetch(input, init);
        }),
      );

      const wrapper = await mountEditorHarness();
      await wrapper.vm.editor.loadDescription('demo');
      await flushPromises();

      wrapper.vm.editor.updateScreenField('name', 'Screen draft');
      wrapper.vm.editor.beginItemEdit('title');
      wrapper.vm.editor.updateItemField('title', 'name', 'Item draft');

      const outcome = await wrapper.vm.editor.save();
      expect(outcome.status).toBe('committed-refresh-failed');
      expect(itemPatchCount).toBe(0);
      expect(wrapper.vm.editor.reloadRequired.value).toBe(true);
      expect(wrapper.vm.editor.screenDirty.value).toBe(true);
      expect(wrapper.vm.editor.itemDirty.value).toBe(true);
    });
  });
});
