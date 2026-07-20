<script setup lang="ts">
import { computed, provide, ref } from 'vue';
import { RouterView } from 'vue-router';
import SpecHeader from './components/SpecHeader.vue';
import SpecSidebar from './components/SpecSidebar.vue';
import CreateScreenDialog from './components/CreateScreenDialog.vue';
import FeatureManagementDialog from './components/FeatureManagementDialog.vue';
import { getSpecEditBootstrap } from './editing/types';
import { useFeatureManagement } from './features/use-feature-management';
import type { ViewerManifest } from './types';

const props = defineProps<{
  manifest: ViewerManifest;
}>();

provide('manifest', computed(() => props.manifest));

const editingEnabled = Boolean(getSpecEditBootstrap());
const createDialogOpen = ref(false);
const featureManagement = useFeatureManagement();

function openCreateScreen(): void {
  if (!editingEnabled) {
    return;
  }
  createDialogOpen.value = true;
}

function closeCreateScreen(): void {
  createDialogOpen.value = false;
}

async function openFeatureManagement(): Promise<void> {
  await featureManagement.openDialog();
}

function closeFeatureManagement(): void {
  featureManagement.closeDialog();
}

provide('editingEnabled', editingEnabled);
provide('openCreateScreen', openCreateScreen);
provide('openFeatureManagement', openFeatureManagement);
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
    <FeatureManagementDialog
      v-if="featureManagement.open.value"
      :management="featureManagement"
      :screens="manifest.screens"
      @close="closeFeatureManagement"
    />
  </div>
</template>
