import { describe, expect, it } from 'vitest';
import { ResourceBag } from '../../src/collector/resources/resource-bag.js';
import { rewriteHtmlResources } from '../../src/collector/resources/html-resource-rewrite.js';
import { RESOURCE_TOKEN_SCHEME } from '../../src/collector/resources/resource-token.js';

describe('html-resource-rewrite', () => {
  it('img src/srcset と style url を token 化し、data は残す', async () => {
    const bag = new ResourceBag();
    const files = new Map<string, Buffer>([
      ['http://127.0.0.1:9/img/a.png', Buffer.from('A')],
      ['http://127.0.0.1:9/img/b.png', Buffer.from('B')],
      ['http://127.0.0.1:9/img/c.png', Buffer.from('C')],
      [
        'http://127.0.0.1:9/img/sprite.svg',
        Buffer.from(
          '<svg><script>x()</script><g id="icon" onclick="y()"/></svg>',
        ),
      ],
    ]);

    const html = `
<main>
  <img src="./img/a.png" srcset="./img/a.png 1x, ./img/b.png 2x" />
  <img src="./img/sprite.svg#icon" />
  <div style="background-image: url('./img/c.png')"></div>
  <img src="data:image/gif;base64,xx" />
  <img src="https://cdn.example.com/z.png" />
</main>
`;

    const out = await rewriteHtmlResources({
      html,
      pageUrl: 'http://127.0.0.1:9/index.html',
      bag,
      fetchResource: async (url) => {
        const clean = url.replace(/#.*$/, '');
        const bytes = files.get(clean);
        if (!bytes) {
          throw new Error(`missing ${clean}`);
        }
        return { bytes, contentType: null };
      },
    });

    expect(out).toContain(RESOURCE_TOKEN_SCHEME);
    expect(out).toContain('#icon');
    expect(out).toContain('data:image/gif;base64,xx');
    expect(out).not.toContain('https://cdn.example.com');
    expect(bag.warnings.some((w) => w.includes('外部'))).toBe(true);

    const svg = [...bag.list()].find((f) => f.ext === 'svg');
    expect(svg).toBeTruthy();
    const svgText = svg!.bytes.toString('utf8');
    expect(svgText).not.toMatch(/<script/i);
    expect(svgText).not.toMatch(/onclick/i);
  });

  it('同一 basename でも内容が違えば別 resource になる', async () => {
    const bag = new ResourceBag();
    const out = await rewriteHtmlResources({
      html: `<img src="/a/same.png" /><img src="/b/same.png" />`,
      pageUrl: 'http://127.0.0.1:9/',
      bag,
      fetchResource: async (url) => {
        if (url.endsWith('/a/same.png')) {
          return { bytes: Buffer.from('CONTENT-A'), contentType: 'image/png' };
        }
        return { bytes: Buffer.from('CONTENT-B'), contentType: 'image/png' };
      },
    });
    const ids = [...out.matchAll(/jskim-spec-resource:\/\/([^\s"']+)/g)].map(
      (m) => m[1],
    );
    expect(new Set(ids).size).toBe(2);
  });
});
