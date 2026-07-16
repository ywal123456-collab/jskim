import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import App from '../src/viewer/App.vue';
import { createAppRouter } from '../src/viewer/router';
import type { ScreenData, ViewerManifest } from '../src/viewer/types';

const manifest: ViewerManifest = {
  schemaVersion: '1',
  projectName: 'sample',
  base: '/spec/',
  screens: [
    {
      id: 'crud-create',
      name: '新規作成',
      path: '/crud/create.html',
      dataFile: 'screens/crud-create.json',
      status: 'linked',
      hasDescription: true,
      hasImplementation: true,
      hasPreview: true,
    },
    {
      id: 'crud-index',
      name: '一覧',
      path: '/crud/index.html',
      dataFile: 'screens/crud-index.json',
      status: 'linked',
      hasDescription: true,
      hasImplementation: true,
      hasPreview: true,
    },
  ],
};

const createScreen: ScreenData = {
  id: 'crud-create',
  name: '新規作成',
  description: '作成画面の説明',
  path: '/crud/create.html',
  itemOrder: ['goto-list'],
  items: {
    'goto-list': {
      name: '一覧へ',
      type: 'link',
      description: '一覧へ遷移',
      note: '',
    },
  },
  states: [
    {
      id: 'default',
      name: '初期',
      viewer: { visible: true, order: 1 },
      snapshotFile: 'snapshots/crud-create/default.html',
    },
  ],
  interactions: [
    {
      itemId: 'goto-list',
      type: 'screen-transition',
      targetScreenId: 'crud-index',
      label: '一覧へ遷移',
    },
  ],
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

const indexScreen: ScreenData = {
  id: 'crud-index',
  name: '一覧',
  description: '一覧画面の説明',
  path: '/crud/index.html',
  itemOrder: [],
  items: {},
  states: [
    {
      id: 'default',
      name: '初期',
      viewer: { visible: true, order: 1 },
      snapshotFile: 'snapshots/crud-index/default.html',
    },
  ],
  interactions: [],
  status: 'linked',
  hasDescription: true,
  hasImplementation: true,
  hasPreview: true,
};

function mockFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/data/screens/crud-create.json')) {
        return jsonResponse(createScreen);
      }
      if (url.endsWith('/data/screens/crud-index.json')) {
        return jsonResponse(indexScreen);
      }
      if (url.endsWith('/data/snapshots/crud-create/default.html')) {
        return textResponse(
          '<div data-jskim-spec-item="goto-list">一覧へ</div>',
        );
      }
      if (url.endsWith('/data/snapshots/crud-index/default.html')) {
        return textResponse('<div>一覧</div>');
      }
      if (url.endsWith('/data/theme/preview.css')) {
        return textResponse('/* preview */');
      }
      return new Response('not found', { status: 404 });
    }),
  );
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

async function mountApp(initialPath: string) {
  mockFetch();
  const router = createAppRouter(manifest);
  const wrapper = mount(App, {
    props: { manifest },
    global: { plugins: [router] },
    attachTo: document.body,
  });
  await router.push(initialPath);
  await router.isReady();
  await flushPromises();
  return { wrapper, router };
}

describe('ScreenSpecPage / App ルーター統合', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('/screens/crud-create で画面タイトルを表示する', async () => {
    const { wrapper } = await mountApp('/screens/crud-create');
    expect(wrapper.find('h1').text()).toBe('新規作成');
    expect(wrapper.find('.spec-header').exists()).toBe(true);
    expect(wrapper.find('.spec-sidebar').exists()).toBe(true);
  });

  it('screen-transition クリックでルートが変わる', async () => {
    const { wrapper, router } = await mountApp('/screens/crud-create');
    const navBtn = wrapper
      .findAll('button.item-table__action')
      .find((b) => b.text() === '一覧へ遷移');
    expect(navBtn).toBeTruthy();
    await navBtn!.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.params.screenId).toBe('crud-index');
    expect(wrapper.find('h1').text()).toBe('一覧');
    expect(wrapper.find('.spec-header').exists()).toBe(true);
    expect(wrapper.find('.spec-sidebar').exists()).toBe(true);
  });

  it('未登録画面では日本語エラーを出しヘッダー/サイドバーは残る', async () => {
    const { wrapper } = await mountApp('/screens/unknown-screen');
    expect(wrapper.text()).toContain(
      '画面「unknown-screen」は登録されていません。',
    );
    expect(wrapper.find('.spec-header').exists()).toBe(true);
    expect(wrapper.find('.spec-sidebar').exists()).toBe(true);
  });
});
