import { describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ReferenceImagePanel from '../../src/viewer/components/ReferenceImagePanel.vue';
import type { ReferenceImageManifestEntry } from '../../src/viewer/types.js';
import type {
  FigmaWidthMismatchConfirmation,
  ReferenceImageRuntimeState,
} from '../../src/viewer/preview/reference-image-client.js';
import {
  setWrapperProps,
  withRecordSetProps,
} from '../helpers/set-wrapper-props';

type CurrentReferenceSource = NonNullable<
  Extract<ReferenceImageManifestEntry, { status: 'current' }>['source']
>;

function currentEntry(
  source?: CurrentReferenceSource,
): ReferenceImageManifestEntry {
  return {
    status: 'current',
    imagePath: 'reference-images/demo/pc/image-aa.png',
    imageRevision: 'sha256:' + 'a'.repeat(64),
    imageWidth: 1440,
    imageHeight: 900,
    viewportWidth: 1440,
    viewportHeight: 900,
    uploadedAt: '2026-07-18T00:00:00.000Z',
    source: source ?? { type: 'upload' },
  };
}

type ReferenceImagePanelProps = {
  viewport: 'pc' | 'sp';
  screenName: string;
  reference: ReferenceImageManifestEntry;
  runtime: ReferenceImageRuntimeState;
  editable: boolean;
  busy: boolean;
  actionsDisabled: boolean;
  statusMessage: string;
  errorMessage: string;
  infoMessage: string;
  dialogError: string;
  figmaConfirmation: FigmaWidthMismatchConfirmation | null;
  imageBaseUrl: string;
  panelId: string;
  labelledBy: string;
};

function baseProps(
  overrides: Partial<ReferenceImagePanelProps> = {},
): ReferenceImagePanelProps {
  return {
    viewport: 'pc',
    screenName: '問い合わせ',
    reference: { status: 'missing' },
    runtime: { status: 'idle' },
    editable: true,
    busy: false,
    actionsDisabled: false,
    statusMessage: '',
    errorMessage: '',
    infoMessage: '',
    dialogError: '',
    figmaConfirmation: null,
    imageBaseUrl: '/spec/',
    panelId: 'p-reference',
    labelledBy: 't-reference',
    ...overrides,
  };
}

describe('ReferenceImagePanel', () => {
  it('missing + editable では追加と Figma 取込を表示する', () => {
    const wrapper = mount(ReferenceImagePanel, {
      props: baseProps(),
    });
    expect(wrapper.get('[data-testid="reference-image-status-label"]').text()).toContain(
      '未登録',
    );
    expect(wrapper.find('[data-testid="reference-image-add"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('[data-testid="reference-image-figma-import"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-testid="reference-image-replace"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="reference-image-delete"]').exists(),
    ).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
  });

  it('current + editable では置き換え/削除ボタンと画像を表示する', () => {
    const wrapper = mount(ReferenceImagePanel, {
      props: baseProps({ reference: currentEntry() }),
    });
    expect(wrapper.get('[data-testid="reference-image-status-label"]').text()).toContain(
      '登録済み',
    );
    expect(
      wrapper.find('[data-testid="reference-image-add"]').exists(),
    ).toBe(false);
    expect(
      wrapper.get('[data-testid="reference-image-replace"]').text(),
    ).toContain('置き換え');
    expect(
      wrapper.get('[data-testid="reference-image-delete"]').text(),
    ).toContain('削除');
    expect(wrapper.get('img').attributes('src')).toBe(
      '/spec/data/reference-images/demo/pc/image-aa.png',
    );
    expect(wrapper.get('[data-testid="reference-image-meta"]').text()).toContain(
      '1440 × 900',
    );
  });

  it('invalid では action を出さず案内文を表示する', () => {
    const wrapper = mount(ReferenceImagePanel, {
      props: baseProps({ reference: { status: 'invalid' } }),
    });
    expect(wrapper.get('[data-testid="reference-image-status-label"]').text()).toContain(
      'データ破損',
    );
    expect(
      wrapper.find('[data-testid="reference-image-add"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="reference-image-replace"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="reference-image-delete"]').exists(),
    ).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[data-testid="reference-image-guidance"]').text()).toContain(
      '破損した参照画像を画面から復旧できません',
    );
  });

  it('read-only では追加/置き換え/削除/Figma ボタンを出さない', () => {
    const missing = mount(ReferenceImagePanel, {
      props: baseProps({ editable: false }),
    });
    expect(missing.find('[data-testid="reference-image-add"]').exists()).toBe(
      false,
    );
    expect(
      missing.find('[data-testid="reference-image-figma-import"]').exists(),
    ).toBe(false);
    expect(
      missing.find('[data-testid="reference-image-replace"]').exists(),
    ).toBe(false);
    expect(
      missing.find('[data-testid="reference-image-delete"]').exists(),
    ).toBe(false);
    expect(missing.get('[data-testid="reference-image-guidance"]').text()).toContain(
      '登録されていません',
    );

    const current = mount(ReferenceImagePanel, {
      props: baseProps({
        editable: false,
        reference: currentEntry({
          type: 'figma',
          frameName: 'Hero',
          importedAt: '2026-07-18T00:00:00.000Z',
        }),
      }),
    });
    expect(
      current.find('[data-testid="reference-image-add"]').exists(),
    ).toBe(false);
    expect(
      current.find('[data-testid="reference-image-figma-import"]').exists(),
    ).toBe(false);
    expect(
      current.find('[data-testid="reference-image-figma-reimport"]').exists(),
    ).toBe(false);
    expect(
      current.find('[data-testid="reference-image-replace"]').exists(),
    ).toBe(false);
    expect(
      current.find('[data-testid="reference-image-delete"]').exists(),
    ).toBe(false);
    expect(current.get('img').attributes('src')).toBe(
      '/spec/data/reference-images/demo/pc/image-aa.png',
    );
    expect(current.get('[data-testid="reference-image-source"]').text()).toContain(
      'Figma',
    );
  });

  it('uploading 中は進捗表示と現在の画像を両方表示する', () => {
    const wrapper = mount(ReferenceImagePanel, {
      props: baseProps({
        reference: currentEntry(),
        runtime: { status: 'uploading' },
        busy: true,
        actionsDisabled: true,
        statusMessage: 'アップロード中…',
      }),
    });
    expect(wrapper.get('[data-testid="reference-image-progress"]').text()).toContain(
      'アップロード中',
    );
    expect(wrapper.find('img').exists()).toBe(true);
    expect(
      wrapper.get('[data-testid="reference-image-replace"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('[data-testid="reference-image-delete"]').attributes('disabled'),
    ).toBeDefined();
  });

  it('runtime failed では errorMessage 優先でメッセージを表示する', () => {
    const withMessage = mount(ReferenceImagePanel, {
      props: baseProps({
        reference: currentEntry(),
        runtime: {
          status: 'failed',
          operation: 'upload',
          error: { code: 'X', message: '前回のアップロードに失敗しました。' },
        },
        errorMessage: '前回のアップロードに失敗しました。',
      }),
    });
    expect(withMessage.get('[data-testid="reference-image-error"]').text()).toContain(
      '前回のアップロードに失敗しました',
    );

    const deleteFailed = mount(ReferenceImagePanel, {
      props: baseProps({
        reference: currentEntry(),
        runtime: { status: 'failed', operation: 'delete' },
      }),
    });
    expect(
      deleteFailed.get('[data-testid="reference-image-error"]').text(),
    ).toContain('前回の削除に失敗しました');
  });

  it('Figma Import / Reimport ボタンと source 表示', async () => {
    const missing = mount(ReferenceImagePanel, {
      props: baseProps(),
    });
    expect(
      missing.find('[data-testid="reference-image-figma-import"]').exists(),
    ).toBe(true);
    expect(
      missing.find('[data-testid="reference-image-figma-reimport"]').exists(),
    ).toBe(false);

    const upload = mount(ReferenceImagePanel, {
      props: baseProps({ reference: currentEntry({ type: 'upload' }) }),
    });
    expect(upload.get('[data-testid="reference-image-source"]').text()).toContain(
      'アップロード',
    );
    expect(
      upload.find('[data-testid="reference-image-figma-reimport"]').exists(),
    ).toBe(false);

    const figma = mount(ReferenceImagePanel, {
      props: baseProps({
        reference: currentEntry({
          type: 'figma',
          frameName: '<script>x</script>',
          importedAt: '2026-07-18T12:34:00.000Z',
        }),
      }),
    });
    const sourceText = figma.get('[data-testid="reference-image-source"]').text();
    expect(sourceText).toContain('Figma');
    expect(sourceText).toContain('<script>x</script>');
    expect(figma.html()).not.toContain('<script>x</script></script>');
    expect(
      figma.find('[data-testid="reference-image-figma-reimport"]').exists(),
    ).toBe(true);

    await figma.get('[data-testid="reference-image-figma-import"]').trigger('click');
    expect(
      figma.find('[data-testid="reference-image-figma-dialog"]').exists(),
    ).toBe(true);
  });

  it('Figma dialog close 後に Import trigger へ focus を戻す（キャンセル）', async () => {
    const wrapper = mount(ReferenceImagePanel, {
      props: baseProps(),
      attachTo: document.body,
    });
    const importBtn = wrapper.get(
      '[data-testid="reference-image-figma-import"]',
    ).element as HTMLButtonElement;
    await wrapper.get('[data-testid="reference-image-figma-import"]').trigger('click');
    await nextTick();
    await flushPromises();
    const url = wrapper.get('[data-testid="reference-image-figma-url"]')
      .element as HTMLInputElement;
    expect(document.activeElement).toBe(url);

    await wrapper.get('[data-testid="reference-image-figma-cancel"]').trigger('click');
    await nextTick();
    await flushPromises();
    expect(wrapper.find('[data-testid="reference-image-figma-dialog"]').exists()).toBe(
      false,
    );
    expect(document.activeElement).toBe(importBtn);
    wrapper.unmount();
  });

  it('Figma dialog Escape 後に Import trigger へ focus を戻す', async () => {
    const wrapper = mount(ReferenceImagePanel, {
      props: baseProps(),
      attachTo: document.body,
    });
    const importBtn = wrapper.get(
      '[data-testid="reference-image-figma-import"]',
    ).element as HTMLButtonElement;
    await wrapper.get('[data-testid="reference-image-figma-import"]').trigger('click');
    await nextTick();
    await flushPromises();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    await flushPromises();
    expect(wrapper.find('[data-testid="reference-image-figma-dialog"]').exists()).toBe(
      false,
    );
    expect(document.activeElement).toBe(importBtn);
    wrapper.unmount();
  });

  it('Reimport trigger で開いた dialog は close 後に Reimport へ focus する', async () => {
    const wrapper = mount(ReferenceImagePanel, {
      props: baseProps({
        reference: currentEntry({
          type: 'figma',
          frameName: 'Hero',
          importedAt: '2026-07-18T12:34:00.000Z',
        }),
      }),
      attachTo: document.body,
    });
    const reimportBtn = wrapper.get(
      '[data-testid="reference-image-figma-reimport"]',
    ).element as HTMLButtonElement;
    await wrapper
      .get('[data-testid="reference-image-figma-reimport"]')
      .trigger('click');
    await nextTick();
    await flushPromises();
    await wrapper.get('[data-testid="reference-image-figma-cancel"]').trigger('click');
    await nextTick();
    await flushPromises();
    expect(document.activeElement).toBe(reimportBtn);
    wrapper.unmount();
  });

  it('trigger が DOM から消えても close で例外にならない', async () => {
    const wrapper = mount(ReferenceImagePanel, {
      props: baseProps(),
      attachTo: document.body,
    });
    await wrapper.get('[data-testid="reference-image-figma-import"]').trigger('click');
    await nextTick();
    await setWrapperProps(withRecordSetProps(wrapper), { editable: false });
    await nextTick();
    expect(
      wrapper.find('[data-testid="reference-image-figma-import"]').exists(),
    ).toBe(false);
    const exposed = wrapper.vm as typeof wrapper.vm & {
      closeFigma: () => void;
    };
    expect(typeof exposed.closeFigma).toBe('function');
    expect(() => {
      exposed.closeFigma();
    }).not.toThrow();
    await nextTick();
    await flushPromises();
    wrapper.unmount();
  });

  it('unmount 後に focus 復帰を試みない', async () => {
    const wrapper = mount(ReferenceImagePanel, {
      props: baseProps(),
      attachTo: document.body,
    });
    const importBtn = wrapper.get(
      '[data-testid="reference-image-figma-import"]',
    ).element as HTMLButtonElement;
    await wrapper.get('[data-testid="reference-image-figma-import"]').trigger('click');
    await nextTick();
    wrapper.unmount();
    await nextTick();
    await flushPromises();
    // unmount 済みのため activeElement が import に戻らないことだけ確認
    expect(document.activeElement).not.toBe(importBtn);
  });
});
