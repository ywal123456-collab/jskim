<script setup lang="ts">
import { computed } from 'vue';
import type { ScreenState } from '../types';

const props = defineProps<{
  states: ScreenState[];
  selectedStateId: string;
  disabled?: boolean;
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

function onSelect(stateId: string): void {
  if (props.disabled) {
    return;
  }
  emit('select', stateId);
}
</script>

<template>
  <div class="state-selector" role="group" aria-label="状態一覧">
    <button
      v-for="state in visibleOrderedStates"
      :key="state.id"
      type="button"
      class="state-selector__button"
      :class="{ 'is-active': state.id === selectedStateId }"
      :disabled="disabled"
      :aria-disabled="disabled ? 'true' : undefined"
      @click="onSelect(state.id)"
    >
      {{ state.name }}
    </button>
  </div>
</template>
