import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import ScreenSpecPage from '../../src/viewer/pages/ScreenSpecPage.vue';
import DeleteItemDialog from '../../src/viewer/components/DeleteItemDialog.vue';
import DuplicateItemDialog from '../../src/viewer/components/DuplicateItemDialog.vue';
import ExcludeItemDialog from '../../src/viewer/components/ExcludeItemDialog.vue';
import { useDescriptionEditor } from '../../src/viewer/editing/useDescriptionEditor';
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

function createSameItemTreeDoc(
  screenId: string,
  screenName: string,
  itemName: string,
): MockTreeDoc {
  return {
    screen: { id: screenId, name: screenName, description: '' },
    itemOrder: ['same-item', 'manual'],
    items: {
      'same-item': {
        name: itemName,
        type: 'text',
        description: '',
        note: '',
      },
      manual: { name: '手動', type: 'text', description: '', note: '' },
    },
    collectedItemIds: ['same-item'],
  };
}

function createSameItemScreen(screenId: string, itemName: string): ScreenData {
  return {
    id: screenId,
    name: screenId,
    description: '',
    path: `/${screenId}.html`,
    itemOrder: ['same-item', 'manual'],
    items: {
      'same-item': {
        name: itemName,
        type: 'text',
        description: '',
        note: '',
      },
      manual: { name: '手動', type: 'text', description: '', note: '' },
    },
    states: [
      {
        id: 'default',
        name: '初期',
        viewer: { visible: true, order: 1 },
        snapshotFile: `snapshots/${screenId}/default.html`,
      },
    ],
    interactions: [],
    status: 'linked',
    hasDescription: true,
    hasImplementation: true,
    hasPreview: true,
  };
}

