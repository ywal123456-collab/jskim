import { describe, expect, it } from 'vitest';
import { applyShadowCompatCss } from '../../src/collector/resources/shadow-compat-css.js';

describe('shadow-compat-css', () => {
  it(':root を :host に書き換える', () => {
    const out = applyShadowCompatCss(':root { --x: 1; }');
    expect(out).toContain(':host');
    expect(out).not.toContain(':root');
  });

  it('html を :host に書き換える', () => {
    expect(applyShadowCompatCss('html { font-size: 16px; }')).toMatch(
      /:host\s*\{/,
    );
  });

  it('body を .preview-root に書き換える', () => {
    expect(applyShadowCompatCss('body { margin: 0; }')).toMatch(
      /\.preview-root\s*\{/,
    );
  });

  it('body.app-body を .preview-root.app-body に書き換える', () => {
    const out = applyShadowCompatCss('body.app-body { margin: 0; }');
    expect(out).toMatch(/\.preview-root\.app-body\s*\{/);
    expect(out).not.toMatch(/(^|[,{\s>+~])body(\.|#|\s|{)/);
  });

  it('html body を :host .preview-root に書き換える', () => {
    expect(applyShadowCompatCss('html body { color: red; }')).toMatch(
      /:host\s+\.preview-root\s*\{/,
    );
  });

  it('html[data-theme] body.app-body を複合で書き換える', () => {
    const out = applyShadowCompatCss(
      'html[data-theme="dark"] body.app-body { color: white; }',
    );
    expect(out).toMatch(
      /:host\[data-theme=["']dark["']\]\s+\.preview-root\.app-body\s*\{/,
    );
  });

  it('body > main / body .field の子孫・子結合を維持する', () => {
    expect(applyShadowCompatCss('body > main { display: block; }')).toMatch(
      /\.preview-root\s*>\s*main\s*\{/,
    );
    expect(applyShadowCompatCss('body .field { color: red; }')).toMatch(
      /\.preview-root\s+\.field\s*\{/,
    );
  });

  it(':is(html, body) / :not(body) 内の型セレクタも書き換える', () => {
    expect(applyShadowCompatCss(':is(html, body) { margin: 0; }')).toMatch(
      /:is\(\s*:host\s*,\s*\.preview-root\s*\)/,
    );
    expect(applyShadowCompatCss(':not(body) { display: none; }')).toMatch(
      /:not\(\s*\.preview-root\s*\)/,
    );
  });

  it('クラス名・属性値に body / html を含むセレクタは変更しない', () => {
    const cases = [
      '.somebody { color: blue; }',
      '.body-card { color: blue; }',
      'html-content { color: blue; }',
      '[data-name="body"] { color: blue; }',
      '[data-selector="html body"] { color: blue; }',
      '.icon-body { color: blue; }',
    ];
    for (const css of cases) {
      const out = applyShadowCompatCss(css);
      expect(out.replace(/\s+/g, ' ').trim()).toBe(
        css.replace(/\s+/g, ' ').trim(),
      );
    }
  });

  it('@keyframes 名・宣言値の body 文字列は変更しない', () => {
    const css = `
@keyframes body-fade {
  from { opacity: 0 }
  to { opacity: 1 }
}
body {
  background-image: url("./body-background.svg");
  --body-color: red;
  content: "body";
}
`;
    const out = applyShadowCompatCss(css);
    expect(out).toContain('@keyframes body-fade');
    expect(out).toContain('url("./body-background.svg")');
    expect(out).toContain('--body-color: red');
    expect(out).toContain('content: "body"');
    expect(out).toMatch(/\.preview-root\s*\{/);
    expect(out).not.toMatch(/(^|[,{\s>+~])body(\.|#|\s|{)/);
  });

  it('複合ケースの回帰（somebody / #body を誤置換しない）', () => {
    const out = applyShadowCompatCss(`
:root { --x: 1; }
html { font-size: 16px; }
body.app-body { margin: 0; }
body .child { color: red; }
.somebody { color: blue; }
#body { color: green; }
`);
    expect(out).toContain(':host');
    expect(out).toContain('.preview-root.app-body');
    expect(out).toContain('.somebody');
    expect(out).toContain('#body');
    expect(out).not.toMatch(/(^|[,{\s>+~])body(\.|#|\s|{)/);
    expect(out).not.toMatch(/(^|[,{\s>+~])html(\.|#|\s|{)/);
  });
});
