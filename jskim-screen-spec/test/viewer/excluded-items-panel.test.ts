import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import ExcludedItemsPanel from '../../src/viewer/components/ExcludedItemsPanel.vue';

describe('ExcludedItemsPanel', () => {
  it('除外 0 件のときは描画しない', () => {
    const wrapper = mount(ExcludedItemsPanel, {
      props: {
        excludedItems: {},
        collectedItemIds: ['title'],
      },
    });
    expect(wrapper.find('.excluded-items-panel').exists()).toBe(false);
  });

  it('既定は折りたたみ、展開で itemId 順と実装状態を表示する', async () => {
    const wrapper = mount(ExcludedItemsPanel, {
      props: {
        excludedItems: {
          zebra: { name: 'Z', type: 'div', description: '', note: '' },
          alpha: { name: 'A', type: 'span', description: '', note: '' },
        },
        collectedItemIds: ['alpha'],
      },
    });

    const toggle = wrapper.find('.excluded-items-panel__toggle');
    expect(toggle.text()).toContain('除外した項目（2）');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(
      (wrapper.find('#excluded-items-panel-body').element as HTMLElement).style
        .display,
    ).toBe('none');

    await toggle.trigger('click');
    await nextTick();
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(
      (wrapper.find('#excluded-items-panel-body').element as HTMLElement).style
        .display,
    ).not.toBe('none');

    const ids = wrapper.findAll('tbody tr').map((row) => row.find('code').text());
    expect(ids).toEqual(['alpha', 'zebra']);
    expect(wrapper.text()).toContain('実装あり');
    expect(wrapper.text()).toContain('実装なし');
  });

  it('設計対象に戻すで restore を emit する', async () => {
    const wrapper = mount(ExcludedItemsPanel, {
      props: {
        excludedItems: {
          layout: {
            name: '枠',
            type: 'container',
            description: '',
            note: '',
          },
        },
        collectedItemIds: ['layout'],
      },
    });
    await wrapper.find('.excluded-items-panel__toggle').trigger('click');
    await wrapper
      .find('[aria-label="設計対象に戻す: layout"]')
      .trigger('click');
    expect(wrapper.emitted('restore')![0]).toEqual(['layout']);
  });
});
