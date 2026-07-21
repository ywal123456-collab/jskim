import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ScreenSpecPage from '../../src/viewer/pages/ScreenSpecPage.vue';
import DeleteItemDialog from '../../src/viewer/components/DeleteItemDialog.vue';
import DuplicateItemDialog from '../../src/viewer/components/DuplicateItemDialog.vue';
import ExcludeItemDialog from '../../src/viewer/components/ExcludeItemDialog.vue';
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

function stubLinkedPageFetch(options?: {
  onFetch?: (
    url: string,
    method: string,
    body: Record<string, unknown>,
  ) => Response | Promise<Response> | null;
}): ReturnType<typeof stubDescriptionTreeFetch> {
  return stubDescriptionTreeFetch(
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

function createDeferredGate(): {
  wait: Promise<void>;
  release: () => void;
} {
  let release: (() => void) | null = null;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    wait,
    release: () => release?.(),
  };
}

describe('ScreenSpecPage item dialog mutations', () => {
  beforeEach(() => {
    window.__JSKIM_SPEC_EDIT__ = {
      enabled: true,
      apiBase: '/_jskim/spec/descriptions',
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as { __JSKIM_SPEC_EDIT__?: unknown }).__JSKIM_SPEC_EDIT__;
  });

  describe('再現 A — 成功後 dialog close', () => {
    it('Delete 成功後は pending false・target null・dialog close', async () => {
      stubLinkedPageFetch();
      const wrapper = await mountLinkedPage();

      await wrapper.find('#item-row-manual [aria-label="削除"]').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('項目を削除しますか？');

      await wrapper.find('[data-action="confirm-delete"]').trigger('click');
      await flushPromises();

      expect(wrapper.text()).not.toContain('項目を削除しますか？');
      expect(wrapper.findComponent(DeleteItemDialog).exists()).toBe(false);
    });

    it('Duplicate 成功後は pending false・target null・dialog close', async () => {
      stubLinkedPageFetch();
      const wrapper = await mountLinkedPage();

      await wrapper.find('#item-row-title [aria-label="複製"]').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('項目を複製');

      await wrapper.findComponent(DuplicateItemDialog).find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).not.toContain('項目を複製');
      expect(wrapper.findComponent(DuplicateItemDialog).exists()).toBe(false);
    });

    it('Exclude 成功後は pending false・target null・dialog close', async () => {
      stubLinkedPageFetch();
      const wrapper = await mountLinkedPage();

      await wrapper
        .find('#item-row-title [aria-label="設計対象から除外"]')
        .trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('項目を設計対象から除外しますか？');

      await wrapper.find('[data-action="confirm-exclude"]').trigger('click');
      await flushPromises();

      expect(wrapper.text()).not.toContain('項目を設計対象から除外しますか？');
      expect(wrapper.findComponent(ExcludeItemDialog).exists()).toBe(false);
    });
  });

  describe('再現 B — parent double-submit', () => {
    it('Delete confirm 二重送信は mutation 1 回のみ', async () => {
      const { getFetchMock } = stubLinkedPageFetch({
        onFetch: (url, method) => {
          if (url.includes('/items/manual/delete') && method === 'POST') {
            const gate = createDeferredGate();
            return gate.wait.then(() =>
              jsonResponse({ status: 'updated', revision: 'sha256:r2' }),
            );
          }
          return null;
        },
      });
      const wrapper = await mountLinkedPage();

      await wrapper.find('#item-row-manual [aria-label="削除"]').trigger('click');
      await flushPromises();

      const dialog = wrapper.findComponent(DeleteItemDialog);
      dialog.vm.$emit('confirm', { itemId: 'manual' });
      dialog.vm.$emit('confirm', { itemId: 'manual' });
      await flushPromises();

      const deleteCalls = getFetchMock().mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/items/manual/delete') &&
          (init?.method ?? 'GET').toUpperCase() === 'POST',
      );
      expect(deleteCalls).toHaveLength(1);
      expect(wrapper.text()).toContain('項目を削除しますか？');
    });

    it('Duplicate create 二重送信は mutation 1 回のみ', async () => {
      const { getFetchMock } = stubLinkedPageFetch({
        onFetch: (url, method) => {
          if (url.includes('/items') && method === 'POST' && !url.includes('/delete')) {
            const gate = createDeferredGate();
            return gate.wait.then(() =>
              jsonResponse({ status: 'updated', revision: 'sha256:r2' }),
            );
          }
          return null;
        },
      });
      const wrapper = await mountLinkedPage();

      await wrapper.find('#item-row-title [aria-label="複製"]').trigger('click');
      await flushPromises();

      const payload = {
        sourceItemId: 'title',
        itemId: 'title-copy',
        name: 'タイトル',
        type: 'text',
        description: '',
        note: '',
      };
      const dialog = wrapper.findComponent(DuplicateItemDialog);
      dialog.vm.$emit('create', payload);
      dialog.vm.$emit('create', payload);
      await flushPromises();

      const createCalls = getFetchMock().mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/linked-dialog/items') &&
          (init?.method ?? 'GET').toUpperCase() === 'POST',
      );
      expect(createCalls).toHaveLength(1);
      expect(wrapper.text()).toContain('項目を複製');
    });

    it('Exclude confirm 二重送信は mutation 1 回のみ', async () => {
      const { getFetchMock } = stubLinkedPageFetch({
        onFetch: (url, method) => {
          if (url.includes('/items/title/exclude') && method === 'POST') {
            const gate = createDeferredGate();
            return gate.wait.then(() =>
              jsonResponse({ status: 'updated', revision: 'sha256:r2' }),
            );
          }
          return null;
        },
      });
      const wrapper = await mountLinkedPage();

      await wrapper
        .find('#item-row-title [aria-label="設計対象から除外"]')
        .trigger('click');
      await flushPromises();

      const dialog = wrapper.findComponent(ExcludeItemDialog);
      dialog.vm.$emit('confirm', { itemId: 'title' });
      dialog.vm.$emit('confirm', { itemId: 'title' });
      await flushPromises();

      const excludeCalls = getFetchMock().mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/items/title/exclude') &&
          (init?.method ?? 'GET').toUpperCase() === 'POST',
      );
      expect(excludeCalls).toHaveLength(1);
      expect(wrapper.text()).toContain('項目を設計対象から除外しますか？');
    });
  });

  describe('Delete / Exclude 失敗・409', () => {
    it('Delete 409 後は pending false・target 維持・dialog 維持', async () => {
      stubLinkedPageFetch({
        onFetch: (url, method) => {
          if (url.includes('/items/manual/delete') && method === 'POST') {
            return new Response(
              JSON.stringify({
                code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
                message: '衝突',
              }),
              { status: 409, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return null;
        },
      });
      const wrapper = await mountLinkedPage();

      await wrapper.find('#item-row-manual [aria-label="削除"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-action="confirm-delete"]').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('項目を削除しますか？');
      expect(wrapper.findComponent(DeleteItemDialog).exists()).toBe(true);
    });

    it('Exclude 409 後は pending false・target 維持・dialog 維持', async () => {
      stubLinkedPageFetch({
        onFetch: (url, method) => {
          if (url.includes('/items/title/exclude') && method === 'POST') {
            return new Response(
              JSON.stringify({
                code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
                message: '衝突',
              }),
              { status: 409, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return null;
        },
      });
      const wrapper = await mountLinkedPage();

      await wrapper
        .find('#item-row-title [aria-label="設計対象から除外"]')
        .trigger('click');
      await flushPromises();
      await wrapper.find('[data-action="confirm-exclude"]').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('項目を設計対象から除外しますか？');
      expect(wrapper.findComponent(ExcludeItemDialog).exists()).toBe(true);
    });
  });
});