function stubDualScreenFetch(options?: {
  onFetch?: (
    url: string,
    method: string,
    body: Record<string, unknown>,
  ) => Response | Promise<Response> | null;
}): ReturnType<typeof stubDescriptionTreeFetch> {
  const screenA = createSameItemScreen('screen-a', 'A項目');
  const screenB = createSameItemScreen('screen-b', 'B項目');
  return stubDescriptionTreeFetch(
    {
      'screen-a': createSameItemTreeDoc('screen-a', 'A項目', 'A項目'),
      'screen-b': createSameItemTreeDoc('screen-b', 'B項目', 'B項目'),
    },
    {
      onFetch: options?.onFetch,
      extraHandler: (url) => {
        if (url.endsWith('/data/screens/screen-a.json')) {
          return jsonResponse(screenA);
        }
        if (url.endsWith('/data/screens/screen-b.json')) {
          return jsonResponse(screenB);
        }
        if (url.endsWith('/data/snapshots/screen-a/default.html')) {
          return textResponse('<main data-a></main>');
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
}

const dualManifest: ManifestScreen[] = [
  {
    id: 'screen-a',
    name: 'Screen A',
    path: '/screen-a.html',
    dataFile: 'screens/screen-a.json',
    status: 'linked',
    hasDescription: true,
    hasImplementation: true,
    hasPreview: true,
  },
  {
    id: 'screen-b',
    name: 'Screen B',
    path: '/screen-b.html',
    dataFile: 'screens/screen-b.json',
    status: 'linked',
    hasDescription: true,
    hasImplementation: true,
    hasPreview: true,
  },
];

async function mountDualScreenPage(screenId: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/screens/:screenId', component: ScreenSpecPage, props: true }],
  });
  await router.push(`/screens/${screenId}`);
  await router.isReady();

  const manifest = computed<ViewerManifest>(() => ({
    schemaVersion: '1',
    projectName: 'sample',
    base: '/spec/',
    screens: dualManifest,
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

function createDeferredGate(): {
  wait: Promise<void>;
  release: () => void;
} {
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    wait,
    release: () => release?.(),
  };
}

describe('Viewer lifecycle', () => {
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

  describe('Screen 切替 dialog lifecycle', () => {
    it('Delete: Screen A pending 中の Screen B 切替で A dialog/target を整理する', async () => {
      const gate = createDeferredGate();
      stubDualScreenFetch({
        onFetch: (url, method) => {
          if (url.includes('/items/manual/delete') && method === 'POST') {
            return gate.wait.then(() =>
              jsonResponse({ status: 'updated', revision: 'sha256:00000000000000000000000000000000000000000000000000000000000000a2' }),
            );
          }
          return null;
        },
      });

      const { wrapper, router } = await mountDualScreenPage('screen-a');
      await wrapper.find('#item-row-manual [aria-label="削除"]').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('項目を削除しますか？');

      const dialog = wrapper.findComponent(DeleteItemDialog);
      dialog.vm.$emit('confirm', { itemId: 'manual' });
      await flushPromises();
      expect(wrapper.findComponent(DeleteItemDialog).exists()).toBe(true);

      await router.push('/screens/screen-b');
      await flushPromises();

      expect(wrapper.text()).not.toContain('項目を削除しますか？');
      expect(wrapper.findComponent(DeleteItemDialog).exists()).toBe(false);
      expect(wrapper.find('#item-row-same-item').exists()).toBe(true);
      expect(wrapper.find('#item-row-same-item').text()).toContain('B項目');

      gate.release();
      await flushPromises();
      expect(wrapper.text()).not.toContain('項目を削除しますか？');
    });

    it('Duplicate: Screen A pending 中の Screen B 切替で A dialog/target を整理する', async () => {
      const gate = createDeferredGate();
      stubDualScreenFetch({
        onFetch: (url, method) => {
          if (
            url.includes('/screen-a/items') &&
            method === 'POST' &&
            !url.includes('/delete')
          ) {
            return gate.wait.then(() =>
              jsonResponse({ status: 'updated', revision: 'sha256:00000000000000000000000000000000000000000000000000000000000000a2' }),
            );
          }
          return null;
        },
      });

      const { wrapper, router } = await mountDualScreenPage('screen-a');
      await wrapper.find('#item-row-same-item [aria-label="複製"]').trigger('click');
      await flushPromises();

      const dialog = wrapper.findComponent(DuplicateItemDialog);
      dialog.vm.$emit('create', {
        sourceItemId: 'same-item',
        itemId: 'same-item-copy',
        name: 'A項目',
        type: 'text',
        description: '',
        note: '',
      });
      await flushPromises();
      expect(wrapper.findComponent(DuplicateItemDialog).exists()).toBe(true);

      await router.push('/screens/screen-b');
      await flushPromises();

      expect(wrapper.text()).not.toContain('項目を複製');
      expect(wrapper.findComponent(DuplicateItemDialog).exists()).toBe(false);

      gate.release();
      await flushPromises();
      expect(wrapper.text()).not.toContain('項目を複製');
    });

    it('Exclude: Screen A pending 中の Screen B 切替で A dialog/target を整理する', async () => {
      const gate = createDeferredGate();
      stubDualScreenFetch({
        onFetch: (url, method) => {
          if (url.includes('/items/same-item/exclude') && method === 'POST') {
            return gate.wait.then(() =>
              jsonResponse({ status: 'updated', revision: 'sha256:00000000000000000000000000000000000000000000000000000000000000a2' }),
            );
          }
          return null;
        },
      });

      const { wrapper, router } = await mountDualScreenPage('screen-a');
      await wrapper
        .find('#item-row-same-item [aria-label="設計対象から除外"]')
        .trigger('click');
      await flushPromises();

      const dialog = wrapper.findComponent(ExcludeItemDialog);
      dialog.vm.$emit('confirm', { itemId: 'same-item' });
      await flushPromises();
      expect(wrapper.findComponent(ExcludeItemDialog).exists()).toBe(true);

      await router.push('/screens/screen-b');
      await flushPromises();

      expect(wrapper.text()).not.toContain('項目を設計対象から除外しますか？');
      expect(wrapper.findComponent(ExcludeItemDialog).exists()).toBe(false);

      gate.release();
      await flushPromises();
      expect(wrapper.text()).not.toContain('項目を設計対象から除外しますか？');
    });
  });

  describe('same-screen-reload', () => {
    it('mutation pending 中の reloadLatest は pending を維持し mutation を 1 回に保つ', async () => {
      let resolvePatch: (() => void) | undefined;
      stubDescriptionTreeFetch(
        { demo: createSameItemTreeDoc('demo', 'Demo', 'Demo') },
        {
          onFetch: (url, method) => {
            if (url.includes('/demo/screen') && method === 'PATCH') {
              return new Promise<Response>((resolve) => {
                resolvePatch = () => {
                  resolve(
                    jsonResponse({ status: 'updated', revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000002' }),
                  );
                };
              });
            }
            return null;
          },
        },
      );

      const Harness = defineComponent({
        setup() {
          const editor = useDescriptionEditor(() => 'demo');
          return { editor };
        },
        template: `<span data-pending>{{ editor.mutationPending.value }}</span>`,
      });
      const wrapper = mount(Harness);
      await wrapper.vm.editor.loadDescription('demo');
      await flushPromises();

      wrapper.vm.editor.updateScreenField('name', 'draft');
      void wrapper.vm.editor.saveScreenMetadata();
      expect(wrapper.vm.editor.mutationPending.value).toBe(true);

      await wrapper.vm.editor.reloadLatest();
      await flushPromises();
      expect(wrapper.vm.editor.mutationPending.value).toBe(true);

      const patchCalls = vi
        .mocked(global.fetch)
        .mock.calls.filter(
          ([url, init]) =>
            String(url).includes('/demo/screen') &&
            (init?.method ?? 'GET').toUpperCase() === 'PATCH',
        );
      expect(patchCalls).toHaveLength(1);

      if (resolvePatch) {
        resolvePatch();
      }
      await flushPromises();
      expect(wrapper.vm.editor.mutationPending.value).toBe(false);
    });
  });

  describe('unmount', () => {
    it('mutation pending resolve 後も unmounted instance の state を更新しない', async () => {
      let resolvePatch: (() => void) | undefined;
      stubDescriptionTreeFetch(
        { demo: createSameItemTreeDoc('demo', 'Demo', 'Demo') },
        {
          onFetch: (url, method) => {
            if (url.includes('/demo/screen') && method === 'PATCH') {
              return new Promise<Response>((resolve) => {
                resolvePatch = () => {
                  resolve(
                    jsonResponse({ status: 'updated', revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000002' }),
                  );
                };
              });
            }
            return null;
          },
        },
      );

      const Harness = defineComponent({
        setup() {
          const editor = useDescriptionEditor(() => 'demo');
          return { editor };
        },
        template: `<span data-revision>{{ editor.revision.value || '' }}</span>`,
      });
      const wrapper = mount(Harness);
      await wrapper.vm.editor.loadDescription('demo');
      await flushPromises();
      const revisionBefore = wrapper.vm.editor.revision.value;

      wrapper.vm.editor.updateScreenField('name', 'draft');
      void wrapper.vm.editor.saveScreenMetadata();
      wrapper.unmount();

      if (resolvePatch) {
        resolvePatch();
      }
      await flushPromises();

      const wrapper2 = mount(Harness);
      await wrapper2.vm.editor.loadDescription('demo');
      await flushPromises();
      expect(wrapper2.vm.editor.revision.value).toBe('sha256:0000000000000000000000000000000000000000000000000000000000000001');
      expect(wrapper2.vm.editor.revision.value).not.toBe(revisionBefore + '-stale');
      wrapper2.unmount();
    });

    it('mutation-refresh GET resolve 後も unmounted instance の snapshot を更新しない', async () => {
      let resolvePatch: (() => void) | undefined;
      let resolveTreeGet: (() => void) | undefined;
      let patchCompleted = false;
      stubDescriptionTreeFetch(
        { demo: createSameItemTreeDoc('demo', 'Demo', 'Demo') },
        {
          onFetch: (url, method) => {
            if (url.includes('/demo/screen') && method === 'PATCH') {
              return new Promise<Response>((resolve) => {
                resolvePatch = () => {
                  patchCompleted = true;
                  resolve(
                    jsonResponse({ status: 'updated', revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000002' }),
                  );
                };
              });
            }
            return null;
          },
        },
      );
      const baseFetch = global.fetch;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = (init?.method ?? 'GET').toUpperCase();
          if (
            patchCompleted &&
            method === 'GET' &&
            url.includes('/description-tree/demo')
          ) {
            return new Promise<Response>((resolve, reject) => {
              const signal = init?.signal;
              if (signal) {
                signal.addEventListener('abort', () => {
                  reject(new DOMException('Aborted', 'AbortError'));
                });
              }
              resolveTreeGet = () => {
                resolve(
                  jsonResponse({
                    revision: 'sha256:00000000000000000000000000000000000000000000000000000000000000e4',
                    sourceSchemaVersion: '1.2',
                    collectedItemIds: [],
                    description: {
                      schemaVersion: '1.3',
                      screen: { id: 'demo', name: 'Stale', description: '' },
                      rootNodes: [{ type: 'item', id: 'same-item' }],
                      groups: [],
                      items: {
                        'same-item': {
                          name: 'Stale',
                          type: 'text',
                          description: '',
                          note: '',
                        },
                      },
                      excludedItems: {},
                    },
                  }),
                );
              };
            });
          }
          return baseFetch(input, init);
        }),
      );

      const Harness = defineComponent({
        setup() {
          const editor = useDescriptionEditor(() => 'demo');
          return { editor };
        },
        template: `<span>{{ editor.draftDocument.value?.screen.name || '' }}</span>`,
      });
      const wrapper = mount(Harness);
      await wrapper.vm.editor.loadDescription('demo');
      await flushPromises();
      expect(wrapper.vm.editor.draftDocument.value?.screen.name).toBe('Demo');

      const editor = wrapper.vm.editor;
      editor.updateScreenField('name', 'draft');
      const savePromise = wrapper.vm.editor.saveScreenMetadata();
      if (resolvePatch) {
        resolvePatch();
      }
      await flushPromises();
      wrapper.unmount();

      if (resolveTreeGet) {
        resolveTreeGet();
      }
      await expect(savePromise).resolves.toEqual({ status: 'stale-or-aborted' });
      await flushPromises();
      expect(editor.snapshot.value?.description.screen.name).toBe('Demo');
      expect(editor.snapshot.value?.description.screen.name).not.toBe('Stale');
    });

    it('A→B→A では最後の A snapshot のみ適用する', async () => {
      stubDescriptionTreeFetch({
        'screen-a': createSameItemTreeDoc('screen-a', 'A最終', 'A項目'),
        'screen-b': createSameItemTreeDoc('screen-b', 'B中間', 'B項目'),
      });

      const SwitchHarness = defineComponent({
        name: 'SwitchHarness',
        setup() {
          const screenId = ref('screen-a');
          const editor = useDescriptionEditor(() => screenId.value);
          return { editor, screenId };
        },
        template: `<span data-name>{{ editor.draftDocument.value?.screen.name || '' }}</span>`,
      });

      const router = createRouter({
        history: createMemoryHistory('/spec/'),
        routes: [
          { path: '/screens/:screenId', component: SwitchHarness },
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
      const wrapper = root.findComponent(SwitchHarness);

      await wrapper.vm.editor.loadDescription('screen-a', { reason: 'initial-load' });
      await flushPromises();

      wrapper.vm.screenId = 'screen-b';
      await wrapper.vm.editor.loadDescription('screen-b', { reason: 'screen-change' });
      await flushPromises();
      expect(wrapper.vm.editor.draftDocument.value?.screen.name).toBe('B中間');

      wrapper.vm.screenId = 'screen-a';
      await wrapper.vm.editor.loadDescription('screen-a', { reason: 'screen-change' });
      await flushPromises();
      expect(wrapper.vm.editor.draftDocument.value?.screen.name).toBe('A最終');
      root.unmount();
    });
  });
});
