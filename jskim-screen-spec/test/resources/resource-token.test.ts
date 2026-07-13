import { describe, expect, it } from 'vitest';
import {
  rewriteResourceTokens,
  toResourceToken,
  SpecResourceTokenError,
  resourceTokenToViewerUrl,
} from '../../src/collector/resources/resource-token.js';

describe('resource-token', () => {
  it('token を base 付き URL に置換する', () => {
    const id = 'abc123def456.css';
    const css = `url("${toResourceToken(id)}")`;
    const out = rewriteResourceTokens(css, '/spec/', new Set([id]));
    expect(out).toBe('url("/spec/data/resources/files/abc123def456.css")');
  });

  it('base 末尾スラッシュを正規化する', () => {
    expect(resourceTokenToViewerUrl('a.png', '/docs/spec')).toBe(
      '/docs/spec/data/resources/files/a.png',
    );
  });

  it('未知 token で SPEC_RESOURCE_TOKEN_UNKNOWN', () => {
    expect(() =>
      rewriteResourceTokens(
        toResourceToken('missing.png'),
        '/spec/',
        new Set(),
      ),
    ).toThrow(SpecResourceTokenError);
  });
});
