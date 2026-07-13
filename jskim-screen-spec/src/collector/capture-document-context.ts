import type { Page } from 'playwright';

export type DocumentContextNode = {
  class: string[];
  attributes: Record<string, string>;
};

export type DocumentContext = {
  html: DocumentContextNode;
  body: DocumentContextNode;
};

/**
 * html / body のクラスと安全な属性だけを収集する。
 * lang / dir / data-*（data-on* 除外）。style・on*・任意属性は含めない。
 */
export async function captureDocumentContext(
  page: Page,
): Promise<DocumentContext> {
  // DOM 型は Node ビルドに含めないため、evaluate は文字列で渡す
  const result = (await page.evaluate(`(() => {
    function pickSafe(el) {
      var attributes = {};
      for (var i = 0; i < el.attributes.length; i++) {
        var attr = el.attributes[i];
        var name = attr.name;
        if (name === 'style' || /^on/i.test(name)) {
          continue;
        }
        if (name === 'lang' || name === 'dir') {
          attributes[name] = attr.value;
          continue;
        }
        if (name.indexOf('data-') === 0 && name.slice(5).indexOf('on') !== 0) {
          attributes[name] = attr.value;
        }
      }
      return attributes;
    }

    var htmlEl = document.documentElement;
    var bodyEl = document.body;
    return {
      html: {
        class: htmlEl ? Array.prototype.slice.call(htmlEl.classList) : [],
        attributes: htmlEl ? pickSafe(htmlEl) : {},
      },
      body: {
        class: bodyEl ? Array.prototype.slice.call(bodyEl.classList) : [],
        attributes: bodyEl ? pickSafe(bodyEl) : {},
      },
    };
  })()`)) as DocumentContext;

  return result;
}
