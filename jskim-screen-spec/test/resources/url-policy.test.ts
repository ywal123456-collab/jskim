import { describe, expect, it } from 'vitest';
import { classifyUrl, isCollectableUrl } from '../../src/collector/resources/url-policy.js';

const page = 'http://127.0.0.1:3000/crud/create.html';

describe('url-policy', () => {
  it('相対・同一 origin を収集対象にする', () => {
    expect(classifyUrl('../assets/a.css', page).classification).toBe(
      'same-origin',
    );
    expect(classifyUrl('/assets/a.css', page).classification).toBe(
      'same-origin',
    );
    expect(isCollectableUrl('same-origin')).toBe(true);
  });

  it('data / fragment を passthrough 分類する', () => {
    expect(classifyUrl('data:image/png;base64,xx', page).classification).toBe(
      'data',
    );
    expect(classifyUrl('#icon', page).classification).toBe('fragment');
  });

  it('外部・blob・file・javascript を除外分類する', () => {
    expect(
      classifyUrl('https://cdn.example.com/x.css', page).classification,
    ).toBe('external');
    expect(classifyUrl('blob:http://127.0.0.1/x', page).classification).toBe(
      'blob',
    );
    expect(classifyUrl('file:///tmp/x', page).classification).toBe('file');
    expect(classifyUrl('javascript:alert(1)', page).classification).toBe(
      'javascript',
    );
  });
});
