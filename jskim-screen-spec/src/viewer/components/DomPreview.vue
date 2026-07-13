<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  html: string;
  itemOrder: string[];
  selectedItemId: string | null;
  previewCss: string;
}>();

const emit = defineEmits<{
  select: [itemId: string];
}>();

const hostRef = ref<HTMLElement | null>(null);
let shadowRoot: ShadowRoot | null = null;

function badgeNumber(itemId: string): number {
  const index = props.itemOrder.indexOf(itemId);
  return index >= 0 ? index + 1 : 0;
}

function renderPreview(): void {
  if (!hostRef.value) {
    return;
  }
  if (!shadowRoot) {
    shadowRoot = hostRef.value.attachShadow({ mode: 'open' });
  }

  shadowRoot.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = `
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
    ${props.previewCss}
  `;
  shadowRoot.appendChild(style);

  const wrapper = document.createElement('div');
  wrapper.className = 'preview-root';
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
      if (itemId) {
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
  renderPreview();
});

watch(
  () => [props.html, props.itemOrder, props.selectedItemId, props.previewCss],
  () => {
    renderPreview();
  },
);

onBeforeUnmount(() => {
  shadowRoot = null;
});
</script>

<template>
  <div ref="hostRef" class="dom-preview" aria-label="画面プレビュー"></div>
</template>
