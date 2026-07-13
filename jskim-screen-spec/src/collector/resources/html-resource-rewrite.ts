import {
  classifyUrl,
  isCollectableUrl,
  isPassthroughUrl,
} from './url-policy.js';
import { toResourceToken } from './resource-token.js';
import {
  extensionFromUrlOrType,
  kindFromExt,
  type ResourceBag,
} from './resource-bag.js';
import type { FetchResource } from './css-rewrite.js';
import { stripSvgScripts } from './strip-svg.js';
import { rewriteCss } from './css-rewrite.js';

const ATTR_URL_TAGS: Array<{
  tag: RegExp;
  attrs: string[];
}> = [
  {
    tag: /^img$/i,
    attrs: ['src', 'srcset'],
  },
  {
    tag: /^source$/i,
    attrs: ['src', 'srcset'],
  },
  {
    tag: /^video$/i,
    attrs: ['src', 'poster'],
  },
  {
    tag: /^audio$/i,
    attrs: ['src'],
  },
  {
    tag: /^image$/i,
    attrs: ['href', 'xlink:href'],
  },
  {
    tag: /^use$/i,
    attrs: ['href', 'xlink:href'],
  },
  {
    tag: /^input$/i,
    attrs: ['src'],
  },
  {
    tag: /^track$/i,
    attrs: ['src'],
  },
  {
    tag: /^embed$/i,
    attrs: ['src'],
  },
  {
    tag: /^object$/i,
    attrs: ['data'],
  },
];

export type RewriteHtmlResourcesOptions = {
  html: string;
  pageUrl: string;
  bag: ResourceBag;
  fetchResource: FetchResource;
};

/**
 * snapshot HTML 内の画像・srcset・style url() などを token 化する。
 */
export async function rewriteHtmlResources(
  options: RewriteHtmlResourcesOptions,
): Promise<string> {
  const { pageUrl, bag, fetchResource } = options;
  let html = options.html;

  // タグ単位で属性を処理
  html = await replaceAsync(
    html,
    /<([a-zA-Z][\w:-]*)(\s[^>]*)?>/g,
    async (full, tagName: string, attrChunk: string | undefined) => {
      if (!attrChunk) {
        return full;
      }
      const rules = ATTR_URL_TAGS.filter((r) => r.tag.test(tagName));
      if (rules.length === 0 && !/\sstyle\s*=/i.test(attrChunk)) {
        return full;
      }

      let nextAttrs = attrChunk;
      for (const rule of rules) {
        for (const attr of rule.attrs) {
          nextAttrs = await rewriteAttr(
            nextAttrs,
            attr,
            pageUrl,
            bag,
            fetchResource,
            attr === 'srcset',
          );
        }
      }

      if (/\sstyle\s*=/i.test(nextAttrs)) {
        nextAttrs = await rewriteStyleAttr(
          nextAttrs,
          pageUrl,
          bag,
          fetchResource,
        );
      }

      return `<${tagName}${nextAttrs}>`;
    },
  );

  return html;
}

async function rewriteAttr(
  attrChunk: string,
  attrName: string,
  pageUrl: string,
  bag: ResourceBag,
  fetchResource: FetchResource,
  isSrcset: boolean,
): Promise<string> {
  const re = new RegExp(
    `(\\s${escapeRegExp(attrName)}\\s*=\\s*)(["'])([\\s\\S]*?)\\2`,
    'i',
  );
  const match = attrChunk.match(re);
  if (!match) {
    return attrChunk;
  }

  const quote = match[2];
  const rawValue = match[3];
  let nextValue: string;

  if (isSrcset) {
    nextValue = await rewriteSrcset(
      rawValue,
      pageUrl,
      bag,
      fetchResource,
    );
  } else {
    nextValue = await rewriteSingleUrl(
      rawValue,
      pageUrl,
      bag,
      fetchResource,
    );
  }

  return attrChunk.replace(re, `$1${quote}${nextValue}${quote}`);
}

async function rewriteStyleAttr(
  attrChunk: string,
  pageUrl: string,
  bag: ResourceBag,
  fetchResource: FetchResource,
): Promise<string> {
  const re = /(\sstyle\s*=\s*)(["'])([\s\S]*?)\2/i;
  const match = attrChunk.match(re);
  if (!match) {
    return attrChunk;
  }
  const quote = match[2];
  const styleValue = match[3];
  // url() のみを扱う簡易 rewrite
  const rewritten = await rewriteCss({
    css: `x{${styleValue}}`,
    cssUrl: pageUrl,
    pageUrl,
    bag,
    fetchResource,
    applyShadowCompat: false,
  });
  const inner = rewritten.replace(/^x\s*\{\s*/i, '').replace(/\s*\}\s*$/i, '');
  return attrChunk.replace(re, `$1${quote}${inner}${quote}`);
}

async function rewriteSrcset(
  value: string,
  pageUrl: string,
  bag: ResourceBag,
  fetchResource: FetchResource,
): Promise<string> {
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const bits = part.split(/\s+/);
    const url = bits[0];
    const descriptor = bits.slice(1).join(' ');
    const nextUrl = await rewriteSingleUrl(url, pageUrl, bag, fetchResource);
    out.push(descriptor ? `${nextUrl} ${descriptor}` : nextUrl);
  }
  return out.join(', ');
}

async function rewriteSingleUrl(
  raw: string,
  pageUrl: string,
  bag: ResourceBag,
  fetchResource: FetchResource,
): Promise<string> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return raw;
  }
  // SVG fragment のみ（#icon）はそのまま
  if (trimmed.startsWith('#')) {
    return trimmed;
  }

  const classified = classifyUrl(trimmed, pageUrl);
  if (isPassthroughUrl(classified.classification)) {
    return trimmed;
  }
  if (!isCollectableUrl(classified.classification) || !classified.absoluteUrl) {
    bag.warn(`外部または非対応の HTML リソース参照を除去しました: ${trimmed}`);
    return '';
  }

  try {
    const fetched = await fetchResource(classified.absoluteUrl);
    let bytes = fetched.bytes;
    const ext = extensionFromUrlOrType(
      classified.absoluteUrl,
      fetched.contentType,
      'bin',
    );
    if (ext === 'svg') {
      bytes = stripSvgScripts(bytes);
    }
    // path に fragment が付いている場合（sprite.svg#icon）はファイル本体のみ格納し、
    // token の後ろに fragment を残す
    const fragIndex = trimmed.indexOf('#');
    const fragment =
      fragIndex >= 0 && !trimmed.startsWith('data:')
        ? trimmed.slice(fragIndex)
        : '';

    // absolute URL の hash を除いて取得済みのはず
    const resourceId = bag.put(bytes, ext, kindFromExt(ext));
    return `${toResourceToken(resourceId)}${fragment.startsWith('#') ? fragment : ''}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    bag.warn(`HTML リソースの取得に失敗しました（${trimmed}）: ${message}`);
    return '';
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function replaceAsync(
  input: string,
  regex: RegExp,
  replacer: (...args: string[]) => Promise<string>,
): Promise<string> {
  const matches = [...input.matchAll(regex)];
  if (matches.length === 0) {
    return input;
  }
  let result = '';
  let lastIndex = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    result += input.slice(lastIndex, index);
    result += await replacer(...(match as unknown as string[]));
    lastIndex = index + match[0].length;
  }
  result += input.slice(lastIndex);
  return result;
}
