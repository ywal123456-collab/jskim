import postcss, { type Root } from 'postcss';
import selectorParser from 'postcss-selector-parser';

/**
 * Shadow DOM 互換のためセレクタを書き換える。
 * - 擬似 `:root` → `:host`
 * - 型セレクタ `html` → 擬似 `:host`
 * - 型セレクタ `body` → クラス `.preview-root`
 *   （同一 compound の class / id / pseudo / attribute は維持）
 *
 * postcss-selector-parser でトークン単位に処理する。
 * クラス名・属性値・文字列・@keyframes 名・宣言値は変更しない。
 */
export function applyShadowCompatCss(css: string): string {
  let root: Root;
  try {
    root = postcss.parse(css);
  } catch {
    return css;
  }

  root.walkRules((rule) => {
    if (!rule.selector) {
      return;
    }
    const next = rule.selectors
      .map((selector) => rewriteOneSelector(selector))
      .join(', ');
    rule.selector = next;
  });

  return root.toString();
}

function rewriteOneSelector(selector: string): string {
  try {
    return selectorParser((selectors) => {
      selectors.walkPseudos((pseudo) => {
        if (pseudo.value === ':root') {
          pseudo.value = ':host';
        }
      });

      selectors.walkTags((tag) => {
        const name = tag.value.toLowerCase();
        if (name === 'html') {
          tag.replaceWith(selectorParser.pseudo({ value: ':host' }));
          return;
        }
        if (name === 'body') {
          tag.replaceWith(
            selectorParser.className({ value: 'preview-root' }),
          );
        }
      });
    }).processSync(selector);
  } catch {
    // セレクタ parse 失敗時はその rule だけ未変更
    return selector;
  }
}
