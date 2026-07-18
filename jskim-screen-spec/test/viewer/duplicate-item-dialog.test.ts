import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import DuplicateItemDialog from '../../src/viewer/components/DuplicateItemDialog.vue';

const mountedWrappers: VueWrapper[] = [];

async function mountDialog(
  existingItemIds: string[] = ['title'],
): Promise<VueWrapper> {
  const wrapper = mount(DuplicateItemDialog, {
    props: {
      existingItemIds,
      sourceItemId: 'title',
      initialName: 'タイトル',
      initialType: 'text',
      initialDescription: '説明',
      initialNote: '備考',
    },
    attachTo: document.body,
  });
  mountedWrappers.push(wrapper);
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe('DuplicateItemDialog', () => {
  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  it('itemId に -copy を自動提案し、原項目の field を初期表示する', async () => {
    const wrapper = await mountDialog();
    expect(
      (wrapper.find('[data-field="item-id"]').element as HTMLInputElement).value,
    ).toBe('title-copy');
    expect(
      (wrapper.find('[data-field="item-name"]').element as HTMLInputElement)
        .value,
    ).toBe('タイトル');
    expect(
      (wrapper.find('[data-field="item-type"]').element as HTMLInputElement)
        .value,
    ).toBe('text');
  });

  it('正常な入力で create を emit する', async () => {
    const wrapper = await mountDialog();
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('create')![0]).toEqual([
      {
        itemId: 'title-copy',
        name: 'タイトル',
        type: 'text',
        description: '説明',
        note: '備考',
      },
    ]);
  });

  it('衝突する提案を避けて -copy-2 を使う', async () => {
    const wrapper = await mountDialog(['title', 'title-copy']);
    expect(
      (wrapper.find('[data-field="item-id"]').element as HTMLInputElement).value,
    ).toBe('title-copy-2');
  });
});
