import { describe, expect, it } from 'vitest';
import { contentHash12, resourceIdFromContent } from '../../src/collector/resources/content-hash.js';

describe('content-hash', () => {
  it('同一内容は同一 hash12 になる', () => {
    const a = contentHash12(Buffer.from('hello'));
    const b = contentHash12('hello');
    expect(a).toBe(b);
    expect(a).toHaveLength(12);
  });

  it('内容が違えば hash も違う', () => {
    expect(contentHash12('a')).not.toBe(contentHash12('b'));
  });

  it('resourceId は hash.ext 形式', () => {
    const id = resourceIdFromContent(Buffer.from('css'), 'css');
    expect(id).toMatch(/^[a-f0-9]{12}\.css$/);
  });
});
