import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import StateSelector from '../src/viewer/components/StateSelector.vue';
import type { ScreenState } from '../src/viewer/types';
import {
  setWrapperProps,
  withRecordSetProps,
} from './helpers/set-wrapper-props';

const states: ScreenState[] = [
  {
    id: 'hidden',
    name: '非表示',
    viewer: { visible: false, order: 1 },
    snapshotFile: 'snapshots/hidden.html',
  },
  {
    id: 'b',
    name: 'B',
    viewer: { visible: true, order: 20 },
    snapshotFile: 'snapshots/b.html',
  },
  {
    id: 'a',
    name: 'A',
    viewer: { visible: true, order: 10 },
    snapshotFile: 'snapshots/a.html',
  },
];

describe('StateSelector', () => {
  it('visible かつ order 昇順で A の次に B だけを出す', () => {
    const wrapper = mount(StateSelector, {
      props: {
        states,
        selectedStateId: 'a',
      },
    });

    const buttons = wrapper.findAll('button.state-selector__button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].text()).toBe('A');
    expect(buttons[1].text()).toBe('B');
    expect(wrapper.text()).not.toContain('非表示');
  });

  it('クリックで select を emit し is-active を付与する', async () => {
    const wrapper = mount(StateSelector, {
      props: {
        states,
        selectedStateId: 'a',
      },
    });

    const buttons = wrapper.findAll('button.state-selector__button');
    expect(buttons[0].classes()).toContain('is-active');
    expect(buttons[1].classes()).not.toContain('is-active');

    await buttons[1].trigger('click');
    expect(wrapper.emitted('select')).toBeTruthy();
    expect(wrapper.emitted('select')![0]).toEqual(['b']);

    await setWrapperProps(withRecordSetProps(wrapper), {
      selectedStateId: 'b',
    });
    expect(buttons[0].classes()).not.toContain('is-active');
    expect(buttons[1].classes()).toContain('is-active');
  });
});
