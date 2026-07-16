<script setup lang="ts">
import { computed, provide, ref } from 'vue';
import { RouterView } from 'vue-router';
import SpecHeader from './components/SpecHeader.vue';
import SpecSidebar from './components/SpecSidebar.vue';
import CreateScreenDialog from './components/CreateScreenDialog.vue';
import { getSpecEditBootstrap } from './editing/types';
import type { ViewerManifest } from './types';

const props = defineProps<{
  manifest: ViewerManifest;
}>();

provide('manifest', computed(() => props.manifest));

const editingEnabled = Boolean(getSpecEditBootstrap());
const createDialogOpen = ref(false);

function openCreateScreen(): void {
  if (!editingEnabled) {
    return;
  }
  createDialogOpen.value = true;
}

function closeCreateScreen(): void {
  createDialogOpen.value = false;
}

provide('editingEnabled', editingEnabled);
provide('openCreateScreen', openCreateScreen);
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
    <CreateScreenDialog v-if="createDialogOpen" @close="closeCreateScreen" />
  </div>
</template>
