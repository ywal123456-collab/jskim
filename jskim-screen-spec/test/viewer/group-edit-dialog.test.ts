import { describe, expect, it } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import GroupEditDialog from '../../src/viewer/components/GroupEditDialog.vue';
import {
  MAX_GROUP_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
} from '../../src/viewer/editing/group-edit-validation';

describe('GroupEditDialog', () => {
  it('初期値を表示し groupId は read-only、未変更時は保存 disabled', async () => {
    const wrapper = mount(GroupEditDialog, {
      props: {
        groupId: 'parent-section',
        generation: 1,
        initialName: '親グループ',
        initialKind: 'SECTION',
        initialDescription: '説明文',
      },
      attachTo: document.body,
    });
    await flushPromises();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(wrapper.find('#group-edit-dialog-title').text()).toBe('グループを編集');
    expect(wrapper.find('[data-field="group-id"]').text()).toBe('parent-section');
    expect(wrapper.find('[data-field="group-id"] input').exists()).toBe(false);
    expect(
      (wrapper.find('[data-field="group-name"]').element as HTMLInputElement).value,
    ).toBe('親グループ');
    expect(
      (wrapper.find('[data-field="group-kind"]').element as HTMLSelectElement).value,
    ).toBe('SECTION');
    expect(
      (wrapper.find('[data-field="group-description"]').element as HTMLTextAreaElement)
        .value,
    ).toBe('説明文');
    expect(
      wrapper.find('[data-testid="group-edit-save"]').attributes('disabled'),
    ).toBeDefined();

    wrapper.unmount();
  });

  it('空白のみの名前は validation で保存しない', async () => {
    const wrapper = mount(GroupEditDialog, {
      props: {
        groupId: 'g1',
        generation: 1,
        initialName: '元',
        initialKind: 'CARD',
        initialDescription: '',
      },
    });
    await wrapper.find('[data-field="group-name"]').setValue('   ');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.emitted('save')).toBeUndefined();
    expect(wrapper.find('[data-error="name"]').text()).toContain('名前を入力');
    wrapper.unmount();
  });

  it('長さ超過を拒否する', async () => {
    const wrapper = mount(GroupEditDialog, {
      props: {
        groupId: 'g1',
        generation: 1,
        initialName: '元',
        initialKind: 'CARD',
        initialDescription: '',
      },
    });
    await wrapper
      .find('[data-field="group-name"]')
      .setValue('あ'.repeat(MAX_GROUP_NAME_LENGTH + 1));
    await wrapper
      .find('[data-field="group-description"]')
      .setValue('い'.repeat(MAX_GROUP_DESCRIPTION_LENGTH + 1));
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.emitted('save')).toBeUndefined();
    expect(wrapper.find('[data-error="name"]').text()).toContain(
      String(MAX_GROUP_NAME_LENGTH),
    );
    expect(wrapper.find('[data-error="description"]').text()).toContain(
      String(MAX_GROUP_DESCRIPTION_LENGTH),
    );
    wrapper.unmount();
  });

  it('変更後の保存で trim 済み payload を emit する', async () => {
    const wrapper = mount(GroupEditDialog, {
      props: {
        groupId: 'g1',
        generation: 1,
        initialName: '元',
        initialKind: 'SECTION',
        initialDescription: '旧',
      },
    });
    await wrapper.find('[data-field="group-name"]').setValue('  新名称  ');
    await wrapper.find('[data-field="group-kind"]').setValue('CARD');
    await wrapper.find('[data-field="group-description"]').setValue('  ');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.emitted('save')).toEqual([
      [{ name: '新名称', kind: 'CARD', description: null }],
    ]);
    wrapper.unmount();
  });

  it('pending 中は Escape でも閉じない', async () => {
    const wrapper = mount(GroupEditDialog, {
      props: {
        groupId: 'g1',
        generation: 1,
        initialName: '元',
        initialKind: 'SECTION',
        initialDescription: '',
        pending: true,
      },
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });

  it('同一 generation の baseline props 更新では draft を再初期化しない', async () => {
    const wrapper = mount(GroupEditDialog, {
      props: {
        groupId: 'g1',
        generation: 1,
        initialName: 'BaselineA',
        initialKind: 'SECTION',
        initialDescription: 'A',
      },
    });
    await wrapper.find('[data-field="group-name"]').setValue('DraftKeep');
    await wrapper.setProps({
      initialName: 'BaselineB',
      initialKind: 'CARD',
      initialDescription: 'B',
    });
    await flushPromises();

    expect(
      (wrapper.find('[data-field="group-name"]').element as HTMLInputElement).value,
    ).toBe('DraftKeep');
    expect(
      wrapper.find('[data-testid="group-edit-save"]').attributes('disabled'),
    ).toBeUndefined();

    await wrapper.find('[data-field="group-name"]').setValue('BaselineB');
    await wrapper.find('[data-field="group-kind"]').setValue('CARD');
    await wrapper.find('[data-field="group-description"]').setValue('B');
    await flushPromises();
    expect(
      wrapper.find('[data-testid="group-edit-save"]').attributes('disabled'),
    ).toBeDefined();
    wrapper.unmount();
  });
});
