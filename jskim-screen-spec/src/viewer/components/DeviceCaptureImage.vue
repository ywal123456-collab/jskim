<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  src: string;
  alt: string;
}>();

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
</script>

<template>
  <div class="device-capture-image" data-testid="device-capture-image">
    <p v-if="loadError" class="device-capture-image__error" role="alert">
      Device Preview画像を読み込めませんでした。
    </p>
    <img
      v-show="!loadError"
      class="device-capture-image__img"
      :src="src"
      :alt="alt"
      @load="onLoad"
      @error="onError"
    />
  </div>
</template>
