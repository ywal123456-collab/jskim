import postcss from 'postcss';
import valueParser, {
  type FunctionNode,
  type Node as ValueNode,
} from 'postcss-value-parser';
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
  type ResourceKind,
} from './resource-bag.js';
import { applyShadowCompatCss } from './shadow-compat-css.js';
import { stripSvgScripts } from './strip-svg.js';

export type FetchResource = (
  absoluteUrl: string,
) => Promise<{ bytes: Buffer; contentType: string | null }>;

export type RewriteCssOptions = {
  css: string;
  /** この CSS ファイル自身の URL（相対解決の基準） */
  cssUrl: string;
  pageUrl: string;
  bag: ResourceBag;
  fetchResource: FetchResource;
  /** @import 循環防止 */
  seenImportUrls?: Set<string>;
  applyShadowCompat?: boolean;
};

/**
 * CSS の @import / url() を走査し、ローカル参照を token 化する。
 * 外部 URL は除去または空にして警告を出す。
 */
export async function rewriteCss(
  options: RewriteCssOptions,
): Promise<string> {
  const {
    css,
    cssUrl,
    pageUrl,
    bag,
    fetchResource,
    seenImportUrls = new Set<string>(),
    applyShadowCompat = true,
  } = options;

  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    bag.warn(`CSS の parse に失敗しました（${cssUrl}）: ${message}`);
    return applyShadowCompat ? applyShadowCompatCss(css) : css;
  }

  const importNodes: postcss.AtRule[] = [];
  root.walkAtRules('import', (atRule) => {
    importNodes.push(atRule);
  });

  for (const atRule of importNodes) {
    const parsedImport = parseImportParams(atRule.params);
    if (!parsedImport) {
      continue;
    }
    const classified = classifyUrl(parsedImport.url, cssUrl);
    if (isPassthroughUrl(classified.classification)) {
      continue;
    }
    if (!isCollectableUrl(classified.classification) || !classified.absoluteUrl) {
      bag.warn(
        `外部または非対応の @import を除去しました: ${parsedImport.url}`,
      );
      atRule.remove();
      continue;
    }

    if (seenImportUrls.has(classified.absoluteUrl)) {
      bag.warn(`循環 @import をスキップしました: ${classified.absoluteUrl}`);
      atRule.remove();
      continue;
    }
    seenImportUrls.add(classified.absoluteUrl);

    try {
      const fetched = await fetchResource(classified.absoluteUrl);
      const nestedCss = fetched.bytes.toString('utf8');
      const rewrittenNested = await rewriteCss({
        css: nestedCss,
        cssUrl: classified.absoluteUrl,
        pageUrl,
        bag,
        fetchResource,
        seenImportUrls,
        applyShadowCompat: false,
      });
      // nested 内容は別ファイルとして格納し、@import は token 参照に
      const nestedWithCompat = applyShadowCompatCss(rewrittenNested);
      const resourceId = bag.put(
        Buffer.from(nestedWithCompat, 'utf8'),
        'css',
        'stylesheet',
      );
      const media = parsedImport.media;
      atRule.params = media
        ? `"${toResourceToken(resourceId)}" ${media}`
        : `"${toResourceToken(resourceId)}"`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      bag.warn(
        `@import の取得に失敗しました（${parsedImport.url}）: ${message}`,
      );
      atRule.remove();
    }
  }

  const decls: postcss.Declaration[] = [];
  root.walkDecls((decl) => {
    if (/url\(/i.test(decl.value)) {
      decls.push(decl);
    }
  });

  for (const decl of decls) {
    const parsed = valueParser(decl.value);
    const urlFns: FunctionNode[] = [];
    parsed.walk((node) => {
      if (node.type === 'function' && node.value.toLowerCase() === 'url') {
        urlFns.push(node);
      }
    });

    for (const fn of urlFns) {
      const urlNode = fn.nodes.find(
        (n: ValueNode) => n.type === 'word' || n.type === 'string',
      );
      if (!urlNode || (urlNode.type !== 'word' && urlNode.type !== 'string')) {
        continue;
      }
      const rawUrl = urlNode.value;
      const classified = classifyUrl(rawUrl, cssUrl);
      if (isPassthroughUrl(classified.classification)) {
        continue;
      }
      if (
        !isCollectableUrl(classified.classification) ||
        !classified.absoluteUrl
      ) {
        bag.warn(`外部または非対応の url() を除去しました: ${rawUrl}`);
        fn.nodes = [];
        continue;
      }

      try {
        const fetched = await fetchResource(classified.absoluteUrl);
        let bytes = fetched.bytes;
        const ext = extensionFromUrlOrType(
          classified.absoluteUrl,
          fetched.contentType,
          guessExtFromDecl(decl.prop),
        );
        if (ext === 'svg') {
          bytes = stripSvgScripts(bytes);
        }
        const kind = kindForCssUrl(ext, decl.prop);
        const resourceId = bag.put(bytes, ext, kind);
        fn.nodes = [
          {
            type: 'string',
            value: toResourceToken(resourceId),
            quote: '"',
          } as ValueNode,
        ];
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        bag.warn(`url() の取得に失敗しました（${rawUrl}）: ${message}`);
        fn.nodes = [];
      }
    }

    decl.value = parsed.toString();
  }

  let result = root.toResult().css;
  if (applyShadowCompat) {
    result = applyShadowCompatCss(result);
  }
  return result;
}

function parseImportParams(
  params: string,
): { url: string; media: string } | null {
  const trimmed = params.trim();
  const stringMatch = trimmed.match(
    /^(?:url\(\s*)?['"]([^'"]+)['"](?:\s*\))?([\s\S]*)$/i,
  );
  if (stringMatch) {
    return {
      url: stringMatch[1],
      media: stringMatch[2].trim(),
    };
  }
  const urlMatch = trimmed.match(/^url\(\s*([^)]+?)\s*\)([\s\S]*)$/i);
  if (urlMatch) {
    return {
      url: urlMatch[1].replace(/^['"]|['"]$/g, ''),
      media: urlMatch[2].trim(),
    };
  }
  return null;
}

function guessExtFromDecl(prop: string): string {
  if (/^src$/i.test(prop)) {
    return 'woff2';
  }
  return 'bin';
}

function kindForCssUrl(ext: string, prop: string): ResourceKind {
  if (ext === 'css') {
    return 'stylesheet';
  }
  const base = kindFromExt(ext);
  if (base !== 'other') {
    return base;
  }
  if (/^src$/i.test(prop) || /font/i.test(prop)) {
    return 'font';
  }
  return 'other';
}
