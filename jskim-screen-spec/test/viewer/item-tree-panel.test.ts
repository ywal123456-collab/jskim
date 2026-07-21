import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ItemTreePanel from '../../src/viewer/components/ItemTreePanel.vue';
import type { DescriptionTreeGetResponse } from '../../src/viewer/editing/description-tree-types.js';

const nestedTree: DescriptionTreeGetResponse = {
  revision: 'sha256:' + 'c'.repeat(64),
  sourceSchemaVersion: '1.3',
  description: {
    schemaVersion: '1.3',
    screen: { id: 'demo-screen', name: 'Demo', description: '' },
    rootNodes: [
      { type: 'group', id: 'section' },
      { type: 'item', id: 'item-root' },
    ],
    groups: [
      {
        groupId: 'section',
        name: '契約情報',
        kind: 'SECTION',
        children: [
          { type: 'group', id: 'cards' },
          { type: 'item', id: 'item-nested' },
        ],
      },
      {
        groupId: 'cards',
        name: '契約カード',
        kind: 'CARD',
        children: [{ type: 'item', id: 'item-card' }],
      },
    ],
    items: {
      'item-root': { name: 'Root Item', type: 'text', description: '', note: '' },
      'item-nested': { name: 'Nested Item', type: 'text', description: '', note: '' },
      'item-card': { name: 'Card Item', type: 'text', description: '', note: '' },
    },
    excludedItems: {
      hidden: { name: 'Hidden', type: 'text', description: '', note: '' },
    },
  },
};

describe('ItemTreePanel', () => {
  it('root Group/Item 순서와 kind ラベルを表示する', () => {
    const wrapper = mount(ItemTreePanel, {
      props: {
        status: 'ready',
        response: nestedTree,
        errorMessage: '',
        expandedGroupIds: new Set(['section']),
        selectedTreeNode: null,
      },
    });
    const text = wrapper.text();
    expect(text).toContain('契約情報');
    expect(text).toContain('セクション');
    expect(text).toContain('Root Item');
    expect(text).not.toContain('Hidden');
    expect(wrapper.findAll('.item-tree__select').length).toBeGreaterThan(2);
  });

  it('toggle / select emit', async () => {
    const wrapper = mount(ItemTreePanel, {
      props: {
        status: 'ready',
        response: nestedTree,
        errorMessage: '',
        expandedGroupIds: new Set(['section']),
        selectedTreeNode: null,
      },
    });
    await wrapper.find('.item-tree__toggle').trigger('click');
    expect(wrapper.emitted('toggleGroup')?.[0]).toEqual(['section']);
    const rootItemButton = wrapper
      .findAll('.item-tree__select')
      .find((button) => button.text().includes('Root Item'));
    expect(rootItemButton).toBeTruthy();
    await rootItemButton!.trigger('click');
    expect(wrapper.emitted('selectItem')?.[0]?.[0]).toBe('item-root');
  });

  it('loading / empty / error UI', () => {
    const loading = mount(ItemTreePanel, {
      props: {
        status: 'loading',
        response: null,
        errorMessage: '',
        expandedGroupIds: new Set<string>(),
        selectedTreeNode: null,
      },
    });
    expect(loading.text()).toContain('読み込んでいます');

    const empty = mount(ItemTreePanel, {
      props: {
        status: 'empty',
        response: { ...nestedTree, description: { ...nestedTree.description, rootNodes: [] } },
        errorMessage: '',
        expandedGroupIds: new Set<string>(),
        selectedTreeNode: null,
      },
    });
    expect(empty.text()).toContain('表示する画面項目はありません');

    const error = mount(ItemTreePanel, {
      props: {
        status: 'error',
        response: null,
        errorMessage: '見つかりません。',
        expandedGroupIds: new Set<string>(),
        selectedTreeNode: null,
      },
    });
    expect(error.text()).toContain('再試行');
    expect(error.text()).toContain('見つかりません');
  });
});
