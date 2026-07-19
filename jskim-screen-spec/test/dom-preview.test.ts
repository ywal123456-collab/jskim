import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import DomPreview from '../src/viewer/components/DomPreview.vue';
import {
  setWrapperProps,
  withRecordSetProps,
} from './helpers/set-wrapper-props';

const FIXTURE_HTML = `
  <div id="root-old">
    <button type="button" data-jskim-spec-item="a">項目A</button>
    <span data-jskim-spec-item="b">項目B</span>
    <form id="preview-form" action="/submit">
      <input type="text" name="q" value="x" />
      <button type="submit">送信</button>
    </form>
    <a id="preview-link" href="/somewhere">リンク</a>
    <button type="button" onclick="alert(1)">危険</button>
    <script>evil()</script>
  </div>
`.trim();

describe('DomPreview', () => {
  it('shadowRoot を作成しマーカーと badge を挿入する', async () => {
    const wrapper = mount(DomPreview, {
      props: {
        html: FIXTURE_HTML,
        itemOrder: ['a', 'b'],
        selectedItemId: null,
        previewCss: '',
      },
      attachTo: document.body,
    });
    await nextTick();

    const host = wrapper.element as HTMLElement;
    expect(host.shadowRoot).toBeTruthy();

    const shadow = host.shadowRoot!;
    const itemA = shadow.querySelector('[data-jskim-spec-item="a"]');
    const itemB = shadow.querySelector('[data-jskim-spec-item="b"]');
    expect(itemA).toBeTruthy();
    expect(itemB).toBeTruthy();

    const badges = shadow.querySelectorAll('.spec-badge');
    expect(badges).toHaveLength(2);
    expect(badges[0].textContent).toBe('1');
    expect(badges[1].textContent).toBe('2');

    // HTML 内の script / on* はそのまま残りうる（クリックは抑止）
    expect(shadow.innerHTML).toMatch(/script/i);
    expect(shadow.innerHTML).toMatch(/onclick/i);

    wrapper.unmount();
  });

  it('マーカークリックで select を emit する', async () => {
    const wrapper = mount(DomPreview, {
      props: {
        html: FIXTURE_HTML,
        itemOrder: ['a', 'b'],
        selectedItemId: null,
        previewCss: '',
      },
      attachTo: document.body,
    });
    await nextTick();

    const shadow = (wrapper.element as HTMLElement).shadowRoot!;
    const itemB = shadow.querySelector(
      '[data-jskim-spec-item="b"]',
    ) as HTMLElement;
    itemB.click();
    await nextTick();

    expect(wrapper.emitted('select')).toBeTruthy();
    expect(wrapper.emitted('select')![0]).toEqual(['b']);

    wrapper.unmount();
  });

  it('itemOrder に無い（除外済み）項目は Badge を出さずクリックでも select しない', async () => {
    const wrapper = mount(DomPreview, {
      props: {
        html: FIXTURE_HTML,
        itemOrder: ['a'],
        selectedItemId: null,
        previewCss: '',
      },
      attachTo: document.body,
    });
    await nextTick();

    const shadow = (wrapper.element as HTMLElement).shadowRoot!;
    const badges = shadow.querySelectorAll('.spec-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('1');

    const itemB = shadow.querySelector(
      '[data-jskim-spec-item="b"]',
    ) as HTMLElement;
    expect(itemB.querySelector('.spec-badge')).toBeNull();
    itemB.click();
    await nextTick();
    expect(wrapper.emitted('select')).toBeFalsy();

    const itemA = shadow.querySelector(
      '[data-jskim-spec-item="a"]',
    ) as HTMLElement;
    itemA.click();
    await nextTick();
    expect(wrapper.emitted('select')![0]).toEqual(['a']);

    wrapper.unmount();
  });

  it('selectedItemId に is-selected を付ける', async () => {
    const wrapper = mount(DomPreview, {
      props: {
        html: FIXTURE_HTML,
        itemOrder: ['a', 'b'],
        selectedItemId: 'a',
        previewCss: '',
      },
      attachTo: document.body,
    });
    await nextTick();

    const shadow = (wrapper.element as HTMLElement).shadowRoot!;
    const itemA = shadow.querySelector('[data-jskim-spec-item="a"]');
    const itemB = shadow.querySelector('[data-jskim-spec-item="b"]');
    expect(itemA?.classList.contains('is-selected')).toBe(true);
    expect(itemB?.classList.contains('is-selected')).toBe(false);

    wrapper.unmount();
  });

  it('html 変更で内容を差し替え旧ノードを消す', async () => {
    const wrapper = mount(DomPreview, {
      props: {
        html: FIXTURE_HTML,
        itemOrder: ['a', 'b'],
        selectedItemId: null,
        previewCss: '',
      },
      attachTo: document.body,
    });
    await nextTick();

    await setWrapperProps(withRecordSetProps(wrapper), {
      html: '<div id="root-new"><p data-jskim-spec-item="a">新</p></div>',
      itemOrder: ['a'],
    });
    await nextTick();

    const shadow = (wrapper.element as HTMLElement).shadowRoot!;
    expect(shadow.querySelector('#root-old')).toBeNull();
    expect(shadow.querySelector('#root-new')).toBeTruthy();
    expect(shadow.querySelector('[data-jskim-spec-item="b"]')).toBeNull();

    wrapper.unmount();
  });

  it('form submit の default を防ぐ', async () => {
    const wrapper = mount(DomPreview, {
      props: {
        html: FIXTURE_HTML,
        itemOrder: ['a', 'b'],
        selectedItemId: null,
        previewCss: '',
      },
      attachTo: document.body,
    });
    await nextTick();

    const shadow = (wrapper.element as HTMLElement).shadowRoot!;
    const form = shadow.querySelector('#preview-form') as HTMLFormElement;
    const event = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    wrapper.unmount();
  });

  it('anchor クリックの default を防ぐ', async () => {
    const wrapper = mount(DomPreview, {
      props: {
        html: FIXTURE_HTML,
        itemOrder: ['a', 'b'],
        selectedItemId: null,
        previewCss: '',
      },
      attachTo: document.body,
    });
    await nextTick();

    const shadow = (wrapper.element as HTMLElement).shadowRoot!;
    const link = shadow.querySelector('#preview-link') as HTMLAnchorElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    wrapper.unmount();
  });

  it('documentContext で wrapper に preview-root app-body を付ける', async () => {
    const wrapper = mount(DomPreview, {
      props: {
        html: FIXTURE_HTML,
        itemOrder: ['a', 'b'],
        selectedItemId: null,
        previewCss: '',
        documentContext: {
          html: {
            class: ['html-theme'],
            attributes: { lang: 'ja', 'data-theme': 'dark' },
          },
          body: {
            class: ['app-body'],
            attributes: { 'data-layout': 'wide' },
          },
        },
      },
      attachTo: document.body,
    });
    await nextTick();

    const host = wrapper.element as HTMLElement;
    expect(host.classList.contains('dom-preview')).toBe(true);
    expect(host.classList.contains('html-theme')).toBe(true);
    expect(host.getAttribute('lang')).toBe('ja');
    expect(host.getAttribute('data-theme')).toBe('dark');

    const shadow = host.shadowRoot!;
    const previewBody = shadow.querySelector(
      '[data-jskim-spec-preview-body]',
    ) as HTMLElement;
    expect(previewBody.className.split(/\s+/).sort()).toEqual(
      ['app-body', 'preview-root'].sort(),
    );
    expect(previewBody.getAttribute('data-layout')).toBe('wide');

    wrapper.unmount();
    expect(host.classList.contains('html-theme')).toBe(false);
    expect(host.getAttribute('lang')).toBeNull();
  });
});
