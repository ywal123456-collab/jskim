import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import ExcludeItemDialog from '../../src/viewer/components/ExcludeItemDialog.vue';

const mountedWrappers: VueWrapper[] = [];

async function mountDialog(): Promise<VueWrapper> {
  const wrapper = mount(ExcludeItemDialog, {
    props: {
      itemId: 'layout-wrapper',
      itemName: 'レイアウト枠',
    },
    attachTo: document.body,
  });
  mountedWrappers.push(wrapper);
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe('ExcludeItemDialog', () => {
  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
  });

  it('確認文と項目情報を表示し、除外で confirm を emit する', async () => {
    const wrapper = await mountDialog();
    expect(wrapper.text()).toContain('項目を設計対象から除外しますか？');
    expect(wrapper.text()).toContain('layout-wrapper');
    expect(wrapper.text()).toContain('レイアウト枠');
    expect(wrapper.text()).toContain('入力済みの説明は保持されます');
    expect(wrapper.text()).not.toContain('削除');
    await wrapper.find('[data-action="confirm-exclude"]').trigger('click');
    expect(wrapper.emitted('confirm')).toBeTruthy();
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('キャンセル / Escape で close のみ emit する', async () => {
    const wrapper = await mountDialog();
    await wrapper.find('button.spec-page__btn--secondary').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
    expect(wrapper.emitted('confirm')).toBeFalsy();

    const again = await mountDialog();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(again.emitted('close')).toBeTruthy();
    expect(again.emitted('confirm')).toBeFalsy();
  });
});
