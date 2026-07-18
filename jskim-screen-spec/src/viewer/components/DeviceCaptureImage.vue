<script setup lang="ts">
import PreviewImage from './PreviewImage.vue';

defineProps<{
  src: string;
  alt: string;
}>();
</script>

<template>
  <PreviewImage :src="src" :alt="alt" kind="device-capture" />
</template>
