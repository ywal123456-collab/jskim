import { describe, expect, it } from 'vitest';
import { ResourceBag } from '../../src/collector/resources/resource-bag.js';
import { rewriteCss } from '../../src/collector/resources/css-rewrite.js';
import { RESOURCE_TOKEN_SCHEME } from '../../src/collector/resources/resource-token.js';

describe('css-rewrite', () => {
  it('@import と url() を token 化し、外部を警告除去する', async () => {
    const bag = new ResourceBag();
    const files = new Map<string, Buffer>([
      [
        'http://127.0.0.1:9/css/nested.css',
        Buffer.from('.n{background:url("../img/n.png")}'),
      ],
      ['http://127.0.0.1:9/img/n.png', Buffer.from('PNGN')],
      ['http://127.0.0.1:9/img/bg.png', Buffer.from('PNGB')],
      ['http://127.0.0.1:9/fonts/a.woff2', Buffer.from('WOFF')],
    ]);

    const css = `
@import url("./nested.css");
.box { background-image: url("../img/bg.png"); }
@font-face { font-family: X; src: url("../fonts/a.woff2"); }
.ext { background: url("https://cdn.example.com/x.png"); }
`;

    const out = await rewriteCss({
      css,
      cssUrl: 'http://127.0.0.1:9/css/main.css',
      pageUrl: 'http://127.0.0.1:9/index.html',
      bag,
      fetchResource: async (url) => {
        const bytes = files.get(url);
        if (!bytes) {
          throw new Error(`missing ${url}`);
        }
        return { bytes, contentType: null };
      },
    });

    expect(out).toContain(RESOURCE_TOKEN_SCHEME);
    expect(out).not.toContain('https://cdn.example.com');
    expect(bag.warnings.some((w) => w.includes('外部'))).toBe(true);
    expect(bag.size).toBeGreaterThanOrEqual(3);
  });
});
