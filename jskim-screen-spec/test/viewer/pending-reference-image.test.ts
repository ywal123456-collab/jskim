import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPendingReferenceImage,
  peekPendingReferenceImage,
  pendingReferenceImageKey,
  referenceImageKey,
  setPendingReferenceImage,
} from '../../src/viewer/preview/pending-reference-image.js';

describe('pending reference image sessionStorage', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('upload 形状を保存・読取・クリアする', () => {
    setPendingReferenceImage('sample', {
      operation: 'upload',
      screenId: 'demo',
      viewport: 'pc',
      expectedImageRevision: null,
      resultImageRevision: 'sha256:' + 'c'.repeat(64),
    });
    const peeked = peekPendingReferenceImage('sample');
    expect(peeked?.operation).toBe('upload');
    expect(peeked?.viewport).toBe('pc');
    if (peeked?.operation === 'upload') {
      expect(peeked.resultImageRevision).toBe('sha256:' + 'c'.repeat(64));
      expect(peeked.expectedImageRevision).toBeNull();
    }
    clearPendingReferenceImage('sample');
    expect(peekPendingReferenceImage('sample')).toBeNull();
  });

  it('replace（expectedImageRevision あり）の upload 形状を保存・読取する', () => {
    setPendingReferenceImage('sample', {
      operation: 'upload',
      screenId: 'demo',
      viewport: 'sp',
      expectedImageRevision: 'sha256:' + 'a'.repeat(64),
      resultImageRevision: 'sha256:' + 'b'.repeat(64),
    });
    const peeked = peekPendingReferenceImage('sample');
    expect(peeked?.viewport).toBe('sp');
    if (peeked?.operation === 'upload') {
      expect(peeked.expectedImageRevision).toBe('sha256:' + 'a'.repeat(64));
    }
  });

  it('delete 形状を保存・読取・クリアする', () => {
    setPendingReferenceImage('sample', {
      operation: 'delete',
      screenId: 'demo',
      viewport: 'sp',
      expectedImageRevision: 'sha256:' + 'd'.repeat(64),
      expectedMissing: true,
    });
    const peeked = peekPendingReferenceImage('sample');
    expect(peeked?.operation).toBe('delete');
    expect(peeked?.viewport).toBe('sp');
    if (peeked?.operation === 'delete') {
      expect(peeked.expectedMissing).toBe(true);
      expect(peeked.expectedImageRevision).toBe('sha256:' + 'd'.repeat(64));
    }
    clearPendingReferenceImage('sample');
    expect(peekPendingReferenceImage('sample')).toBeNull();
  });

  it('project ごとに分離する', () => {
    setPendingReferenceImage('proj-a', {
      operation: 'upload',
      screenId: 'demo',
      viewport: 'pc',
      expectedImageRevision: null,
      resultImageRevision: 'sha256:' + 'c'.repeat(64),
    });
    expect(peekPendingReferenceImage('proj-b')).toBeNull();
    expect(sessionStorage.getItem(pendingReferenceImageKey('proj-a'))).not.toBe(
      null,
    );
  });

  it('壊れた JSON は無視する', () => {
    sessionStorage.setItem(
      pendingReferenceImageKey('sample'),
      'not-json{{{',
    );
    expect(peekPendingReferenceImage('sample')).toBeNull();
  });

  it('必須項目が欠けた値は無視する', () => {
    sessionStorage.setItem(
      pendingReferenceImageKey('sample'),
      JSON.stringify({ operation: 'upload', screenId: 'demo' }),
    );
    expect(peekPendingReferenceImage('sample')).toBeNull();
  });

  it('viewport が不正な値は無視する', () => {
    sessionStorage.setItem(
      pendingReferenceImageKey('sample'),
      JSON.stringify({
        operation: 'upload',
        screenId: 'demo',
        viewport: 'tablet',
        expectedImageRevision: null,
        resultImageRevision: 'sha256:' + 'c'.repeat(64),
      }),
    );
    expect(peekPendingReferenceImage('sample')).toBeNull();
  });

  it('resultImageRevision が sha256 形式でない upload は無視する', () => {
    sessionStorage.setItem(
      pendingReferenceImageKey('sample'),
      JSON.stringify({
        operation: 'upload',
        screenId: 'demo',
        viewport: 'pc',
        expectedImageRevision: null,
        resultImageRevision: 'not-a-hash',
      }),
    );
    expect(peekPendingReferenceImage('sample')).toBeNull();
  });

  it('expectedMissing が true でない delete は無視する', () => {
    sessionStorage.setItem(
      pendingReferenceImageKey('sample'),
      JSON.stringify({
        operation: 'delete',
        screenId: 'demo',
        viewport: 'pc',
        expectedImageRevision: 'sha256:' + 'd'.repeat(64),
        expectedMissing: false,
      }),
    );
    expect(peekPendingReferenceImage('sample')).toBeNull();
  });

  it('未知の operation は無視する', () => {
    sessionStorage.setItem(
      pendingReferenceImageKey('sample'),
      JSON.stringify({
        operation: 'rename',
        screenId: 'demo',
        viewport: 'pc',
      }),
    );
    expect(peekPendingReferenceImage('sample')).toBeNull();
  });

  it('referenceImageKey は screenId と viewport を分離する', () => {
    expect(referenceImageKey('demo', 'pc')).not.toBe(
      referenceImageKey('demo', 'sp'),
    );
    expect(referenceImageKey('demo', 'pc')).not.toBe(
      referenceImageKey('other', 'pc'),
    );
  });
});
