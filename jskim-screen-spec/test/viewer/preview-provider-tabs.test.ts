import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PreviewProviderTabs from '../../src/viewer/components/PreviewProviderTabs.vue';
import {
  setWrapperProps,
  withRecordSetProps,
} from '../helpers/set-wrapper-props';

describe('PreviewProviderTabs', () => {
  it('Live/PC/SP と aria を持つ', () => {
    const wrapper = mount(PreviewProviderTabs, {
      props: { modelValue: 'live', idPrefix: 't' },
    });
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs).toHaveLength(3);
    expect(wrapper.find('[role="tablist"]').exists()).toBe(true);
    expect(tabs[0].attributes('aria-selected')).toBe('true');
    expect(tabs[0].attributes('aria-controls')).toBe('t-panel-live');
    expect(tabs[1].attributes('id')).toBe('t-tab-pc');
  });

  it('PC/SP 選択とキーボード', async () => {
    const wrapper = mount(PreviewProviderTabs, {
      props: { modelValue: 'live', idPrefix: 'k' },
    });
    await wrapper.find('[data-provider="pc"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['pc']);

    await setWrapperProps(withRecordSetProps(wrapper), { modelValue: 'pc' });
    await wrapper.find('[role="tablist"]').trigger('keydown', {
      key: 'ArrowRight',
    });
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['sp']);

    await setWrapperProps(withRecordSetProps(wrapper), { modelValue: 'sp' });
    await wrapper.find('[role="tablist"]').trigger('keydown', { key: 'Home' });
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['live']);

    await setWrapperProps(withRecordSetProps(wrapper), { modelValue: 'live' });
    await wrapper.find('[role="tablist"]').trigger('keydown', { key: 'End' });
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['sp']);
  });

  it('参照タブを含められる', () => {
    const wrapper = mount(PreviewProviderTabs, {
      props: {
        modelValue: 'reference',
        providers: ['live', 'pc', 'sp', 'reference'],
        idPrefix: 'r',
      },
    });
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(4);
    expect(wrapper.find('[data-provider="reference"]').text()).toBe('参照');
  });
});
