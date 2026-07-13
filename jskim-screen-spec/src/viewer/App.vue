<script setup lang="ts">
import { computed, provide } from 'vue';
import { RouterView } from 'vue-router';
import SpecHeader from './components/SpecHeader.vue';
import SpecSidebar from './components/SpecSidebar.vue';
import type { ViewerManifest } from './types';

const props = defineProps<{
  manifest: ViewerManifest;
}>();

provide('manifest', computed(() => props.manifest));
</script>

<template>
  <div class="spec-app">
    <SpecHeader :project-name="manifest.projectName" />
    <div class="spec-shell">
      <SpecSidebar :screens="manifest.screens" />
      <main class="spec-main">
        <RouterView />
      </main>
    </div>
  </div>
</template>
