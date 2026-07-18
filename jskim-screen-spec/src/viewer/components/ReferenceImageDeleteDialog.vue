<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ReferenceViewport } from '../preview/preview-provider';

const props = defineProps<{
  screenName: string;
  viewport: ReferenceViewport;
  submitting: boolean;
  serverError: string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

const titleId = 'reference-image-delete-dialog-title';
const descId = 'reference-image-delete-dialog-desc';
const cancelBtnRef = ref<HTMLButtonElement | null>(null);

const viewportLabel = computed(() =>
  props.viewport === 'pc' ? 'PC' : 'SP',
);

const title = computed(
  () =>
    `${props.screenName || '画面'}の${viewportLabel.value}参照画像を削除`,
);

function requestClose(): void {
  if (props.submitting) {
    return;
  }
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
  if (props.submitting) {
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
  <div
    class="create-screen-dialog-overlay"
    data-testid="reference-image-delete-dialog"
    @click.self="onOverlayClick"
  >
    <div
      class="create-screen-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="descId"
    >
      <h2 :id="titleId" class="create-screen-dialog__title">{{ title }}</h2>

      <div class="create-screen-dialog__form">
        <p :id="descId" class="spec-field__hint">
          {{ viewportLabel }}参照画像を削除します。
        </p>
        <p class="spec-field__hint">この操作は元に戻せません。</p>

        <p
          v-if="serverError"
          class="create-screen-dialog__error"
          role="alert"
        >
          {{ serverError }}
        </p>

        <div class="create-screen-dialog__actions">
          <button
            ref="cancelBtnRef"
            type="button"
            class="spec-page__btn spec-page__btn--secondary"
            :disabled="submitting"
            @click="requestClose"
          >
            キャンセル
          </button>
          <button
            type="button"
            class="spec-page__btn spec-page__btn--danger"
            data-testid="reference-image-delete-confirm"
            :disabled="submitting"
            @click="onConfirm"
          >
            削除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
