<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { DocumentContext } from '../types';

export type PreviewStylesheet = {
  href?: string;
  cssText?: string;
  media?: string;
};

const props = defineProps<{
  html: string;
  itemOrder: string[];
  selectedItemId: string | null;
  /** 収集 CSS（href または cssText）。theme より前に注入 */
  stylesheets?: PreviewStylesheet[];
  /** viewer 上書き CSS（最後に注入） */
  previewCss: string;
  /** collect 時の html/body コンテキスト（Shadow 互換セレクタ用） */
  documentContext?: DocumentContext | null;
}>();

const emit = defineEmits<{
  select: [itemId: string];
}>();

const hostRef = ref<HTMLElement | null>(null);
let shadowRoot: ShadowRoot | null = null;
let renderGeneration = 0;
/** このコンポーネントが host に付けたクラス / 属性（掃除用） */
let appliedHostClasses: string[] = [];
let appliedHostAttrs: string[] = [];

function badgeNumber(itemId: string): number {
  const index = props.itemOrder.indexOf(itemId);
  return index >= 0 ? index + 1 : 0;
}

function clearHostDocumentContext(host: HTMLElement): void {
  for (const cls of appliedHostClasses) {
    host.classList.remove(cls);
  }
  appliedHostClasses = [];
  for (const name of appliedHostAttrs) {
    host.removeAttribute(name);
  }
  appliedHostAttrs = [];
}

function applyHostDocumentContext(
  host: HTMLElement,
  ctx: DocumentContext | null | undefined,
): void {
  clearHostDocumentContext(host);
  if (!ctx?.html) {
    return;
  }
  for (const cls of ctx.html.class || []) {
    if (!cls || host.classList.contains(cls)) {
      continue;
    }
    host.classList.add(cls);
    appliedHostClasses.push(cls);
  }
  for (const [name, value] of Object.entries(ctx.html.attributes || {})) {
    if (name === 'class' || name === 'style' || /^on/i.test(name)) {
      continue;
    }
    host.setAttribute(name, value);
    appliedHostAttrs.push(name);
  }
}

function applyBodyDocumentContext(
  wrapper: HTMLElement,
  ctx: DocumentContext | null | undefined,
): void {
  const bodyClasses = ['preview-root', ...(ctx?.body?.class || [])].filter(
    Boolean,
  );
  wrapper.className = [...new Set(bodyClasses)].join(' ');
  for (const [name, value] of Object.entries(ctx?.body?.attributes || {})) {
    if (name === 'class' || name === 'style' || /^on/i.test(name)) {
      continue;
    }
    wrapper.setAttribute(name, value);
  }
}

async function renderPreview(): Promise<void> {
  if (!hostRef.value) {
    return;
  }
  if (!shadowRoot) {
    shadowRoot = hostRef.value.attachShadow({ mode: 'open' });
  }

  const generation = ++renderGeneration;
  shadowRoot.innerHTML = '';
  applyHostDocumentContext(hostRef.value, props.documentContext);

  const chrome = document.createElement('style');
  chrome.setAttribute('data-jskim-spec-chrome', '');
  chrome.textContent = `
    :host { display: block; }
    .preview-root { position: relative; }
    .spec-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.25rem;
      height: 1.25rem;
      margin-right: 0.35rem;
      padding: 0 0.25rem;
      border-radius: 999px;
      background: #111827;
      color: #fff;
      font-size: 0.7rem;
      font-weight: 700;
      vertical-align: middle;
    }
    [data-jskim-spec-item].is-selected {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }
  `;
  shadowRoot.appendChild(chrome);

  const sheets = props.stylesheets || [];
  for (const sheet of sheets) {
    if (generation !== renderGeneration) {
      return;
    }
    if (sheet.href) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      if (sheet.media) {
        link.media = sheet.media;
      }
      shadowRoot.appendChild(link);
      await new Promise<void>((resolve) => {
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener('error', () => resolve(), { once: true });
      });
    } else if (sheet.cssText != null) {
      const style = document.createElement('style');
      if (sheet.media) {
        style.media = sheet.media;
      }
      style.textContent = sheet.cssText;
      shadowRoot.appendChild(style);
    }
  }

  if (generation !== renderGeneration) {
    return;
  }

  const theme = document.createElement('style');
  theme.setAttribute('data-jskim-spec-theme', '');
  theme.textContent = props.previewCss || '';
  shadowRoot.appendChild(theme);

  const wrapper = document.createElement('div');
  applyBodyDocumentContext(wrapper, props.documentContext);
  wrapper.setAttribute('data-jskim-spec-preview-body', '');
  wrapper.innerHTML = props.html;

  wrapper.querySelectorAll('[data-jskim-spec-item]').forEach((el) => {
    const itemId = el.getAttribute('data-jskim-spec-item');
    if (!itemId) {
      return;
    }
    const num = badgeNumber(itemId);
    if (num > 0) {
      const badge = document.createElement('span');
      badge.className = 'spec-badge';
      badge.textContent = String(num);
      badge.setAttribute('aria-hidden', 'true');
      el.insertBefore(badge, el.firstChild);
    }
    if (itemId === props.selectedItemId) {
      el.classList.add('is-selected');
    }
  });

  wrapper.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.target as HTMLElement | null;
    const itemEl = target?.closest?.('[data-jskim-spec-item]') as HTMLElement | null;
    if (itemEl) {
      const itemId = itemEl.getAttribute('data-jskim-spec-item');
      // 設計対象（itemOrder）にある項目だけ選択する。除外済み DOM は Badge も選択も無い
      if (itemId && badgeNumber(itemId) > 0) {
        emit('select', itemId);
      }
    }
  });

  wrapper.addEventListener('submit', (event) => {
    event.preventDefault();
  });

  shadowRoot.appendChild(wrapper);
}

onMounted(() => {
  void renderPreview();
});

watch(
  () => [
    props.html,
    props.itemOrder,
    props.selectedItemId,
    props.previewCss,
    props.stylesheets,
    props.documentContext,
  ],
  () => {
    void renderPreview();
  },
  { deep: true },
);

onBeforeUnmount(() => {
  renderGeneration += 1;
  if (hostRef.value) {
    clearHostDocumentContext(hostRef.value);
  }
  shadowRoot = null;
});
</script>

<template>
  <div ref="hostRef" class="dom-preview" aria-label="画面プレビュー"></div>
</template>
