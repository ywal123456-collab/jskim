'use strict';

const CSS_CACHE_PARAM = '_jskim';

/**
 * same-origin の stylesheet URL かどうかを判定します。
 * browser runtime へ Function#toString で埋め込むため、外部クロージャに依存しません。
 *
 * @param {string} href
 * @param {string} pageOrigin location.origin または location.href
 * @returns {boolean}
 */
function isSameOriginStylesheetHref(href, pageOrigin) {
  if (!href || typeof href !== 'string') {
    return false;
  }
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('data:')) {
    return false;
  }

  try {
    const resolved = new URL(trimmed, pageOrigin);
    const origin = new URL(pageOrigin);
    return resolved.origin === origin.origin;
  } catch {
    return false;
  }
}

/**
 * cache-busting query を付与または更新します。hash と他 query は維持します。
 * browser runtime へ Function#toString で埋め込むため、パラメータ名はリテラルです。
 *
 * @param {string} href
 * @param {string} pageOrigin
 * @param {string|number} token
 * @returns {string|null}
 */
function appendCacheBustParam(href, pageOrigin, token) {
  if (!isSameOriginStylesheetHref(href, pageOrigin)) {
    return null;
  }

  try {
    const url = new URL(href, pageOrigin);
    url.searchParams.set('_jskim', String(token));
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

module.exports = {
  CSS_CACHE_PARAM,
  isSameOriginStylesheetHref,
  appendCacheBustParam,
};
