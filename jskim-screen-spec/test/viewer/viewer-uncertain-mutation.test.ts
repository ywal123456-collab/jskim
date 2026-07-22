import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ScreenSpecPage from '../../src/viewer/pages/ScreenSpecPage.vue';
import CreateItemDialog from '../../src/viewer/components/CreateItemDialog.vue';
import DuplicateItemDialog from '../../src/viewer/components/DuplicateItemDialog.vue';
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

function createScreenBTreeDoc(): MockTreeDoc {
  return {
    screen: { id: 'screen-b', name: 'Screen B', description: '' },
    itemOrder: ['title'],
    items: {
      title: { name: 'B項目', type: 'text', description: '', note: '' },
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
    { 'linked-dialog': createLinkedTreeDoc(), 'screen-b': createScreenBTreeDoc() },
    {
      onFetch: options?.onFetch,
      extraHandler: (url) => {
        if (url.endsWith('/data/screens/linked-dialog.json')) {
          return jsonResponse(linkedScreen);
        }
        if (url.endsWith('/data/screens/screen-b.json')) {
          return jsonResponse(screenBScreen);
        }
        if (url.endsWith('/data/snapshots/linked-dialog/default.html')) {
          return textResponse('<main></main>');
        }
        if (url.endsWith('/data/snapshots/screen-b/default.html')) {
          return textResponse('<main data-b></main>');
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

async function mountLinkedPage(
  screens: ManifestScreen[] = [linkedManifest],
): Promise<{
  wrapper: ReturnType<typeof mount>;
  router: ReturnType<typeof createRouter>;
}> {
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
    screens,
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
  return { wrapper, router };
}

function countCreatePosts(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).includes('/linked-dialog/items') &&
      (init?.method ?? 'GET').toUpperCase() === 'POST' &&
      !String(url).includes('/delete') &&
      !String(url).includes('/exclude'),
  ).length;
}

async function openCreateDialog(wrapper: ReturnType<typeof mount>): Promise<void> {
  await wrapper.find('.spec-page__section-header button').trigger('click');
  await flushPromises();
}

async function fillCreateForm(
  wrapper: ReturnType<typeof mount>,
  fields: {
    itemId: string;
    name: string;
    type: string;
    description: string;
    note: string;
  },
): Promise<void> {
  await wrapper.find('[data-field="item-id"]').setValue(fields.itemId);
  await wrapper.find('[data-field="item-name"]').setValue(fields.name);
  await wrapper.find('[data-field="item-type"]').setValue(fields.type);
  await wrapper.find('[data-field="item-description"]').setValue(fields.description);
  await wrapper.find('[data-field="item-note"]').setValue(fields.note);
}

const createInput = {
  itemId: 'new-item',
  name: '新規',
  type: 'text',
  description: '説明',
  note: '備考',
};

describe('Uncertain create/duplicate mutation recovery', () => {
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

  describe('Create commit-unknown', () => {
    it('transport error → dialog 유지, 입력 유지, confirm 차단, create POST 1회', async () => {
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
      const { wrapper } = await mountLinkedPage();

      await openCreateDialog(wrapper);
      await fillCreateForm(wrapper, createInput);
      await wrapper.find('.create-screen-dialog form').trigger('submit');
      await flushPromises();

      expect(wrapper.findComponent(CreateItemDialog).exists()).toBe(true);
      expect(wrapper.find('[data-field="item-id"]').element).toHaveProperty(
        'value',
        createInput.itemId,
      );
      expect(wrapper.find('[data-field="item-name"]').element).toHaveProperty(
        'value',
        createInput.name,
      );
      expect(wrapper.find('[data-field="item-type"]').element).toHaveProperty(
        'value',
        createInput.type,
      );
      expect(wrapper.find('[data-field="item-description"]').element).toHaveProperty(
        'value',
        createInput.description,
      );
      expect(wrapper.find('[data-field="item-note"]').element).toHaveProperty(
        'value',
        createInput.note,
      );
      expect(wrapper.text()).toContain('保存結果を確認できませんでした');
      expect(wrapper.find('.create-screen-dialog button[type="submit"]').attributes('disabled')).toBeDefined();

      await wrapper.find('.create-screen-dialog form').trigger('submit');
      await flushPromises();
      expect(countCreatePosts(getFetchMock())).toBe(1);
    });

    it('POST 성공 + refresh 실패 → dialog 유지, 입력 유지, confirm 차단, create POST 1회', async () => {
      let mutationDone = false;
      const { getFetchMock } = stubLinkedPageFetch({
        onFetch: (url, method) => {
          if (
            url.includes('/linked-dialog/items') &&
            method === 'POST' &&
            !url.includes('/delete') &&
            !url.includes('/exclude')
          ) {
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
            url.includes('/description-tree/linked-dialog')
          ) {
            return new Response('reload failed', { status: 500 });
          }
          return baseFetch(input, init);
        },
      });
      const { wrapper } = await mountLinkedPage();

      await openCreateDialog(wrapper);
      await fillCreateForm(wrapper, createInput);
      await wrapper.find('.create-screen-dialog form').trigger('submit');
      await flushPromises();

      expect(wrapper.findComponent(CreateItemDialog).exists()).toBe(true);
      expect(wrapper.find('[data-field="item-id"]').element).toHaveProperty(
        'value',
        createInput.itemId,
      );
      expect(wrapper.text()).toContain('最新内容を再読み込み');
      expect(wrapper.find('.create-screen-dialog button[type="submit"]').attributes('disabled')).toBeDefined();

      await wrapper.find('.create-screen-dialog form').trigger('submit');
      await flushPromises();
      expect(countCreatePosts(getFetchMock())).toBe(1);
    });
  });

  describe('Duplicate commit-unknown', () => {
    it('transport error → dialog 유지, 입력 유지, confirm 차단, duplicate POST 1회', async () => {
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
      const { wrapper } = await mountLinkedPage();

      await wrapper.find('#item-row-title [aria-label="複製"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-field="item-id"]').setValue('copy-title');
      await wrapper.find('[data-field="item-name"]').setValue('複製名');
      await wrapper.findComponent(DuplicateItemDialog).find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.findComponent(DuplicateItemDialog).exists()).toBe(true);
      expect(wrapper.find('[data-field="item-id"]').element).toHaveProperty('value', 'copy-title');
      expect(wrapper.find('[data-field="item-name"]').element).toHaveProperty('value', '複製名');
      expect(wrapper.text()).toContain('保存結果を確認できませんでした');
      expect(
        wrapper.findComponent(DuplicateItemDialog).find('button[type="submit"]').attributes('disabled'),
      ).toBeDefined();

      await wrapper.findComponent(DuplicateItemDialog).find('form').trigger('submit');
      await flushPromises();
      expect(countCreatePosts(getFetchMock())).toBe(1);
    });
  });

  describe('reload 후 uncertain result', () => {
    it('Create: refresh 실패 후 reload 성공 + target 존재 → dialog close, reloadRequired=false', async () => {
      let refreshGetCount = 0;
      stubLinkedPageFetch({
        wrapFetch: async (input, init, baseFetch) => {
          const url = String(input);
          const method = (init?.method ?? 'GET').toUpperCase();
          if (
            method === 'GET' &&
            url.includes('/description-tree/linked-dialog')
          ) {
            refreshGetCount += 1;
            if (refreshGetCount === 2) {
              return new Response('reload failed', { status: 500 });
            }
          }
          return baseFetch(input, init);
        },
      });
      const { wrapper } = await mountLinkedPage();

      await openCreateDialog(wrapper);
      await fillCreateForm(wrapper, createInput);
      await wrapper.find('.create-screen-dialog form').trigger('submit');
      await flushPromises();

      expect(wrapper.findComponent(CreateItemDialog).exists()).toBe(true);
      expect(wrapper.text()).toContain('最新内容を再読み込み');

      await wrapper
        .find('.spec-page__banner[data-status="reload-failed"] button')
        .trigger('click');
      await flushPromises();

      expect(wrapper.findComponent(CreateItemDialog).exists()).toBe(false);
      expect(wrapper.text()).not.toContain('最新内容を再読み込み');
    });

    it('Create: transport error 후 reload 성공 + target 없음 → dialog 유지, confirm 활성화', async () => {
      stubLinkedPageFetch({
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
      const { wrapper } = await mountLinkedPage();

      await openCreateDialog(wrapper);
      await fillCreateForm(wrapper, createInput);
      await wrapper.find('.create-screen-dialog form').trigger('submit');
      await flushPromises();

      expect(wrapper.findComponent(CreateItemDialog).exists()).toBe(true);
      expect(wrapper.text()).toContain('保存結果を確認できませんでした');

      await wrapper.find('.spec-page__banner button').trigger('click');
      await flushPromises();

      expect(wrapper.findComponent(CreateItemDialog).exists()).toBe(true);
      expect(wrapper.find('[data-field="item-id"]').element).toHaveProperty(
        'value',
        createInput.itemId,
      );
      expect(wrapper.find('.create-screen-dialog button[type="submit"]').attributes('disabled')).toBeUndefined();
      expect(wrapper.text()).not.toContain('保存結果を確認できませんでした');
    });

    it('Create: reload 재실패 → uncertain 유지, confirm 계속 차단', async () => {
      let treeGetCount = 0;
      stubLinkedPageFetch({
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
        wrapFetch: async (input, init, baseFetch) => {
          const url = String(input);
          const method = (init?.method ?? 'GET').toUpperCase();
          if (method === 'GET' && url.includes('/description-tree/linked-dialog')) {
            treeGetCount += 1;
            if (treeGetCount > 1) {
              return new Response('reload failed', { status: 500 });
            }
          }
          return baseFetch(input, init);
        },
      });
      const { wrapper } = await mountLinkedPage();

      await openCreateDialog(wrapper);
      await fillCreateForm(wrapper, createInput);
      await wrapper.find('.create-screen-dialog form').trigger('submit');
      await flushPromises();

      await wrapper
        .find('.spec-page__banner[data-status="reload-failed"] button')
        .trigger('click');
      await flushPromises();

      expect(wrapper.findComponent(CreateItemDialog).exists()).toBe(true);
      expect(wrapper.find('[data-field="item-id"]').element).toHaveProperty(
        'value',
        createInput.itemId,
      );
      expect(wrapper.find('.create-screen-dialog button[type="submit"]').attributes('disabled')).toBeDefined();
      expect(wrapper.findComponent(CreateItemDialog).exists()).toBe(true);
      expect(wrapper.find('[data-field="item-id"]').element).toHaveProperty(
        'value',
        createInput.itemId,
      );
    });
  });

  describe('Create dialog Screen 전환', () => {
    it('Screen A Create dialog → Screen B 전환 시 A dialog/입력 정리', async () => {
      let createPostCount = 0;
      stubLinkedPageFetch({
        onFetch: (url, method) => {
          if (
            url.includes('/linked-dialog/items') &&
            method === 'POST' &&
            !url.includes('/delete') &&
            !url.includes('/exclude')
          ) {
            createPostCount += 1;
            return Promise.reject(new Error('network reset'));
          }
          return null;
        },
      });
      const { wrapper, router } = await mountLinkedPage([linkedManifest, screenBManifest]);

      await openCreateDialog(wrapper);
      await fillCreateForm(wrapper, createInput);
      await wrapper.find('.create-screen-dialog form').trigger('submit');
      await flushPromises();

      expect(wrapper.findComponent(CreateItemDialog).exists()).toBe(true);

      await router.push('/screens/screen-b');
      await nextTick();
      await flushPromises();

      expect(wrapper.findComponent(CreateItemDialog).exists()).toBe(false);
      expect(createPostCount).toBe(1);
    });
  });
});
