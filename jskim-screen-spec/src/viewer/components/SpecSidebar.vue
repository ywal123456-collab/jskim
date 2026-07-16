<script setup lang="ts">
import { inject } from 'vue';
import { useRoute } from 'vue-router';
import { SCREEN_SPEC_STATUS_LABEL, type ManifestScreen } from '../types';

defineProps<{
  screens: ManifestScreen[];
}>();

const route = useRoute();
const editingEnabled = inject<boolean>('editingEnabled', false);
const openCreateScreen = inject<() => void>('openCreateScreen', () => {});

function statusLabel(screen: ManifestScreen): string {
  return SCREEN_SPEC_STATUS_LABEL[screen.status] ?? '';
}
</script>

<template>
  <aside class="spec-sidebar" aria-label="画面一覧">
    <div class="spec-sidebar__head">
      <h2 class="spec-sidebar__title">画面一覧</h2>
      <button
        v-if="editingEnabled"
        type="button"
        class="spec-sidebar__create-btn"
        @click="openCreateScreen()"
      >
        ＋ 画面を作成
      </button>
    </div>
    <ul class="spec-sidebar__list">
      <li v-for="screen in screens" :key="screen.id">
        <RouterLink
          class="spec-sidebar__link"
          :class="{ 'is-active': route.params.screenId === screen.id }"
          :to="`/screens/${screen.id}`"
        >
          <span class="spec-sidebar__link-name">{{ screen.name }}</span>
          <span
            class="spec-sidebar__badge"
            :data-status="screen.status"
            >{{ statusLabel(screen) }}</span
          >
        </RouterLink>
      </li>
    </ul>
  </aside>
</template>
