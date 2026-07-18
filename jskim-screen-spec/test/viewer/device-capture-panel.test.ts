import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import DeviceCapturePanel from '../../src/viewer/components/DeviceCapturePanel.vue';

describe('DeviceCapturePanel persisted / runtime UI', () => {
  it('current + image', () => {
    const wrapper = mount(DeviceCapturePanel, {
      props: {
        viewport: 'pc',
        screenName: '問い合わせ',
        stateName: '初期',
        capture: {
          status: 'current',
          imagePath: 'device-captures/a/default/pc/capture-aa.png',
          inputRevision: 'sha256:' + 'a'.repeat(64),
          imageRevision: 'sha256:' + 'b'.repeat(64),
          capturedAt: '2026-07-18T00:00:00.000Z',
          viewportWidth: 1440,
          viewportHeight: 900,
          imageWidth: 1440,
          imageHeight: 900,
        },
        runtime: { status: 'idle' },
        editable: true,
        collecting: false,
        statusMessage: '',
        errorMessage: '',
        infoMessage: '',
        imageBaseUrl: '/spec/',
        panelId: 'p-pc',
        labelledBy: 't-pc',
      },
    });
    expect(wrapper.get('[data-testid="device-capture-status-label"]').text()).toContain(
      '最新',
    );
    expect(wrapper.find('img').attributes('src')).toBe(
      '/spec/data/device-captures/a/default/pc/capture-aa.png',
    );
    expect(wrapper.get('[data-testid="device-capture-collect"]').attributes('aria-label')).toBe(
      'PC Previewを再収集',
    );
  });

  it('stale + image + warning', () => {
    const wrapper = mount(DeviceCapturePanel, {
      props: {
        viewport: 'sp',
        screenName: 's',
        stateName: 'd',
        capture: {
          status: 'stale',
          imagePath: 'device-captures/a/default/sp/capture-bb.png',
          inputRevision: 'sha256:' + 'a'.repeat(64),
          imageRevision: 'sha256:' + 'b'.repeat(64),
          capturedAt: '2026-07-18T00:00:00.000Z',
          viewportWidth: 375,
          viewportHeight: 812,
          imageWidth: 375,
          imageHeight: 800,
        },
        runtime: { status: 'idle' },
        editable: true,
        collecting: false,
        statusMessage: '',
        errorMessage: '',
        infoMessage: '',
        imageBaseUrl: '/spec/',
        panelId: 'p-sp',
        labelledBy: 't-sp',
      },
    });
    expect(wrapper.text()).toContain('更新が必要');
    expect(wrapper.text()).toContain('実装またはリソースが変更されています');
    expect(wrapper.find('img').exists()).toBe(true);
  });

  it('missing / invalid / collecting+stale / failed+current / read-only', () => {
    const missing = mount(DeviceCapturePanel, {
      props: {
        viewport: 'pc',
        screenName: 's',
        stateName: 'd',
        capture: { status: 'missing' },
        runtime: { status: 'idle' },
        editable: false,
        collecting: false,
        statusMessage: '',
        errorMessage: '',
        infoMessage: '',
        imageBaseUrl: '/',
        panelId: 'p',
        labelledBy: 't',
      },
    });
    expect(missing.text()).toContain('未収集');
    expect(missing.find('[data-testid="device-capture-collect"]').exists()).toBe(
      false,
    );

    const invalid = mount(DeviceCapturePanel, {
      props: {
        viewport: 'pc',
        screenName: 's',
        stateName: 'd',
        capture: { status: 'invalid' },
        runtime: { status: 'idle' },
        editable: true,
        collecting: false,
        statusMessage: '',
        errorMessage: '',
        infoMessage: '',
        imageBaseUrl: '/',
        panelId: 'p',
        labelledBy: 't',
      },
    });
    expect(invalid.text()).toContain('データ破損');
    expect(invalid.find('img').exists()).toBe(false);

    const collecting = mount(DeviceCapturePanel, {
      props: {
        viewport: 'pc',
        screenName: 's',
        stateName: 'd',
        capture: {
          status: 'stale',
          imagePath: 'device-captures/a/default/pc/c.png',
          inputRevision: 'sha256:' + 'a'.repeat(64),
          imageRevision: 'sha256:' + 'b'.repeat(64),
          capturedAt: '2026-07-18T00:00:00.000Z',
          viewportWidth: 1440,
          viewportHeight: 900,
          imageWidth: 1440,
          imageHeight: 900,
        },
        runtime: { status: 'collecting' },
        editable: true,
        collecting: true,
        statusMessage: '収集中…',
        errorMessage: '',
        infoMessage: '',
        imageBaseUrl: '/spec/',
        panelId: 'p',
        labelledBy: 't',
      },
    });
    expect(collecting.find('img').exists()).toBe(true);
    expect(collecting.get('[data-testid="device-capture-collect"]').attributes('disabled')).toBeDefined();
    expect(collecting.text()).toContain('収集中');

    const failed = mount(DeviceCapturePanel, {
      props: {
        viewport: 'pc',
        screenName: 's',
        stateName: 'd',
        capture: {
          status: 'current',
          imagePath: 'device-captures/a/default/pc/c.png',
          inputRevision: 'sha256:' + 'a'.repeat(64),
          imageRevision: 'sha256:' + 'b'.repeat(64),
          capturedAt: '2026-07-18T00:00:00.000Z',
          viewportWidth: 1440,
          viewportHeight: 900,
          imageWidth: 1440,
          imageHeight: 900,
        },
        runtime: {
          status: 'failed',
          error: { code: 'X', message: '前回の収集に失敗しました。' },
        },
        editable: true,
        collecting: false,
        statusMessage: '',
        errorMessage: '',
        infoMessage: '',
        imageBaseUrl: '/spec/',
        panelId: 'p',
        labelledBy: 't',
      },
    });
    expect(failed.find('img').exists()).toBe(true);
    expect(failed.text()).toContain('前回の収集に失敗しました');
  });
});
