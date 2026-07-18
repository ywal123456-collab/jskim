import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizePreviewProvider,
  previewProviderStorageKey,
  readPreferredPreviewProvider,
  resolveEffectivePreviewProvider,
  writePreferredPreviewProvider,
} from '../../src/viewer/preview/preview-provider.js';

describe('preview provider sessionStorage', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('未保存は Live、壊れた値は Live', () => {
    expect(readPreferredPreviewProvider('proj-a')).toBe('live');
    expect(normalizePreviewProvider('nope')).toBe('live');
    expect(normalizePreviewProvider(null)).toBe('live');
  });

  it('project ごとに分離し refresh 後も維持', () => {
    writePreferredPreviewProvider('proj-a', 'sp');
    writePreferredPreviewProvider('proj-b', 'pc');
    expect(readPreferredPreviewProvider('proj-a')).toBe('sp');
    expect(readPreferredPreviewProvider('proj-b')).toBe('pc');
    expect(sessionStorage.getItem(previewProviderStorageKey('proj-a'))).toBe(
      'sp',
    );
  });

  it('DESIGN_ONLY 相当では effective を live にするが preferred は保持', () => {
    writePreferredPreviewProvider('proj-a', 'sp');
    expect(
      resolveEffectivePreviewProvider('sp', { canShowDeviceTabs: false }),
    ).toBe('live');
    expect(readPreferredPreviewProvider('proj-a')).toBe('sp');
    expect(
      resolveEffectivePreviewProvider(
        readPreferredPreviewProvider('proj-a'),
        { canShowDeviceTabs: true },
      ),
    ).toBe('sp');
  });
});
