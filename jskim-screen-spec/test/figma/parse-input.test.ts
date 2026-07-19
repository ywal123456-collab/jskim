import { describe, expect, it } from 'vitest';
import {
  normalizeNodeId,
  parseFigmaInput,
  validateFileKey,
  validateFigmaUpgradeLink,
} from '../../src/figma/parse-input.js';
import { FigmaError } from '../../src/figma/errors.js';

describe('Figma 入力パーサ', () => {
  it('正常な design URL から fileKey/nodeId を抽出する', () => {
    const r = parseFigmaInput({
      figmaUrl:
        'https://www.figma.com/design/AbCdEf123/My-Frame?node-id=1-3&query=x#hash',
    });
    expect(r).toEqual({ fileKey: 'AbCdEf123', nodeId: '1:3' });
  });

  it('figma.com ホストと file URL を受理する', () => {
    const r = parseFigmaInput({
      figmaUrl: 'https://figma.com/file/Key99/Name?node-id=12:34',
    });
    expect(r.nodeId).toBe('12:34');
    expect(r.fileKey).toBe('Key99');
  });

  it('URL encoded node-id を正規化する', () => {
    const r = parseFigmaInput({
      figmaUrl:
        'https://www.figma.com/design/Key/Name?node-id=1%3A3',
    });
    expect(r.nodeId).toBe('1:3');
  });

  it('直接入力 fileKey/nodeId を受理する', () => {
    expect(
      parseFigmaInput({ fileKey: ' Key ', nodeId: '1-2' }),
    ).toEqual({ fileKey: 'Key', nodeId: '1:2' });
  });

  it('hyphen と colon の nodeId を正規化する', () => {
    expect(normalizeNodeId('1-3')).toBe('1:3');
    expect(normalizeNodeId('1:3')).toBe('1:3');
  });

  it('類似 hostname / HTTP / userinfo を拒否する', () => {
    expect(() =>
      parseFigmaInput({
        figmaUrl: 'https://figma.com.example.com/design/K/N?node-id=1-2',
      }),
    ).toThrow(FigmaError);
    expect(() =>
      parseFigmaInput({
        figmaUrl: 'http://www.figma.com/design/K/N?node-id=1-2',
      }),
    ).toThrow(FigmaError);
    expect(() =>
      parseFigmaInput({
        figmaUrl: 'https://user:pass@www.figma.com/design/K/N?node-id=1-2',
      }),
    ).toThrow(FigmaError);
  });

  it('node-id 欠落・空・不正形式を拒否する', () => {
    expect(() =>
      parseFigmaInput({
        figmaUrl: 'https://www.figma.com/design/K/N',
      }),
    ).toThrow(FigmaError);
    expect(() => normalizeNodeId('')).toThrow(FigmaError);
    expect(() => normalizeNodeId('abc')).toThrow(FigmaError);
    expect(() => normalizeNodeId('1-2-3')).toThrow(FigmaError);
  });

  it('URL と直接入力の同時指定を拒否する', () => {
    expect(() =>
      parseFigmaInput({
        figmaUrl: 'https://www.figma.com/design/K/N?node-id=1-2',
        fileKey: 'K',
        nodeId: '1:2',
      } as never),
    ).toThrowError(/同時に指定/);
  });

  it('fileKey の path / query 混入を拒否する', () => {
    expect(() => validateFileKey('../x')).toThrow(FigmaError);
    expect(() => validateFileKey('a?b')).toThrow(FigmaError);
    expect(() => validateFileKey('')).toThrow(FigmaError);
  });

  it('Upgrade-Link を HTTPS + figma ホストのみ受理する', () => {
    expect(
      validateFigmaUpgradeLink('https://www.figma.com/pricing'),
    ).toBe('https://www.figma.com/pricing');
    expect(validateFigmaUpgradeLink('http://www.figma.com/pricing')).toBe(
      undefined,
    );
    expect(
      validateFigmaUpgradeLink('https://evil.example/figma.com'),
    ).toBe(undefined);
    expect(
      validateFigmaUpgradeLink('https://user:x@www.figma.com/pricing'),
    ).toBe(undefined);
  });
});
