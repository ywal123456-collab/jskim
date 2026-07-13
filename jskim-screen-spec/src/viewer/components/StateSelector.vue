<script setup lang="ts">
import type { ScreenState } from '../types';

defineProps<{
  states: ScreenState[];
  selectedStateId: string;
}>();

const emit = defineEmits<{
  select: [stateId: string];
}>();
</script>

<template>
  <div class="state-selector" role="group" aria-label="状態一覧">
    <button
      v-for="state in states.filter((s) => s.viewer.visible)"
      :key="state.id"
      type="button"
      class="state-selector__button"
      :class="{ 'is-active': state.id === selectedStateId }"
      @click="emit('select', state.id)"
    >
      {{ state.name }}
    </button>
  </div>
</template>
