<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps<{
  groupId: string;
  groupName: string;
  descendantGroupCount: number;
  itemCount: number;
  containsCollectedItem?: boolean;
  pending?: boolean;
  submitDisabled?: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

const titleId = 'group-delete-subtree-dialog-title';
const descId = 'group-delete-subtree-dialog-desc';
const cancelBtnRef = ref<HTMLButtonElement | null>(null);

const displayName = computed(
  () => props.groupName.trim() || props.groupId,
);

const confirmBlocked = computed(
  () =>
    Boolean(props.pending) ||
    Boolean(props.submitDisabled) ||
    Boolean(props.containsCollectedItem),
);

function requestClose(): void {
  if (props.pending) {
    return;
  }
  emit('close');
}

function onOverlayClick(): void {
  requestClose();
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (props.pending) {
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    requestClose();
  }
}

function onConfirm(): void {
  if (confirmBlocked.value) {
    return;
  }
  emit('confirm');
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown);
  void nextTick(() => {
    cancelBtnRef.value?.focus();
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown);
});
</script>

<template>
  <div class="create-screen-dialog-overlay" @click.self="onOverlayClick">
    <div
      class="create-screen-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="descId"
      data-testid="group-delete-subtree-dialog"
    >
      <h2 :id="titleId" class="create-screen-dialog__title">
        グループを削除しますか？
      </h2>

      <div class="create-screen-dialog__form">
        <p class="spec-field__hint">
          グループ名: {{ displayName }}
        </p>
        <p class="spec-field__hint">
          グループ ID: <code>{{ groupId }}</code>
        </p>
        <p
          class="spec-field__hint"
          data-testid="group-delete-subtree-descendant-count"
        >
          削除される下位グループ: {{ descendantGroupCount }}
        </p>
        <p
          class="spec-field__hint"
          data-testid="group-delete-subtree-item-count"
        >
          削除される項目: {{ itemCount }}
        </p>

        <p
          :id="descId"
          class="group-delete-subtree-dialog__message"
          data-testid="group-delete-subtree-warning"
        >
          グループ「{{ displayName }}」と配下のグループ・項目を完全に削除します。この操作は元に戻せません。
        </p>

        <p
          v-if="containsCollectedItem"
          class="spec-field__error"
          data-testid="group-delete-subtree-collected-block"
          role="alert"
        >
          配下に実装画面と連携された項目があるため、このグループを削除できません。
        </p>

        <p
          v-if="errorMessage"
          class="spec-field__error"
          data-testid="group-delete-subtree-error"
          role="alert"
        >
          {{ errorMessage }}
        </p>

        <div class="create-screen-dialog__actions">
          <button
            ref="cancelBtnRef"
            type="button"
            class="spec-page__btn spec-page__btn--secondary"
            :disabled="pending"
            data-testid="group-delete-subtree-cancel"
            @click="requestClose"
          >
            キャンセル
          </button>
          <button
            type="button"
            class="spec-page__btn spec-page__btn--danger"
            data-testid="group-delete-subtree-confirm"
            :disabled="confirmBlocked"
            @click="onConfirm"
          >
            {{ pending ? '削除中…' : '削除する' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.group-delete-subtree-dialog__message {
  margin: 0.75rem 0;
  line-height: 1.5;
  white-space: pre-wrap;
}
</style>
