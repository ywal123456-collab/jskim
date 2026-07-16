import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import CreateScreenDialog from '../../src/viewer/components/CreateScreenDialog.vue';
import { PENDING_SCREEN_KEY } from '../../src/viewer/editing/pending-screen';
import type { ViewerManifest } from '../../src/viewer/types';

const mountedWrappers: VueWrapper[] = [];

async function mountDialog(): Promise<{
  wrapper: VueWrapper;
  router: Router;
}> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/screens/:screenId', component: { template: '<div />' } },
    ],
  });
  await router.push('/');
  await router.isReady();

  const manifest = computed<ViewerManifest>(() => ({
    schemaVersion: '1',
    projectName: 'sample',
    base: '/spec/',
    screens: [],
  }));

  const wrapper = mount(CreateScreenDialog, {
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

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 3000,
  intervalMs = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (predicate()) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error('waitUntil timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe('CreateScreenDialog', () => {
  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    delete (window as { __JSKIM_SPEC_EDIT__?: unknown }).__JSKIM_SPEC_EDIT__;
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function enableEditing(): void {
    window.__JSKIM_SPEC_EDIT__ = {
      enabled: true,
      apiBase: '/_jskim/spec/descriptions',
    };
  }

  it('role=dialog / aria-modal / aria-labelledby を持つ', async () => {
    enableEditing();
    const { wrapper } = await mountDialog();
    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes('aria-modal')).toBe('true');
    const labelledBy = dialog.attributes('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toContain(
      '画面を作成',
    );
  });

  it('mount 時に画面 ID 入力へ autofocus する', async () => {
    enableEditing();
    const { wrapper } = await mountDialog();
    const input = wrapper.find('[data-field="screen-id"]').element;
    expect(document.activeElement).toBe(input);
  });

  it('screenId が不正な形式のとき error を表示し POST しない', async () => {
    enableEditing();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper } = await mountDialog();
    await wrapper.find('[data-field="screen-id"]').setValue('Invalid_ID');
    await wrapper.find('[data-field="name"]').setValue('テスト画面');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-error="screenId"]').exists()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('name が空のとき error を表示し POST しない', async () => {
    enableEditing();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper } = await mountDialog();
    await wrapper.find('[data-field="screen-id"]').setValue('crud-create');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-error="name"]').exists()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('description が長すぎるとき error を表示する', async () => {
    enableEditing();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper } = await mountDialog();
    await wrapper.find('[data-field="screen-id"]').setValue('crud-create');
    await wrapper.find('[data-field="name"]').setValue('新規作成');
    await wrapper
      .find('[data-field="description"]')
      .setValue('a'.repeat(10001));
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-error="description"]').exists()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('正常な入力で POST し、反映後に遷移して閉じる', async () => {
    enableEditing();
    let manifestCalls = 0;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              screenId: 'crud-create',
              revision: 'sha256:x',
              document: {
                schemaVersion: '1.0',
                screen: { id: 'crud-create', name: '新規作成', description: '' },
                items: {},
              },
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          );
        }
        manifestCalls += 1;
        const screens = manifestCalls >= 2 ? [{ id: 'crud-create' }] : [];
        return new Response(JSON.stringify({ screens }), { status: 200 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper, router } = await mountDialog();
    await wrapper.find('[data-field="screen-id"]').setValue('crud-create');
    await wrapper.find('[data-field="name"]').setValue('新規作成');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-status="waiting"]').exists()).toBe(true);
    expect(sessionStorage.getItem(PENDING_SCREEN_KEY)).toBe('crud-create');

    await waitUntil(() => wrapper.emitted('close') !== undefined);

    expect(router.currentRoute.value.path).toBe('/screens/crud-create');
    expect(sessionStorage.getItem(PENDING_SCREEN_KEY)).toBeNull();
  });

  it('サーバーエラー時は message を表示し、閉じない', async () => {
    enableEditing();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: 'SPEC_DESCRIPTION_ALREADY_EXISTS',
          message: '画面設計書「dup-screen」は既に存在します。',
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper } = await mountDialog();
    await wrapper.find('[data-field="screen-id"]').setValue('dup-screen');
    await wrapper.find('[data-field="name"]').setValue('重複');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-error="server"]').text()).toContain(
      '画面設計書「dup-screen」は既に存在します。',
    );
    expect(wrapper.emitted('close')).toBeFalsy();
  });

  it('保存中は二重送信しない', async () => {
    enableEditing();
    let postCount = 0;
    let resolvePost: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          postCount += 1;
          return new Promise<Response>((resolve) => {
            resolvePost = resolve;
          });
        }
        return new Response(JSON.stringify({ screens: [] }), { status: 200 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper } = await mountDialog();
    await wrapper.find('[data-field="screen-id"]').setValue('crud-create');
    await wrapper.find('[data-field="name"]').setValue('新規作成');
    await wrapper.find('form').trigger('submit');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(postCount).toBe(1);

    resolvePost!(
      new Response(
        JSON.stringify({
          screenId: 'crud-create',
          revision: 'sha256:x',
          document: {
            schemaVersion: '1.0',
            screen: { id: 'crud-create', name: '新規作成', description: '' },
            items: {},
          },
        }),
        { status: 201 },
      ),
    );
    await flushPromises();
  });

  it('dirty 状態で cancel すると確認し、拒否すれば閉じない', async () => {
    enableEditing();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { wrapper } = await mountDialog();
    await wrapper.find('[data-field="name"]').setValue('入力あり');

    await wrapper.find('button.spec-page__btn--secondary').trigger('click');
    expect(confirmSpy).toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeFalsy();

    confirmSpy.mockReturnValue(true);
    await wrapper.find('button.spec-page__btn--secondary').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('dirty でなければ確認せず overlay click で閉じる', async () => {
    enableEditing();
    const confirmSpy = vi.spyOn(window, 'confirm');
    const { wrapper } = await mountDialog();

    await wrapper.find('.create-screen-dialog-overlay').trigger('click');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('Escape キーで閉じる（dirty でなければ確認なし）', async () => {
    enableEditing();
    const { wrapper } = await mountDialog();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('screenId は変更不可であるヒントを表示する', async () => {
    enableEditing();
    const { wrapper } = await mountDialog();
    expect(wrapper.text()).toContain('画面IDは作成後に変更できません');
  });
});
