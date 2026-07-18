import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import DuplicateScreenDialog from '../../src/viewer/components/DuplicateScreenDialog.vue';
import type { ViewerManifest } from '../../src/viewer/types';

const mountedWrappers: VueWrapper[] = [];

async function mountDialog(options: {
  sourceDirty?: boolean;
  existingIds?: string[];
} = {}) {
  window.__JSKIM_SPEC_EDIT__ = {
    enabled: true,
    apiBase: '/_jskim/spec/descriptions',
  };
  const router = createRouter({
    history: createMemoryHistory('/spec/'),
    routes: [
      { path: '/screens/:screenId', component: { template: '<div />' } },
      { path: '/', redirect: '/screens/source' },
    ],
  });
  await router.push('/screens/source');
  await router.isReady();

  const manifest = computed<ViewerManifest>(() => ({
    schemaVersion: '1',
    projectName: 'sample',
    base: '/spec/',
    screens: (options.existingIds || ['source']).map((id) => ({
      id,
      name: id,
      path: '',
      dataFile: `screens/${id}.json`,
      status: 'design-only' as const,
      hasDescription: true,
      hasImplementation: false,
      hasPreview: false,
    })),
  }));

  const wrapper = mount(DuplicateScreenDialog, {
    props: {
      copyFromScreenId: 'source',
      sourceName: '複製元',
      sourceDescription: '元説明',
      sourceDirty: options.sourceDirty ?? false,
    },
    global: {
      plugins: [router],
      provide: { manifest },
    },
    attachTo: document.body,
  });
  mountedWrappers.push(wrapper);
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe('DuplicateScreenDialog', () => {
  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    delete window.__JSKIM_SPEC_EDIT__;
    vi.restoreAllMocks();
  });

  it('ID / 名を自動提案し、説明の初期値を埋める', async () => {
    const wrapper = await mountDialog({
      existingIds: ['source', 'source-copy'],
    });
    expect(wrapper.text()).toContain('画面を複製');
    expect(
      (wrapper.find('[data-field="screen-id"]').element as HTMLInputElement)
        .value,
    ).toBe('source-copy-2');
    expect(
      (wrapper.find('[data-field="screen-name"]').element as HTMLInputElement)
        .value,
    ).toBe('複製元 コピー');
    expect(
      (
        wrapper.find('[data-field="screen-description"]')
          .element as HTMLTextAreaElement
      ).value,
    ).toBe('元説明');
  });

  it('sourceDirty のときは複製 submit を拒否する', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = await mountDialog({ sourceDirty: true });
    expect(
      wrapper.find('[data-action="confirm-duplicate-screen"]').attributes(
        'disabled',
      ),
    ).toBeDefined();
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain(
      '画面を複製する前に、編集中の変更を保存してください。',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('正常 POST で copyFromScreenId を送る', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('manifest.json')) {
          return new Response(
            JSON.stringify({
              schemaVersion: '1',
              projectName: 'sample',
              base: '/spec/',
              screens: [
                {
                  id: 'source-copy',
                  name: '複製元 コピー',
                  path: '',
                  dataFile: 'screens/source-copy.json',
                  status: 'design-only',
                  hasDescription: true,
                  hasImplementation: false,
                  hasPreview: false,
                },
              ],
            }),
            { status: 200 },
          );
        }
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body));
        expect(body.copyFromScreenId).toBe('source');
        expect(body.screenId).toBe('source-copy');
        return new Response(
          JSON.stringify({
            screenId: 'source-copy',
            revision: 'sha256:x',
            document: {},
          }),
          { status: 201 },
        );
      }),
    );

    const wrapper = await mountDialog();
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('close')).toBeTruthy();
  });
});
