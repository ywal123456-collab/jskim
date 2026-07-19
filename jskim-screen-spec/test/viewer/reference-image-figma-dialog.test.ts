import { describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ReferenceImageFigmaImportDialog from '../../src/viewer/components/ReferenceImageFigmaImportDialog.vue';

function mountImport(overrides: Record<string, unknown> = {}) {
  return mount(ReferenceImageFigmaImportDialog, {
    props: {
      mode: 'import',
      screenName: '設計画面',
      viewport: 'pc',
      hasExistingReference: false,
      existingIsFigma: false,
      submitting: false,
      serverError: '',
      confirmation: null,
      ...overrides,
    },
    attachTo: document.body,
  });
}

describe('ReferenceImageFigmaImportDialog', () => {
  it('Import open 時に URL 入力へ focus する', async () => {
    const wrapper = mountImport();
    await nextTick();
    await flushPromises();
    const input = wrapper.get('[data-testid="reference-image-figma-url"]')
      .element as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    wrapper.unmount();
  });

  it('Escape で close を emit する', async () => {
    const wrapper = mountImport();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.emitted('close')?.length).toBe(1);
    wrapper.unmount();
  });

  it('初回 submit の confirmWidthMismatch は false', async () => {
    const wrapper = mountImport();
    await wrapper
      .get('[data-testid="reference-image-figma-url"]')
      .setValue('https://www.figma.com/design/AAA/Name?node-id=1-2');
    await wrapper.get('[data-testid="reference-image-figma-submit"]').trigger('click');
    const payload = wrapper.emitted('submit')?.[0]?.[0] as {
      figmaUrl: string;
      confirmWidthMismatch: boolean;
    };
    expect(payload.confirmWidthMismatch).toBe(false);
    expect(payload.figmaUrl).toContain('figma.com');
    wrapper.unmount();
  });

  it('confirmation 表示後の再 submit は confirmWidthMismatch=true', async () => {
    const wrapper = mountImport();
    await wrapper
      .get('[data-testid="reference-image-figma-url"]')
      .setValue('https://www.figma.com/design/AAA/Name?node-id=1-2');
    await wrapper.setProps({
      confirmation: {
        code: 'SPEC_FIGMA_WIDTH_MISMATCH',
        frame: {
          frameName: 'WideFrameNameThatIsQuiteLongForLayout',
          width: 1600,
          height: 3000,
        },
        viewport: { width: 1440, height: 900 },
      },
    });
    expect(
      wrapper.find('[data-testid="reference-image-figma-width-confirm"]').exists(),
    ).toBe(true);
    await wrapper.get('[data-testid="reference-image-figma-submit"]').trigger('click');
    const payload = wrapper.emitted('submit')?.[0]?.[0] as {
      confirmWidthMismatch: boolean;
    };
    expect(payload.confirmWidthMismatch).toBe(true);
    wrapper.unmount();
  });

  it('長い serverError を text として表示し HTML 解釈しない', () => {
    const long =
      'あ'.repeat(80) +
      ' Figma API の利用上限に達しました。（約 12 秒後に再試行できます）';
    const wrapper = mountImport({ serverError: long });
    const err = wrapper.get('[data-testid="reference-image-figma-error"]');
    expect(err.text()).toContain('利用上限');
    expect(err.html()).not.toContain('<script>');
    wrapper.unmount();
  });

  it('submitting 中は submit を再 emit しない', async () => {
    const wrapper = mountImport({ submitting: true });
    await wrapper
      .get('[data-testid="reference-image-figma-url"]')
      .setValue('https://www.figma.com/design/AAA/Name?node-id=1-2');
    await wrapper.get('[data-testid="reference-image-figma-submit"]').trigger('click');
    expect(wrapper.emitted('submit')).toBeUndefined();
    wrapper.unmount();
  });
});
