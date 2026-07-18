<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';

const props = defineProps<{
  itemId: string;
  itemName: string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

const titleId = 'delete-item-dialog-title';

function requestClose(): void {
  emit('close');
}

function onOverlayClick(): void {
  requestClose();
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    requestClose();
  }
}

function onConfirm(): void {
  emit('confirm');
  emit('close');
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown);
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
    >
      <h2 :id="titleId" class="create-screen-dialog__title">項目を削除しますか？</h2>

      <div class="create-screen-dialog__form">
        <p class="spec-field__hint">
          項目ID: <code>{{ itemId }}</code>
        </p>
        <p class="spec-field__hint">
          項目名: {{ itemName || '（未設定）' }}
        </p>
        <p class="spec-field__hint">
          保存するまでファイルには反映されません。
        </p>

        <div class="create-screen-dialog__actions">
          <button
            type="button"
            class="spec-page__btn spec-page__btn--secondary"
            @click="requestClose"
          >
            キャンセル
          </button>
          <button
            type="button"
            class="spec-page__btn spec-page__btn--danger"
            data-action="confirm-delete"
            @click="onConfirm"
          >
            削除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
