import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import DeviceCaptureImage from '../../src/viewer/components/DeviceCaptureImage.vue';

describe('DeviceCaptureImage', () => {
  it('src/alt を表示し timestamp query を付けない', () => {
    const wrapper = mount(DeviceCaptureImage, {
      props: {
        src: '/spec/data/device-captures/a/default/pc/capture-abc.png',
        alt: '画面・default・PC Device Preview',
      },
    });
    const img = wrapper.get('img');
    expect(img.attributes('src')).toBe(
      '/spec/data/device-captures/a/default/pc/capture-abc.png',
    );
    expect(img.attributes('src')).not.toMatch(/[?&](t|timestamp|random)=/);
    expect(img.attributes('alt')).toContain('PC Device Preview');
    expect(img.classes()).toContain('preview-image__img');
  });

  it('load error を表示する', async () => {
    const wrapper = mount(DeviceCaptureImage, {
      props: {
        src: '/missing.png',
        alt: 'x',
      },
    });
    await wrapper.get('img').trigger('error');
    expect(wrapper.get('[role="alert"]').text()).toContain(
      '読み込めませんでした',
    );
  });
});
