<script setup lang="ts">
import { nextTick, ref } from 'vue';
import type { ReferenceViewport } from '../preview/preview-provider';

const props = defineProps<{
  modelValue: ReferenceViewport;
  idPrefix?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [ReferenceViewport];
}>();

const tabs: Array<{ id: ReferenceViewport; label: string }> = [
  { id: 'pc', label: 'PC' },
  { id: 'sp', label: 'SP' },
];

const prefix = props.idPrefix || 'reference-viewport';
const tablistRef = ref<HTMLElement | null>(null);

function tabId(viewport: ReferenceViewport): string {
  return `${prefix}-tab-${viewport}`;
}

function select(viewport: ReferenceViewport): void {
  if (viewport === props.modelValue) {
    return;
  }
  emit('update:modelValue', viewport);
}

function focusTab(viewport: ReferenceViewport): void {
  void nextTick(() => {
    document.getElementById(tabId(viewport))?.focus();
  });
}

function onKeydown(event: KeyboardEvent): void {
  const index = tabs.findIndex((t) => t.id === props.modelValue);
  if (index < 0) {
    return;
  }
  let next = index;
  if (event.key === 'ArrowRight') {
    next = (index + 1) % tabs.length;
  } else if (event.key === 'ArrowLeft') {
    next = (index - 1 + tabs.length) % tabs.length;
  } else if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = tabs.length - 1;
  } else {
    return;
  }
  event.preventDefault();
  const viewport = tabs[next].id;
  select(viewport);
  focusTab(viewport);
}
</script>

<template>
  <div
    ref="tablistRef"
    class="reference-viewport-tabs"
    role="tablist"
    aria-label="参照画像の対象"
    data-testid="reference-viewport-tabs"
    @keydown="onKeydown"
  >
    <span class="reference-viewport-tabs__label" :id="`${prefix}-label`">参照画像:</span>
    <button
      v-for="tab in tabs"
      :id="tabId(tab.id)"
      :key="tab.id"
      type="button"
      role="tab"
      class="reference-viewport-tabs__tab"
      :class="{ 'is-active': modelValue === tab.id }"
      :aria-selected="modelValue === tab.id ? 'true' : 'false'"
      :aria-controls="`${prefix}-panel`"
      :tabindex="modelValue === tab.id ? 0 : -1"
      :data-viewport="tab.id"
      @click="select(tab.id)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>
