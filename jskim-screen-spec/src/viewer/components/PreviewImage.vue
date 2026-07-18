<script setup lang="ts">
import { ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    src: string;
    alt: string;
    /** data-testid と error 文言の用途 */
    kind?: 'device-capture' | 'reference';
  }>(),
  {
    kind: 'device-capture',
  },
);

const loadError = ref(false);
const loaded = ref(false);

watch(
  () => props.src,
  () => {
    loadError.value = false;
    loaded.value = false;
  },
);

function onLoad(): void {
  loaded.value = true;
  loadError.value = false;
}

function onError(): void {
  loadError.value = true;
  loaded.value = false;
}

const errorText =
  props.kind === 'reference'
    ? '参照画像を読み込めませんでした。'
    : 'Device Preview画像を読み込めませんでした。';

const rootClass =
  props.kind === 'reference' ? 'preview-image preview-image--reference' : 'preview-image';

const testId =
  props.kind === 'reference' ? 'reference-image' : 'device-capture-image';
</script>

<template>
  <div :class="rootClass" :data-testid="testId">
    <p v-if="loadError" class="preview-image__error" role="alert">
      {{ errorText }}
    </p>
    <img
      v-show="!loadError"
      class="preview-image__img"
      :src="src"
      :alt="alt"
      @load="onLoad"
      @error="onError"
    />
  </div>
</template>
