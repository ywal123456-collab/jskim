<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { PreviewProvider } from '../preview/preview-provider';

const props = defineProps<{
  modelValue: PreviewProvider;
  idPrefix?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [PreviewProvider];
}>();

const tabs: Array<{ id: PreviewProvider; label: string }> = [
  { id: 'live', label: 'Live' },
  { id: 'pc', label: 'PC' },
  { id: 'sp', label: 'SP' },
];

const prefix = computed(() => props.idPrefix || 'preview-provider');
const tablistRef = ref<HTMLElement | null>(null);

function tabId(provider: PreviewProvider): string {
  return `${prefix.value}-tab-${provider}`;
}

function panelId(provider: PreviewProvider): string {
  return `${prefix.value}-panel-${provider}`;
}

function select(provider: PreviewProvider): void {
  if (provider === props.modelValue) {
    return;
  }
  emit('update:modelValue', provider);
}

function focusTab(provider: PreviewProvider): void {
  void nextTick(() => {
    const el = document.getElementById(tabId(provider));
    el?.focus();
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
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    select(props.modelValue);
    return;
  } else {
    return;
  }
  event.preventDefault();
  const provider = tabs[next].id;
  select(provider);
  focusTab(provider);
}
</script>

<template>
  <div
    ref="tablistRef"
    class="preview-provider-tabs"
    role="tablist"
    aria-label="Preview 表示"
    @keydown="onKeydown"
  >
    <button
      v-for="tab in tabs"
      :id="tabId(tab.id)"
      :key="tab.id"
      type="button"
      role="tab"
      class="preview-provider-tabs__tab"
      :class="{ 'is-active': modelValue === tab.id }"
      :aria-selected="modelValue === tab.id ? 'true' : 'false'"
      :aria-controls="panelId(tab.id)"
      :tabindex="modelValue === tab.id ? 0 : -1"
      :data-provider="tab.id"
      @click="select(tab.id)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>
