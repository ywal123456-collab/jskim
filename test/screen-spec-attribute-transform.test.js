'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  stripScreenSpecAttributes,
  transformScreenSpecAttributes,
} = require('../scripts/lib/strip-screen-spec-attributes');

describe('Screen Spec attribute transform', () => {
  it('基本: screen attribute を除去する', () => {
    const input = '<main data-jskim-spec-screen="crud-create">';
    assert.equal(stripScreenSpecAttributes(input), '<main>');
  });

  it('他の attribute と並んでも spec item だけ除去する', () => {
    const input = `<div
  class="field"
  data-jskim-spec-item="product-name"
  aria-label="商品名"
>`;
    const out = stripScreenSpecAttributes(input);
    assert.match(out, /class="field"/);
    assert.match(out, /aria-label="商品名"/);
    assert.equal(out.includes('data-jskim-spec-item'), false);
    assert.match(out, /^<div\n/);
  });

  it('同一 element の item と action を両方除去する', () => {
    const input = `<button
  data-jskim-spec-item="submit-create"
  data-jskim-spec-action="submit-create"
  type="submit"
>`;
    const out = stripScreenSpecAttributes(input);
    assert.equal(out.includes('data-jskim-spec-item'), false);
    assert.equal(out.includes('data-jskim-spec-action'), false);
    assert.match(out, /type="submit"/);
  });

  it('single quote の attribute も除去する', () => {
    const input = "<div data-jskim-spec-item='product-name'>";
    assert.equal(stripScreenSpecAttributes(input), '<div>');
  });

  it('attribute 値内の > を誤って閉じない', () => {
    const input = `<div
  title="A > B"
  data-jskim-spec-item="comparison"
>`;
    const out = stripScreenSpecAttributes(input);
    assert.match(out, /title="A > B"/);
    assert.equal(out.includes('data-jskim-spec-item'), false);
  });

  it('HTML コメント内は変更しない', () => {
    const input = '<!-- <div data-jskim-spec-item="example"> -->';
    assert.equal(stripScreenSpecAttributes(input), input);
  });

  it('script 内の文字列は変更しない', () => {
    const input = `<script>
  const sample = '<div data-jskim-spec-item="example">';
</script>`;
    assert.equal(stripScreenSpecAttributes(input), input);
  });

  it('style 内の文字列は変更しない', () => {
    const input = `<style>
  /* data-jskim-spec-item="example" */
  .x::before { content: '<div data-jskim-spec-item="example">'; }
</style>`;
    assert.equal(stripScreenSpecAttributes(input), input);
  });

  it('類似 attribute は除去しない', () => {
    const input =
      '<div data-jskim-spec-custom="a" data-jskim-screen="b" data-spec-item="c">';
    assert.equal(stripScreenSpecAttributes(input), input);
  });

  it('idempotent である', () => {
    const input = `<main data-jskim-spec-screen="crud-create">
  <a data-jskim-spec-item="submit-create" data-jskim-spec-action="submit-create" href="x">x</a>
</main>`;
    const once = stripScreenSpecAttributes(input);
    assert.equal(stripScreenSpecAttributes(once), once);
  });

  it('preserve mode では原文を返す', () => {
    const input = '<main data-jskim-spec-screen="crud-create">';
    assert.equal(
      transformScreenSpecAttributes(input, { preserve: true }),
      input
    );
  });

  it('対象 attribute が無ければ原文を返す', () => {
    const input = '<div class="panel" id="main">';
    assert.equal(stripScreenSpecAttributes(input), input);
  });

  it('非 string 入力は TypeError', () => {
    assert.throws(() => stripScreenSpecAttributes(null), TypeError);
    assert.throws(
      () => transformScreenSpecAttributes(42, { preserve: true }),
      TypeError
    );
  });
});
