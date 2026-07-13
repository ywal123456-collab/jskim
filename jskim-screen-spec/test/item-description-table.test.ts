import { describe, expect, it } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ItemDescriptionTable from '../src/viewer/components/ItemDescriptionTable.vue';
import type { ScreenData } from '../src/viewer/types';

const screen: ScreenData = {
  id: 'crud-create',
  name: '新規作成',
  description: '作成画面',
  path: '/crud/create.html',
  itemOrder: ['title', 'save', 'goto-list', 'open-help'],
  items: {
    title: {
      name: 'タイトル',
      type: 'text',
      description: '見出し',
      note: '',
    },
    save: {
      name: '保存',
      type: 'button',
      description: '保存する',
      note: '',
    },
    'goto-list': {
      name: '一覧へ',
      type: 'link',
      description: '一覧画面へ',
      note: '',
    },
    'open-help': {
      name: 'ヘルプ',
      type: 'button',
      description: 'ヘルプを開く',
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
    {
      id: 'help-open',
      name: 'ヘルプ表示',
      viewer: { visible: true, order: 2 },
      snapshotFile: 'snapshots/crud-create/help-open.html',
    },
  ],
  interactions: [
    {
      itemId: 'goto-list',
      type: 'screen-transition',
      targetScreenId: 'crud-index',
      label: '一覧へ遷移',
    },
    {
      itemId: 'open-help',
      type: 'state-transition',
      targetStateId: 'help-open',
      label: 'ヘルプを開く',
    },
    {
      itemId: 'save',
      type: 'screen-transition',
      targetScreenId: 'missing-screen',
      label: '未登録先',
      unregisteredTarget: true,
    },
  ],
};

async function mountTable(selectedItemId: string | null = null) {
  const router = createRouter({
    history: createMemoryHistory('/spec/'),
    routes: [
      {
        path: '/screens/:screenId',
        name: 'screen',
        component: { template: '<div />' },
      },
      { path: '/', redirect: '/screens/crud-create' },
    ],
  });
  await router.push('/screens/crud-create');
  await router.isReady();

  const wrapper = mount(ItemDescriptionTable, {
    props: { screen, selectedItemId },
    global: { plugins: [router] },
  });
  return { wrapper, router };
}

describe('ItemDescriptionTable', () => {
  it('itemOrder どおりの行と番号を表示する', async () => {
    const { wrapper } = await mountTable();
    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(4);
    expect(rows[0].findAll('td')[0].text()).toBe('1');
    expect(rows[0].findAll('td')[1].text()).toBe('タイトル');
    expect(rows[1].findAll('td')[0].text()).toBe('2');
    expect(rows[2].findAll('td')[1].text()).toBe('一覧へ');
  });

  it('行クリックで select を emit する', async () => {
    const { wrapper } = await mountTable();
    const rows = wrapper.findAll('tbody tr');
    await rows[2].trigger('click');
    expect(wrapper.emitted('select')![0]).toEqual(['goto-list']);
  });

  it('未登録先ボタンは disabled で 画面設計書未登録 と表示する', async () => {
    const { wrapper } = await mountTable();
    const disabled = wrapper.find('button.item-table__action:disabled');
    expect(disabled.exists()).toBe(true);
    expect(disabled.text()).toBe('画面設計書未登録');
  });

  it('state-transition クリックで change-state を emit する', async () => {
    const { wrapper } = await mountTable();
    const buttons = wrapper.findAll('button.item-table__action');
    const helpBtn = buttons.find((b) => b.text() === 'ヘルプを開く');
    expect(helpBtn).toBeTruthy();
    await helpBtn!.trigger('click');
    expect(wrapper.emitted('change-state')![0]).toEqual(['help-open']);
  });

  it('screen-transition クリックで router.push する', async () => {
    const { wrapper, router } = await mountTable();
    const buttons = wrapper.findAll('button.item-table__action');
    const navBtn = buttons.find((b) => b.text() === '一覧へ遷移');
    expect(navBtn).toBeTruthy();
    await navBtn!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/screens/crud-index');
  });
});
