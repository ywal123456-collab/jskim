import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import DeleteItemDialog from '../../src/viewer/components/DeleteItemDialog.vue';

const mountedWrappers: VueWrapper[] = [];

async function mountDialog(): Promise<VueWrapper> {
  const wrapper = mount(DeleteItemDialog, {
    props: {
      itemId: 'manual-note',
      itemName: '補足',
    },
    attachTo: document.body,
  });
  mountedWrappers.push(wrapper);
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe('DeleteItemDialog', () => {
  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
  });

  it('項目 ID / 名を表示し、削除で confirm を emit する', async () => {
    const wrapper = await mountDialog();
    expect(wrapper.text()).toContain('項目を削除しますか？');
    expect(wrapper.text()).toContain('manual-note');
    expect(wrapper.text()).toContain('補足');
    await wrapper.find('[data-action="confirm-delete"]').trigger('click');
    expect(wrapper.emitted('confirm')).toBeTruthy();
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('キャンセルで close のみ emit する', async () => {
    const wrapper = await mountDialog();
    await wrapper.find('button.spec-page__btn--secondary').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
    expect(wrapper.emitted('confirm')).toBeFalsy();
  });
});
