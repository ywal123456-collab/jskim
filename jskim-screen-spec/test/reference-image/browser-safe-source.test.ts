import { describe, expect, it } from 'vitest';
import {
  resolveBrowserSafeReferenceSource,
  toBrowserSafeReferenceSource,
} from '../../src/reference-image/browser-safe-source.js';

describe('browser-safe Reference source projection', () => {
  it('upload / figma / unknown / 欠落を安全に投影する', () => {
    expect(toBrowserSafeReferenceSource({ type: 'upload' })).toEqual({
      type: 'upload',
    });
    expect(
      toBrowserSafeReferenceSource({
        type: 'figma',
        fileKey: 'SECRET',
        nodeId: '1:2',
        frameName: 'Hero',
        importedAt: '2026-07-19T00:00:00.000Z',
        exportScale: 1,
      }),
    ).toEqual({
      type: 'figma',
      frameName: 'Hero',
      importedAt: '2026-07-19T00:00:00.000Z',
    });
    expect(toBrowserSafeReferenceSource({ type: 'other' })).toEqual({
      type: 'unknown',
    });
    expect(toBrowserSafeReferenceSource(undefined)).toBeUndefined();
    expect(resolveBrowserSafeReferenceSource(undefined)).toEqual({
      type: 'upload',
    });
  });

  it('投影結果に fileKey/nodeId を含めない', () => {
    const projected = toBrowserSafeReferenceSource({
      type: 'figma',
      fileKey: 'AAA',
      nodeId: '9:9',
      frameName: 'X',
      importedAt: '2026-07-19T00:00:00.000Z',
      exportScale: 1,
    });
    const text = JSON.stringify(projected);
    expect(text).not.toMatch(/fileKey/);
    expect(text).not.toMatch(/nodeId/);
    expect(text).not.toMatch(/AAA/);
  });

  it('空の frameName / 不正 importedAt でも壊れない', () => {
    expect(
      toBrowserSafeReferenceSource({
        type: 'figma',
        frameName: '   ',
        importedAt: 'not-a-date',
      }),
    ).toEqual({
      type: 'figma',
      frameName: '（名称不明）',
      importedAt: '',
    });
  });
});
