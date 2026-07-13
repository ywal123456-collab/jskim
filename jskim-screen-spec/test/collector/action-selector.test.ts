import { describe, expect, it } from 'vitest';
import { escapeAttributeValue, toActionSelector } from '../../src/collector/action-selector.js';

describe('action-selector', () => {
  it('target を data-jskim-spec-action attribute selector に変換する', () => {
    expect(toActionSelector('open-help')).toBe(
      '[data-jskim-spec-action="open-help"]',
    );
  });

  it('引用符とバックスラッシュをエスケープする', () => {
    expect(escapeAttributeValue('a"b\\c')).toBe('a\\"b\\\\c');
    expect(toActionSelector('a"b')).toBe('[data-jskim-spec-action="a\\"b"]');
  });
});
