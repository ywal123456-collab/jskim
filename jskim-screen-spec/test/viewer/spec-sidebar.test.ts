import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import SpecSidebar from '../../src/viewer/components/SpecSidebar.vue';
import type { ManifestScreen, ViewerManifest } from '../../src/viewer/types';

const screens: ManifestScreen[] = [
  {
    id: 'design-screen',
    name: '設計のみ画面（とても長い画面名で折り返しを確認するためのテスト用の名前）',
    path: '',
    dataFile: 'screens/design-screen.json',
    status: 'design-only',
    hasDescription: true,
    hasImplementation: false,
    hasPreview: false,
  },
  {
    id: 'impl-screen',
    name: '実装のみ画面',
    path: '/impl.html',
    dataFile: 'screens/impl-screen.json',
    status: 'implementation-only',
    hasDescription: false,
    hasImplementation: true,
    hasPreview: true,
  },
  {
    id: 'linked-screen',
    name: '連携済み画面',
    path: '/linked.html',
    dataFile: 'screens/linked-screen.json',
    status: 'linked',
    hasDescription: true,
    hasImplementation: true,
    hasPreview: true,
  },
];

const baseManifest: ViewerManifest = {
  schemaVersion: '1',
  projectName: 'sample',
  base: '/spec/',
  screens,
};

async function mountSidebar(options: {
  manifest?: Partial<ViewerManifest>;
  routeScreenId?: string;
  provide?: Record<string, unknown>;
} = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/screens/:screenId', component: { template: '<div />' } }],
  });
  const screenId = options.routeScreenId ?? 'design-screen';
  await router.push(`/screens/${screenId}`);
  await router.isReady();

  const manifest = ref<ViewerManifest>({
    ...baseManifest,
    ...options.manifest,
    screens: options.manifest?.screens ?? screens,
  });

  return mount(SpecSidebar, {
    props: { screens },
    global: {
      plugins: [router],
      provide: {
        manifest,
        editingEnabled: false,
        ...options.provide,
      },
    },
  });
}

describe('SpecSidebar', () => {
  afterEach(() => {
    delete window.__JSKIM_SPEC_FEATURE__;
  });

  it('status ごとの日本語 badge テキストを表示する', async () => {
    const wrapper = await mountSidebar();
    const badges = wrapper.findAll('.spec-sidebar__badge');
    expect(badges).toHaveLength(3);
    expect(badges[0].text()).toBe('設計のみ');
    expect(badges[1].text()).toBe('実装のみ');
    expect(badges[2].text()).toBe('連携済み');
  });

  it('画面名が省略されずリンク内にコンパクトに配置される（name と badge が同居）', async () => {
    const wrapper = await mountSidebar();
    const firstLink = wrapper.findAll('.spec-sidebar__link')[0];
    expect(firstLink.find('.spec-sidebar__link-name').exists()).toBe(true);
    expect(firstLink.find('.spec-sidebar__badge').exists()).toBe(true);
  });

  it('editingEnabled が false のとき作成 button を表示しない', async () => {
    const wrapper = await mountSidebar({ provide: { editingEnabled: false } });
    expect(wrapper.find('.spec-sidebar__create-btn').exists()).toBe(false);
  });

  it('editingEnabled が true のとき作成 button を表示し、クリックで openCreateScreen を呼ぶ', async () => {
    const openCreateScreen = vi.fn();
    const wrapper = await mountSidebar({
      provide: { editingEnabled: true, openCreateScreen },
    });
    const button = wrapper.find('.spec-sidebar__create-btn');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain('画面を作成');

    await button.trigger('click');
    expect(openCreateScreen).toHaveBeenCalledTimes(1);
  });

  it('manifest に features が無いときはフラットな画面一覧を表示する', async () => {
    const wrapper = await mountSidebar({
      manifest: { features: [], ungroupedScreenIds: [] },
    });

    expect(wrapper.find('.spec-sidebar__hierarchy').exists()).toBe(false);
    expect(wrapper.find('.spec-sidebar__list').exists()).toBe(true);
    expect(wrapper.findAll('.spec-sidebar__link')).toHaveLength(3);
    expect(wrapper.find('.spec-sidebar__ungrouped-title').exists()).toBe(false);
  });

  it('features があるときは階層一覧と未分類セクションを表示する', async () => {
    const wrapper = await mountSidebar({
      manifest: {
        features: [
          {
            featureId: 'main',
            name: 'メイン機能',
            displayOrder: 1,
            screenIds: ['design-screen'],
          },
          {
            featureId: 'sub',
            name: 'サブ機能',
            displayOrder: 2,
            screenIds: ['impl-screen'],
          },
        ],
        ungroupedScreenIds: ['linked-screen'],
      },
      routeScreenId: 'linked-screen',
    });

    expect(wrapper.find('.spec-sidebar__hierarchy').exists()).toBe(true);
    expect(wrapper.findAll('.spec-sidebar__feature-toggle')).toHaveLength(2);
    expect(wrapper.find('.spec-sidebar__feature--ungrouped').exists()).toBe(true);
    expect(wrapper.find('.spec-sidebar__ungrouped-title').text()).toBe('未分類');
    expect(wrapper.text()).toContain('連携済み画面');
  });

  it('__JSKIM_SPEC_FEATURE__ bootstrap があるときだけ「機能を管理」ボタンを表示する', async () => {
    const withoutBootstrap = await mountSidebar();
    expect(withoutBootstrap.find('.spec-sidebar__manage-btn').exists()).toBe(false);

    window.__JSKIM_SPEC_FEATURE__ = {
      enabled: true,
      mode: 'local-mutation',
      apiBase: '/_jskim/spec/features',
    };
    const withBootstrap = await mountSidebar();
    const button = withBootstrap.find('.spec-sidebar__manage-btn');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain('機能を管理');
  });

  it('bootstrap 有効時に「機能を管理」クリックで openFeatureManagement を呼ぶ', async () => {
    window.__JSKIM_SPEC_FEATURE__ = {
      enabled: true,
      mode: 'local-mutation',
      apiBase: '/_jskim/spec/features',
    };
    const openFeatureManagement = vi.fn();
    const wrapper = await mountSidebar({
      provide: { openFeatureManagement },
    });

    await wrapper.find('.spec-sidebar__manage-btn').trigger('click');
    expect(openFeatureManagement).toHaveBeenCalledTimes(1);
  });

  it('feature 折りたたみ toggle の aria-expanded を更新する', async () => {
    const wrapper = await mountSidebar({
      manifest: {
        features: [
          {
            featureId: 'main',
            name: 'メイン機能',
            displayOrder: 1,
            screenIds: ['design-screen'],
          },
        ],
        ungroupedScreenIds: ['impl-screen', 'linked-screen'],
      },
      routeScreenId: 'design-screen',
    });

    const toggle = wrapper.find('.spec-sidebar__feature-toggle');
    expect(toggle.attributes('aria-expanded')).toBe('true');

    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('false');
  });

  it('現在画面の RouterLink に aria-current="page" を付与する', async () => {
    const wrapper = await mountSidebar({
      manifest: {
        features: [
          {
            featureId: 'main',
            name: 'メイン機能',
            displayOrder: 1,
            screenIds: ['design-screen', 'impl-screen'],
          },
        ],
        ungroupedScreenIds: ['linked-screen'],
      },
      routeScreenId: 'impl-screen',
    });

    const current = wrapper
      .findAll('.spec-sidebar__link')
      .find((link) => link.attributes('aria-current') === 'page');
    expect(current).toBeDefined();
    expect(current!.find('.spec-sidebar__link-name').text()).toBe('実装のみ画面');
  });
});
