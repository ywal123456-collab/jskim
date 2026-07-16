import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import CreateItemDialog from '../../src/viewer/components/CreateItemDialog.vue';

const mountedWrappers: VueWrapper[] = [];

async function mountDialog(existingItemIds: string[] = []): Promise<VueWrapper> {
  const wrapper = mount(CreateItemDialog, {
    props: { existingItemIds },
    attachTo: document.body,
  });
  mountedWrappers.push(wrapper);
  await flushPromises();
  await nextTick();
  return wrapper;
}

async function fillValidItem(
  wrapper: VueWrapper,
  itemId = 'submit-button',
): Promise<void> {
  await wrapper.find('[data-field="item-id"]').setValue(itemId);
  await wrapper.find('[data-field="item-name"]').setValue('送信ボタン');
  await wrapper.find('[data-field="item-type"]').setValue('button');
  await wrapper.find('[data-field="item-description"]').setValue('説明');
  await wrapper.find('[data-field="item-note"]').setValue('備考');
}

describe('CreateItemDialog', () => {
  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  it('role=dialog / aria-modal / aria-labelledby を持つ', async () => {
    const wrapper = await mountDialog();
    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes('aria-modal')).toBe('true');
    const labelledBy = dialog.attributes('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toContain(
      '項目を追加',
    );
  });

  it('mount 時に項目 ID 入力へ autofocus する', async () => {
    const wrapper = await mountDialog();
    const input = wrapper.find('[data-field="item-id"]').element;
    expect(document.activeElement).toBe(input);
  });

  it('itemId が不正な形式のとき error を表示し create しない', async () => {
    const wrapper = await mountDialog();
    await wrapper.find('[data-field="item-id"]').setValue('Invalid_ID');
    await wrapper.find('[data-field="item-name"]').setValue('名前');
    await wrapper.find('[data-field="item-type"]').setValue('text');
    await wrapper.find('form').trigger('submit');

    expect(wrapper.find('[data-error="itemId"]').exists()).toBe(true);
    expect(wrapper.emitted('create')).toBeFalsy();
  });

  it('項目名が空のとき error を表示する', async () => {
    const wrapper = await mountDialog();
    await wrapper.find('[data-field="item-id"]').setValue('submit-button');
    await wrapper.find('[data-field="item-type"]').setValue('button');
    await wrapper.find('form').trigger('submit');

    expect(wrapper.find('[data-error="name"]').exists()).toBe(true);
    expect(wrapper.emitted('create')).toBeFalsy();
  });

  it('既存の itemId と重複する場合は error を表示する', async () => {
    const wrapper = await mountDialog(['title']);
    await fillValidItem(wrapper, 'title');
    await wrapper.find('form').trigger('submit');

    expect(wrapper.find('[data-error="itemId"]').exists()).toBe(true);
    expect(wrapper.emitted('create')).toBeFalsy();
  });

  it('正常な入力で create と close を emit する', async () => {
    const wrapper = await mountDialog(['title']);
    await fillValidItem(wrapper, 'submit-button');
    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('create')![0]).toEqual([
      {
        itemId: 'submit-button',
        name: '送信ボタン',
        type: 'button',
        description: '説明',
        note: '備考',
      },
    ]);
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('dirty 状態で cancel すると確認し、拒否すれば閉じない', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const wrapper = await mountDialog();
    await wrapper.find('[data-field="item-id"]').setValue('入力あり');

    await wrapper.find('button.spec-page__btn--secondary').trigger('click');
    expect(confirmSpy).toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeFalsy();

    confirmSpy.mockReturnValue(true);
    await wrapper.find('button.spec-page__btn--secondary').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('dirty でなければ確認せず overlay click で閉じる', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const wrapper = await mountDialog();

    await wrapper.find('.create-screen-dialog-overlay').trigger('click');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('Escape キーで閉じる（dirty でなければ確認なし）', async () => {
    const wrapper = await mountDialog();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(wrapper.emitted('close')).toBeTruthy();
  });
});
