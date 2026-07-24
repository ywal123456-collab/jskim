<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';

export type TreeNodeMoveDirection = 'up' | 'down' | 'indent' | 'outdent';

const props = defineProps<{
  canMoveUp: boolean;
  canMoveDown: boolean;
  canIndent: boolean;
  canOutdent: boolean;
}>();

const emit = defineEmits<{
  move: [direction: TreeNodeMoveDirection];
}>();

const rootRef = ref<HTMLElement | null>(null);
const upRef = ref<HTMLButtonElement | null>(null);
const downRef = ref<HTMLButtonElement | null>(null);
const indentRef = ref<HTMLButtonElement | null>(null);
const outdentRef = ref<HTMLButtonElement | null>(null);

const buttonMeta: Array<{
  direction: TreeNodeMoveDirection;
  label: string;
  title: string;
  testId: string;
  can: () => boolean;
  el: () => HTMLButtonElement | null;
}> = [
  {
    direction: 'up',
    label: '上へ',
    title: '上へ移動 (Alt+↑)',
    testId: 'tree-node-move-up',
    can: () => props.canMoveUp,
    el: () => upRef.value,
  },
  {
    direction: 'down',
    label: '下へ',
    title: '下へ移動 (Alt+↓)',
    testId: 'tree-node-move-down',
    can: () => props.canMoveDown,
    el: () => downRef.value,
  },
  {
    direction: 'indent',
    label: '下位へ',
    title: '下位階層へ移動 (Alt+→)',
    testId: 'tree-node-move-indent',
    can: () => props.canIndent,
    el: () => indentRef.value,
  },
  {
    direction: 'outdent',
    label: '上位へ',
    title: '上位階層へ移動 (Alt+←)',
    testId: 'tree-node-move-outdent',
    can: () => props.canOutdent,
    el: () => outdentRef.value,
  },
];

const ariaLabels: Record<TreeNodeMoveDirection, string> = {
  up: '上へ移動',
  down: '下へ移動',
  indent: '下位階層へ移動',
  outdent: '上位階層へ移動',
};

const buttonRefs = computed(() => ({
  up: upRef,
  down: downRef,
  indent: indentRef,
  outdent: outdentRef,
}));

function onClick(direction: TreeNodeMoveDirection): void {
  const meta = buttonMeta.find((entry) => entry.direction === direction);
  if (!meta || !meta.can()) {
    return;
  }
  emit('move', direction);
}

async function restoreFocus(direction: TreeNodeMoveDirection): Promise<void> {
  await nextTick();
  const preferred = buttonRefs.value[direction]?.value;
  if (preferred && !preferred.disabled) {
    preferred.focus();
    return;
  }
  for (const meta of buttonMeta) {
    const el = meta.el();
    if (el && !el.disabled) {
      el.focus();
      return;
    }
  }
  rootRef.value?.focus();
}

defineExpose({
  restoreFocus,
});
</script>

<template>
  <div
    ref="rootRef"
    class="tree-node-move-controls"
    role="group"
    aria-label="ノードの移動"
    data-testid="tree-node-move-controls"
    tabindex="-1"
  >
    <button
      ref="upRef"
      type="button"
      class="spec-page__btn spec-page__btn--secondary tree-node-move-controls__btn"
      data-testid="tree-node-move-up"
      :aria-label="ariaLabels.up"
      :title="buttonMeta[0]!.title"
      :disabled="!canMoveUp"
      @click="onClick('up')"
    >
      上へ
    </button>
    <button
      ref="downRef"
      type="button"
      class="spec-page__btn spec-page__btn--secondary tree-node-move-controls__btn"
      data-testid="tree-node-move-down"
      :aria-label="ariaLabels.down"
      :title="buttonMeta[1]!.title"
      :disabled="!canMoveDown"
      @click="onClick('down')"
    >
      下へ
    </button>
    <button
      ref="indentRef"
      type="button"
      class="spec-page__btn spec-page__btn--secondary tree-node-move-controls__btn"
      data-testid="tree-node-move-indent"
      :aria-label="ariaLabels.indent"
      :title="buttonMeta[2]!.title"
      :disabled="!canIndent"
      @click="onClick('indent')"
    >
      下位へ
    </button>
    <button
      ref="outdentRef"
      type="button"
      class="spec-page__btn spec-page__btn--secondary tree-node-move-controls__btn"
      data-testid="tree-node-move-outdent"
      :aria-label="ariaLabels.outdent"
      :title="buttonMeta[3]!.title"
      :disabled="!canOutdent"
      @click="onClick('outdent')"
    >
      上位へ
    </button>
  </div>
</template>

<style scoped>
.tree-node-move-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0 0 0.75rem;
  outline: none;
}

.tree-node-move-controls__btn {
  min-width: 4.5rem;
}
</style>
