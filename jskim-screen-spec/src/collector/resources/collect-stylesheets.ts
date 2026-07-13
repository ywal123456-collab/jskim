import type { Page } from 'playwright';
import { rewriteCss, type FetchResource } from './css-rewrite.js';
import {
  type ResourceBag,
  type StyleRef,
} from './resource-bag.js';
import { toResourceToken } from './resource-token.js';
import {
  classifyUrl,
  isCollectableUrl,
} from './url-policy.js';

export type CollectedStylesheets = {
  styles: StyleRef[];
  stylesheetCount: number;
};

type DomStylesheetEntry = {
  kind: 'link' | 'style';
  href: string | null;
  cssText: string;
  media: string;
  disabled: boolean;
};

/**
 * Playwright page から document 順で stylesheet を収集する。
 */
export async function collectStylesheetsFromPage(options: {
  page: Page;
  pageUrl: string;
  bag: ResourceBag;
  fetchResource?: FetchResource;
}): Promise<CollectedStylesheets> {
  const { page, pageUrl, bag } = options;
  const fetchResource =
    options.fetchResource ?? createPageFetchResource(page);

  const entries = (await page.evaluate(`(() => {
    const nodes = [
      ...document.querySelectorAll('link[rel~="stylesheet"], style'),
    ];
    return nodes.map((node) => {
      if (node.tagName.toLowerCase() === 'link') {
        const link = node;
        return {
          kind: 'link',
          href: link.href || link.getAttribute('href'),
          cssText: '',
          media: link.media || 'all',
          disabled: Boolean(link.disabled),
        };
      }
      const style = node;
      return {
        kind: 'style',
        href: null,
        cssText: style.textContent || '',
        media: style.media || 'all',
        disabled: Boolean(style.disabled),
      };
    });
  })()`)) as DomStylesheetEntry[];

  const styles: StyleRef[] = [];
  let stylesheetCount = 0;

  for (const entry of entries) {
    if (entry.disabled) {
      continue;
    }

    if (entry.kind === 'link') {
      const href = entry.href;
      if (!href) {
        bag.warn('href のない stylesheet link をスキップしました');
        continue;
      }
      const classified = classifyUrl(href, pageUrl);
      if (!isCollectableUrl(classified.classification) || !classified.absoluteUrl) {
        bag.warn(`外部 stylesheet をスキップしました: ${href}`);
        continue;
      }
      try {
        const fetched = await fetchResource(classified.absoluteUrl);
        const rewritten = await rewriteCss({
          css: fetched.bytes.toString('utf8'),
          cssUrl: classified.absoluteUrl,
          pageUrl,
          bag,
          fetchResource,
          applyShadowCompat: true,
        });
        const resourceId = bag.put(
          Buffer.from(rewritten, 'utf8'),
          'css',
          'stylesheet',
        );
        styles.push({
          kind: 'link',
          resourceId,
          media: entry.media || 'all',
          disabled: false,
        });
        stylesheetCount += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        bag.warn(`stylesheet の取得に失敗しました（${href}）: ${message}`);
      }
      continue;
    }

    // inline <style>
    try {
      const rewritten = await rewriteCss({
        css: entry.cssText,
        cssUrl: pageUrl,
        pageUrl,
        bag,
        fetchResource,
        applyShadowCompat: true,
      });
      const resourceId = bag.put(
        Buffer.from(rewritten, 'utf8'),
        'css',
        'stylesheet',
      );
      styles.push({
        kind: 'style',
        resourceId,
        media: entry.media || 'all',
        disabled: false,
      });
      stylesheetCount += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      bag.warn(`inline style の処理に失敗しました: ${message}`);
    }
  }

  return { styles, stylesheetCount };
}

export function createPageFetchResource(page: Page): FetchResource {
  return async (absoluteUrl: string) => {
    // fragment を除いて取得
    const url = absoluteUrl.replace(/#.*$/, '');
    const response = await page.request.get(url);
    if (!response.ok()) {
      throw new Error(`HTTP ${response.status()} for ${url}`);
    }
    const body = await response.body();
    const contentType = response.headers()['content-type'] || null;
    return { bytes: Buffer.from(body), contentType };
  };
}

/** テスト用: token 文字列を公開 */
export { toResourceToken };
