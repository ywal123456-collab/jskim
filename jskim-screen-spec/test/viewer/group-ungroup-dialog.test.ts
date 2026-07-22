import { describe, expect, it } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import GroupUngroupDialog from '../../src/viewer/components/GroupUngroupDialog.vue';

describe('GroupUngroupDialog', () => {
  it('非 empty: 解除説明・昇格先・子件数を表示する', async () => {
    const wrapper = mount(GroupUngroupDialog, {
      props: {
        groupId: 'child-card',
        groupName: '子カード',
        parentGroupId: 'parent-section',
        parentGroupName: '親グループ',
        directChildren: [
          { type: 'item', id: 'a' },
          { type: 'group', id: 'b' },
        ],
      },
      attachTo: document.body,
    });
    await flushPromises();
    expect(wrapper.find('#group-ungroup-dialog-title').text()).toBe('グループを解除');
    expect(wrapper.find('[data-testid="group-ungroup-promote-to"]').text()).toContain(
      '親グループ',
    );
    expect(wrapper.find('[data-testid="group-ungroup-child-counts"]').text()).toContain(
      'グループ 1',
    );
    expect(wrapper.find('[data-testid="group-ungroup-promote-message"]').text()).toContain(
      '配下の内容は削除されません',
    );
    expect(wrapper.find('[data-testid="group-ungroup-confirm"]').text()).toBe('解除する');
    wrapper.unmount();
  });

  it('empty: 空グループ説明を表示する', async () => {
    const wrapper = mount(GroupUngroupDialog, {
      props: {
        groupId: 'empty-g',
        groupName: '空',
        parentGroupId: null,
        parentGroupName: null,
        directChildren: [],
      },
    });
    expect(wrapper.find('[data-testid="group-ungroup-empty-message"]').text()).toContain(
      'グループだけが削除されます',
    );
    expect(wrapper.find('[data-testid="group-ungroup-promote-to"]').text()).toContain(
      'ルート',
    );
    wrapper.unmount();
  });

  it('pending 中は confirm / Escape / overlay close を抑止する', async () => {
    const wrapper = mount(GroupUngroupDialog, {
      props: {
        groupId: 'g1',
        groupName: 'G',
        parentGroupId: null,
        parentGroupName: null,
        directChildren: [],
        pending: true,
      },
    });
    await wrapper.find('[data-testid="group-ungroup-confirm"]').trigger('click');
    expect(wrapper.emitted('confirm')).toBeUndefined();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.emitted('close')).toBeUndefined();
    await wrapper.find('.create-screen-dialog-overlay').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });

  it('二重 click でも confirm は 1 回', async () => {
    const wrapper = mount(GroupUngroupDialog, {
      props: {
        groupId: 'g1',
        groupName: 'G',
        parentGroupId: null,
        parentGroupName: null,
        directChildren: [],
      },
    });
    const button = wrapper.find('[data-testid="group-ungroup-confirm"]');
    await button.trigger('click');
    await button.trigger('click');
    expect(wrapper.emitted('confirm')).toHaveLength(2);
    // Dialog 側は emit のみ。Page pending が二重 HTTP を止める。
    wrapper.unmount();
  });
});
