import { describe, expect, it } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import GroupCreateDialog from '../../src/viewer/components/GroupCreateDialog.vue';
import {
  MAX_GROUP_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
} from '../../src/viewer/editing/group-edit-validation';

describe('GroupCreateDialog', () => {
  it('root / child で title・追加先を切り替える', async () => {
    const root = mount(GroupCreateDialog, {
      props: {
        mode: 'root',
        generation: 1,
        parentGroupId: null,
        parentGroupName: null,
        existingNodeIds: [],
        parentDepth: null,
        parentActive: true,
      },
      attachTo: document.body,
    });
    await flushPromises();
    expect(root.find('#group-create-dialog-title').text()).toBe('グループを追加');
    expect(root.find('[data-testid="group-create-placement"]').text()).toContain(
      '追加先：ルート',
    );
    root.unmount();

    const child = mount(GroupCreateDialog, {
      props: {
        mode: 'child',
        generation: 1,
        parentGroupId: 'parent-section',
        parentGroupName: '親グループ',
        existingNodeIds: [],
        parentDepth: 1,
        parentActive: true,
      },
    });
    await flushPromises();
    expect(child.find('#group-create-dialog-title').text()).toBe('子グループを追加');
    expect(child.find('[data-testid="group-create-placement"]').text()).toContain(
      '追加先：親グループ',
    );
    child.unmount();
  });

  it('重複 groupId は HTTP 前に拒否する', async () => {
    const wrapper = mount(GroupCreateDialog, {
      props: {
        mode: 'root',
        generation: 1,
        parentGroupId: null,
        parentGroupName: null,
        existingNodeIds: ['taken-id'],
        parentDepth: null,
        parentActive: true,
      },
    });
    await wrapper.find('[data-field="group-id"]').setValue('taken-id');
    await wrapper.find('[data-field="group-name"]').setValue('名前');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('create')).toBeUndefined();
    expect(wrapper.find('[data-error="groupId"]').text()).toContain(
      '既に使用されています',
    );
    wrapper.unmount();
  });

  it('depth 8 親では context error で create しない', async () => {
    const wrapper = mount(GroupCreateDialog, {
      props: {
        mode: 'child',
        generation: 1,
        parentGroupId: 'g8',
        parentGroupName: '深層',
        existingNodeIds: [],
        parentDepth: 8,
        parentActive: true,
      },
    });
    await wrapper.find('[data-field="group-id"]').setValue('too-deep');
    await wrapper.find('[data-field="group-name"]').setValue('名前');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('create')).toBeUndefined();
    expect(wrapper.find('[data-testid="group-create-context-error"]').text()).toContain(
      '最大階層（8階層）',
    );
    wrapper.unmount();
  });

  it('長さ超過を拒否する', async () => {
    const wrapper = mount(GroupCreateDialog, {
      props: {
        mode: 'root',
        generation: 1,
        parentGroupId: null,
        parentGroupName: null,
        existingNodeIds: [],
        parentDepth: null,
        parentActive: true,
      },
    });
    await wrapper.find('[data-field="group-id"]').setValue('ok-id');
    await wrapper
      .find('[data-field="group-name"]')
      .setValue('あ'.repeat(MAX_GROUP_NAME_LENGTH + 1));
    await wrapper
      .find('[data-field="group-description"]')
      .setValue('い'.repeat(MAX_GROUP_DESCRIPTION_LENGTH + 1));
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('create')).toBeUndefined();
    expect(wrapper.find('[data-error="name"]').exists()).toBe(true);
    expect(wrapper.find('[data-error="description"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('pending 中は submit / Escape close しない', async () => {
    const wrapper = mount(GroupCreateDialog, {
      props: {
        mode: 'root',
        generation: 1,
        parentGroupId: null,
        parentGroupName: null,
        existingNodeIds: [],
        parentDepth: null,
        parentActive: true,
        pending: true,
      },
    });
    await wrapper.find('[data-field="group-id"]').setValue('new-g');
    await wrapper.find('[data-field="group-name"]').setValue('名前');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('create')).toBeUndefined();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });
});
