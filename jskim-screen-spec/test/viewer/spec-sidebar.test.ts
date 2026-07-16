import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import SpecSidebar from '../../src/viewer/components/SpecSidebar.vue';
import type { ManifestScreen } from '../../src/viewer/types';

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

async function mountSidebar(provide: Record<string, unknown> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/screens/:screenId', component: { template: '<div />' } }],
  });
  await router.push('/screens/design-screen');
  await router.isReady();

  return mount(SpecSidebar, {
    props: { screens },
    global: {
      plugins: [router],
      provide,
    },
  });
}

describe('SpecSidebar', () => {
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
    const wrapper = await mountSidebar({ editingEnabled: false });
    expect(wrapper.find('.spec-sidebar__create-btn').exists()).toBe(false);
  });

  it('editingEnabled が true のとき作成 button を表示し、クリックで openCreateScreen を呼ぶ', async () => {
    const openCreateScreen = vi.fn();
    const wrapper = await mountSidebar({
      editingEnabled: true,
      openCreateScreen,
    });
    const button = wrapper.find('.spec-sidebar__create-btn');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain('画面を作成');

    await button.trigger('click');
    expect(openCreateScreen).toHaveBeenCalledTimes(1);
  });
});
