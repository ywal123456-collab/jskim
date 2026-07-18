import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import DeleteScreenDialog from '../../src/viewer/components/DeleteScreenDialog.vue';
import type { ViewerManifest } from '../../src/viewer/types';

const mountedWrappers: VueWrapper[] = [];

async function mountDialog(options: {
  status?: 'design-only' | 'linked';
  sourceDirty?: boolean;
  sourceSaving?: boolean;
  expectedRevision?: string | null;
  screenIds?: string[];
} = {}) {
  window.__JSKIM_SPEC_EDIT__ = {
    enabled: true,
    apiBase: '/_jskim/spec/descriptions',
  };
  const screenIds = options.screenIds || ['a', 'b', 'c'];
  const router = createRouter({
    history: createMemoryHistory('/spec/'),
    routes: [
      { path: '/screens/:screenId', component: { template: '<div />' } },
      { path: '/', redirect: '/screens/b' },
    ],
  });
  await router.push('/screens/b');
  await router.isReady();

  const manifest = computed<ViewerManifest>(() => ({
    schemaVersion: '1',
    projectName: 'sample',
    base: '/spec/',
    screens: screenIds.map((id) => ({
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

  const wrapper = mount(DeleteScreenDialog, {
    props: {
      screenId: 'b',
      screenName: 'お問い合わせ内容入力',
      status: options.status ?? 'design-only',
      sourceDirty: options.sourceDirty ?? false,
      sourceSaving: options.sourceSaving ?? false,
      expectedRevision: options.expectedRevision ?? 'sha256:rev1',
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
  return { wrapper, router };
}

describe('DeleteScreenDialog', () => {
  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    delete window.__JSKIM_SPEC_EDIT__;
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('DESIGN_ONLY の確認文言を出す', async () => {
    const { wrapper } = await mountDialog({ status: 'design-only' });
    expect(wrapper.text()).toContain('画面設計を削除しますか？');
    expect(wrapper.text()).toContain('画面一覧から消えます');
    expect(wrapper.text()).toContain('JSONファイルが削除されます');
    expect(wrapper.find('[data-action="confirm-delete-screen"]').text()).toBe(
      '削除',
    );
  });

  it('LINKED の確認文言を出す（実装は残る）', async () => {
    const { wrapper } = await mountDialog({ status: 'linked' });
    expect(wrapper.text()).toContain('画面設計書のみ削除しますか？');
    expect(wrapper.text()).toContain('実装画面やソースファイル、Previewは削除されません');
    expect(wrapper.text()).toContain('実装のみ');
    expect(wrapper.find('[data-action="confirm-delete-screen"]').text()).toBe(
      '画面設計書を削除',
    );
  });

  it('キャンセルで close する', async () => {
    const { wrapper } = await mountDialog();
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'キャンセル')!
      .trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('dirty のときは confirm disabled で DELETE しない', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = await mountDialog({ sourceDirty: true });
    expect(
      wrapper.find('[data-action="confirm-delete-screen"]').attributes(
        'disabled',
      ),
    ).toBeDefined();
    await wrapper.find('[data-action="confirm-delete-screen"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain(
      '画面設計を削除する前に、編集中の変更を保存またはキャンセルしてください。',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('expectedRevision を付けて DELETE し、次画面へ遷移する', async () => {
    let deleteCalls = 0;
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
                  id: 'a',
                  name: 'a',
                  path: '',
                  dataFile: 'screens/a.json',
                  status: 'design-only',
                  hasDescription: true,
                  hasImplementation: false,
                  hasPreview: false,
                },
                {
                  id: 'c',
                  name: 'c',
                  path: '',
                  dataFile: 'screens/c.json',
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
        expect(init?.method).toBe('DELETE');
        deleteCalls += 1;
        const body = JSON.parse(String(init?.body));
        expect(body.expectedRevision).toBe('sha256:rev1');
        return new Response(
          JSON.stringify({ screenId: 'b', deleted: true }),
          { status: 200 },
        );
      }),
    );

    const { wrapper, router } = await mountDialog({
      status: 'design-only',
      screenIds: ['a', 'b', 'c'],
    });
    await wrapper.find('[data-action="confirm-delete-screen"]').trigger('click');
    await flushPromises();
    expect(deleteCalls).toBe(1);
    expect(wrapper.emitted('completed')?.[0]).toEqual([
      { kind: 'design-only' },
    ]);
    expect(router.currentRoute.value.path).toBe('/screens/c');
  });

  it('重複 submit を防ぐ', async () => {
    let resolveDelete!: (value: Response) => void;
    const deletePromise = new Promise<Response>((resolve) => {
      resolveDelete = resolve;
    });
    let deleteCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('manifest.json')) {
          return new Response(
            JSON.stringify({ screens: [{ id: 'a' }] }),
            { status: 200 },
          );
        }
        if (init?.method === 'DELETE') {
          deleteCalls += 1;
          return deletePromise;
        }
        return new Response('no', { status: 404 });
      }),
    );

    const { wrapper } = await mountDialog({
      screenIds: ['a', 'b'],
    });
    const confirm = wrapper.find('[data-action="confirm-delete-screen"]');
    await confirm.trigger('click');
    await nextTick();
    expect(wrapper.text()).toContain('削除中…');
    await confirm.trigger('click');
    await nextTick();
    expect(deleteCalls).toBe(1);
    resolveDelete(
      new Response(JSON.stringify({ screenId: 'b', deleted: true }), {
        status: 200,
      }),
    );
    await flushPromises();
  });

  it('409 では fallback せず reload action を出す', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return new Response(
          JSON.stringify({
            code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
            message:
              '画面設計書が別の処理で更新されています。最新の内容を読み込み直してください。',
          }),
          { status: 409 },
        );
      }
      return new Response('no', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper, router } = await mountDialog();
    await wrapper.find('[data-action="confirm-delete-screen"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('別の処理で更新されています');
    expect(
      wrapper.find('[data-action="reload-after-delete-conflict"]').exists(),
    ).toBe(true);
    expect(wrapper.emitted('completed')).toBeFalsy();
    expect(router.currentRoute.value.path).toBe('/screens/b');
  });

  it('LINKED 削除後は同じ route を維持する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('manifest.json')) {
          return new Response(
            JSON.stringify({
              screens: [
                {
                  id: 'b',
                  status: 'implementation-only',
                  hasDescription: false,
                  hasImplementation: true,
                },
              ],
            }),
            { status: 200 },
          );
        }
        expect(init?.method).toBe('DELETE');
        return new Response(
          JSON.stringify({ screenId: 'b', deleted: true }),
          { status: 200 },
        );
      }),
    );

    const { wrapper, router } = await mountDialog({ status: 'linked' });
    await wrapper.find('[data-action="confirm-delete-screen"]').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('completed')?.[0]).toEqual([{ kind: 'linked' }]);
    expect(router.currentRoute.value.path).toBe('/screens/b');
  });
});
