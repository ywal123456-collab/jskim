import { describe, expect, it } from 'vitest';
import {
  VIEWPORT_PRESETS,
  getViewportPreset,
} from '../../src/device-capture/presets.js';

describe('viewport presets', () => {
  it('PC は 1440x900', () => {
    expect(VIEWPORT_PRESETS.pc).toMatchObject({
      id: 'pc',
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    });
    expect(getViewportPreset('pc').width).toBe(1440);
  });

  it('SP は 375x812', () => {
    expect(VIEWPORT_PRESETS.sp).toMatchObject({
      id: 'sp',
      width: 375,
      height: 812,
      deviceScaleFactor: 1,
    });
    expect(getViewportPreset('sp').height).toBe(812);
  });
});
