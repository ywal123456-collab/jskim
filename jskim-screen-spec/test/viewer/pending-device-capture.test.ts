import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPendingDeviceCapture,
  peekPendingDeviceCapture,
  setPendingDeviceCapture,
} from '../../src/viewer/preview/pending-device-capture.js';

describe('pending device capture sessionStorage', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('期待 revision を保存・読取・クリアする', () => {
    setPendingDeviceCapture('sample', {
      screenId: 'demo',
      stateId: 'default',
      viewport: 'sp',
      expectedImageRevision: 'sha256:' + 'c'.repeat(64),
      expectedInputRevision: 'sha256:' + 'd'.repeat(64),
    });
    const peeked = peekPendingDeviceCapture('sample');
    expect(peeked?.viewport).toBe('sp');
    expect(peeked?.expectedImageRevision).toBe('sha256:' + 'c'.repeat(64));
    clearPendingDeviceCapture('sample');
    expect(peekPendingDeviceCapture('sample')).toBeNull();
  });

  it('壊れた値は無視する', () => {
    sessionStorage.setItem(
      'jskim-spec-pending-device-capture:sample',
      JSON.stringify({ screenId: 'x' }),
    );
    expect(peekPendingDeviceCapture('sample')).toBeNull();
  });
});
