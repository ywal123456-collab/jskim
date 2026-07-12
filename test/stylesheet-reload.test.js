'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  CSS_CACHE_PARAM,
  isSameOriginStylesheetHref,
  appendCacheBustParam,
} = require('../scripts/lib/stylesheet-reload');
const {
  buildClientScript,
  OVERLAY_HOST_ID,
  normalizeErrorMessage,
} = require('../scripts/lib/create-live-reload');

describe('stylesheet-reload helpers', () => {
  const origin = 'http://127.0.0.1:3000';

  it('same-origin のみ許可し data/external を除外する', () => {
    assert.equal(isSameOriginStylesheetHref('/assets/a.css', origin), true);
    assert.equal(
      isSameOriginStylesheetHref('http://127.0.0.1:3000/a.css', origin),
      true
    );
    assert.equal(
      isSameOriginStylesheetHref('https://cdn.example/a.css', origin),
      false
    );
    assert.equal(
      isSameOriginStylesheetHref('data:text/css,body{}', origin),
      false
    );
    assert.equal(isSameOriginStylesheetHref('', origin), false);
  });

  it('query と hash を維持し _jskim を付与/置換する', () => {
    assert.equal(CSS_CACHE_PARAM, '_jskim');
    assert.equal(
      appendCacheBustParam('/css/style.css?v=1#theme', origin, '9'),
      '/css/style.css?v=1&_jskim=9#theme'
    );
    assert.equal(
      appendCacheBustParam('/css/style.css?_jskim=old&v=1#x', origin, '10'),
      '/css/style.css?_jskim=10&v=1#x'
    );
    assert.equal(
      appendCacheBustParam('https://cdn.example/a.css', origin, '1'),
      null
    );
  });
});

describe('live-reload client runtime source', () => {
  it('overlay は textContent と Shadow DOM を使い innerHTML で message を入れない', () => {
    const script = buildClientScript({
      liveReloadPath: '/_jskim/live-reload',
      overlayHostId: OVERLAY_HOST_ID,
      cssLoadTimeoutMs: 8000,
    });

    assert.match(script, /attachShadow/);
    assert.match(script, new RegExp(OVERLAY_HOST_ID));
    assert.match(script, /textContent = String\(message/);
    assert.equal(script.includes('innerHTML'), false);
    assert.match(script, /cloneNode\(true\)/);
    assert.match(script, /scheduleFullReload/);
    assert.match(script, /clear-error/);
    assert.match(script, /addEventListener\("css"/);
    assert.match(script, /hideErrorOverlay/);
    assert.match(script, /fallbackReloadScheduled/);
    assert.match(script, /querySelectorAll\('link\[rel~="stylesheet"\]'\)/);
    assert.match(script, /insertBefore\(clone/);
    assert.match(script, /removeChild\(oldLink\)/);
  });

  it('injected runtime は stylesheet-reload の関数本体を共有する', () => {
    const script = buildClientScript({
      liveReloadPath: '/_jskim/live-reload',
      overlayHostId: OVERLAY_HOST_ID,
      cssLoadTimeoutMs: 8000,
    });

    assert.ok(
      script.includes(isSameOriginStylesheetHref.toString()),
      'isSameOriginStylesheetHref 本体が inject される'
    );
    assert.ok(
      script.includes(appendCacheBustParam.toString()),
      'appendCacheBustParam 本体が inject される'
    );
  });

  it('normalizeErrorMessage は stack を送らず message を使う', () => {
    const err = new Error('line1\nline2');
    err.stack = 'Error: line1\n    at foo';
    assert.equal(normalizeErrorMessage(err), 'line1\nline2');
    assert.equal(normalizeErrorMessage('plain'), 'plain');
    assert.equal(normalizeErrorMessage(null), 'null');
  });
});
