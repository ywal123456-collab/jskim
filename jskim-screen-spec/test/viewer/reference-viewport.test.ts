import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeReferenceViewport,
  readReferenceViewport,
  referenceViewportStorageKey,
  resolveInitialReferenceViewport,
  writeReferenceViewport,
} from '../../src/viewer/preview/reference-viewport.js';
import type { ReferenceImageManifestEntry } from '../../src/viewer/types.js';

function missing(): ReferenceImageManifestEntry {
  return { status: 'missing' };
}

function invalid(): ReferenceImageManifestEntry {
  return { status: 'invalid' };
}

function current(): ReferenceImageManifestEntry {
  return {
    status: 'current',
    imagePath: 'reference-images/demo/pc/image-aa.png',
    imageRevision: 'sha256:' + 'a'.repeat(64),
    imageWidth: 1440,
    imageHeight: 900,
    viewportWidth: 1440,
    viewportHeight: 900,
    uploadedAt: '2026-07-18T00:00:00.000Z',
  };
}

describe('reference viewport sessionStorage', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('未保存は PC、壊れた値は PC にフォールバック', () => {
    expect(readReferenceViewport('proj-a')).toBe('pc');
    expect(normalizeReferenceViewport('nope')).toBe('pc');
    expect(normalizeReferenceViewport(null)).toBe('pc');
  });

  it('SP を選択すると保存され再読込でも維持する', () => {
    writeReferenceViewport('proj-a', 'sp');
    expect(readReferenceViewport('proj-a')).toBe('sp');
    expect(sessionStorage.getItem(referenceViewportStorageKey('proj-a'))).toBe(
      'sp',
    );
  });

  it('project ごとに分離する', () => {
    writeReferenceViewport('proj-a', 'sp');
    writeReferenceViewport('proj-b', 'pc');
    expect(readReferenceViewport('proj-a')).toBe('sp');
    expect(readReferenceViewport('proj-b')).toBe('pc');
  });

  it('壊れた保存値は PC として読む', () => {
    sessionStorage.setItem(referenceViewportStorageKey('proj-a'), 'invalid');
    expect(readReferenceViewport('proj-a')).toBe('pc');
  });

  it('editable では保存値が無くても常に PC を初期選択', () => {
    expect(
      resolveInitialReferenceViewport({
        projectName: 'proj-a',
        editable: true,
        referenceImages: { pc: missing(), sp: current() },
      }),
    ).toBe('pc');
  });

  it('read-only DESIGN_ONLY で SP のみ current なら SP を初期選択', () => {
    expect(
      resolveInitialReferenceViewport({
        projectName: 'proj-a',
        editable: false,
        referenceImages: { pc: missing(), sp: current() },
      }),
    ).toBe('sp');
  });

  it('read-only DESIGN_ONLY で SP のみ invalid でも SP を初期選択', () => {
    expect(
      resolveInitialReferenceViewport({
        projectName: 'proj-a',
        editable: false,
        referenceImages: { pc: missing(), sp: invalid() },
      }),
    ).toBe('sp');
  });

  it('PC が current/invalid のときは PC を初期選択', () => {
    expect(
      resolveInitialReferenceViewport({
        projectName: 'proj-a',
        editable: false,
        referenceImages: { pc: current(), sp: current() },
      }),
    ).toBe('pc');
  });

  it('保存値がある場合は referenceImages に関わらずそれを優先する', () => {
    writeReferenceViewport('proj-a', 'pc');
    expect(
      resolveInitialReferenceViewport({
        projectName: 'proj-a',
        editable: false,
        referenceImages: { pc: missing(), sp: current() },
      }),
    ).toBe('pc');
  });

  it('referenceImages が無い read-only では PC を初期選択', () => {
    expect(
      resolveInitialReferenceViewport({
        projectName: 'proj-a',
        editable: false,
      }),
    ).toBe('pc');
  });
});
