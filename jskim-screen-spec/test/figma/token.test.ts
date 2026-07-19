import { describe, expect, it } from 'vitest';
import {
  describeFigmaTokenPresence,
  resolveFigmaToken,
} from '../../src/figma/token.js';
import { FigmaError, maskSecret } from '../../src/figma/errors.js';

describe('Figma token 解決', () => {
  it('環境変数から token を取得する', () => {
    const token = resolveFigmaToken({
      env: { JSKIM_FIGMA_TOKEN: '  secret-token-value  ' },
    });
    expect(token).toBe('secret-token-value');
  });

  it('明示 token を優先する', () => {
    expect(
      resolveFigmaToken({
        token: 'explicit',
        env: { JSKIM_FIGMA_TOKEN: 'env' },
      }),
    ).toBe('explicit');
  });

  it('未設定・空・空白のみを拒否する', () => {
    expect(() => resolveFigmaToken({ env: {} })).toThrow(FigmaError);
    expect(() =>
      resolveFigmaToken({ env: { JSKIM_FIGMA_TOKEN: '' } }),
    ).toThrow(FigmaError);
    expect(() =>
      resolveFigmaToken({ env: { JSKIM_FIGMA_TOKEN: '   ' } }),
    ).toThrow(FigmaError);
    expect(() => resolveFigmaToken({ token: '  ' })).toThrow(FigmaError);
  });

  it('token をマスクし本体を露出しない', () => {
    const fake = 'figma-pat-ABCDEFGH123456';
    const masked = maskSecret(fake);
    expect(masked).not.toContain('ABCDEFGH');
    expect(masked).not.toBe(fake);
    const desc = describeFigmaTokenPresence(fake);
    expect(desc.present).toBe(true);
    expect(desc.masked).not.toContain('ABCDEFGH');
  });

  it('エラーメッセージに token 値を含めない', () => {
    try {
      resolveFigmaToken({ env: {} });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FigmaError);
      expect(String(err)).not.toMatch(/figma-pat/i);
      expect((err as FigmaError).message).toContain('JSKIM_FIGMA_TOKEN');
    }
  });
});
