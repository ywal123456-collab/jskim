<script setup lang="ts">
import { computed } from 'vue';
import type { ScreenState } from '../types';

const props = defineProps<{
  states: ScreenState[];
  selectedStateId: string;
}>();

const emit = defineEmits<{
  select: [stateId: string];
}>();

/** visible かつ order 昇順 */
const visibleOrderedStates = computed(() =>
  props.states
    .filter((state) => state.viewer.visible)
    .slice()
    .sort((a, b) => (a.viewer.order ?? 0) - (b.viewer.order ?? 0)),
);
</script>

<template>
  <div class="state-selector" role="group" aria-label="状態一覧">
    <button
      v-for="state in visibleOrderedStates"
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
