<script setup lang="ts">
import { useRoute } from 'vue-router';
import type { ManifestScreen } from '../types';

defineProps<{
  screens: ManifestScreen[];
}>();

const route = useRoute();
</script>

<template>
  <aside class="spec-sidebar" aria-label="画面一覧">
    <h2 class="spec-sidebar__title">画面一覧</h2>
    <ul class="spec-sidebar__list">
      <li v-for="screen in screens" :key="screen.id">
        <RouterLink
          class="spec-sidebar__link"
          :class="{ 'is-active': route.params.screenId === screen.id }"
          :to="`/screens/${screen.id}`"
        >
          {{ screen.name }}
        </RouterLink>
      </li>
    </ul>
  </aside>
</template>
