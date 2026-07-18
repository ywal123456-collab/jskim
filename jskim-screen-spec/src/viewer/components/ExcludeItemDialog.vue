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

const titleId = 'exclude-item-dialog-title';
const descId = 'exclude-item-dialog-desc';

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
      :aria-describedby="descId"
    >
      <h2 :id="titleId" class="create-screen-dialog__title">
        項目を設計対象から除外しますか？
      </h2>

      <div :id="descId" class="create-screen-dialog__form">
        <p class="spec-field__hint">
          項目ID: <code>{{ itemId }}</code>
        </p>
        <p class="spec-field__hint">
          項目名: {{ itemName || '（未設定）' }}
        </p>
        <p class="spec-field__hint">
          この項目は実装画面には残りますが、画面設計書の通常項目から除外されます。
        </p>
        <p class="spec-field__hint">入力済みの説明は保持されます。</p>
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
            class="spec-page__btn"
            data-action="confirm-exclude"
            @click="onConfirm"
          >
            設計対象から除外
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
