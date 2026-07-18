<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ReferenceViewport } from '../preview/preview-provider';
import {
  MAX_REFERENCE_IMAGE_UPLOAD_BYTES,
  validateReferenceImageFile,
} from '../preview/reference-image-client';

const props = defineProps<{
  mode: 'upload' | 'replace';
  screenName: string;
  viewport: ReferenceViewport;
  /** replace 時に Dialog open 時点でキャプチャした revision */
  expectedImageRevision: string | null;
  submitting: boolean;
  serverError: string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [file: File];
}>();

const titleId = 'reference-image-upload-dialog-title';
const descId = 'reference-image-upload-dialog-desc';
const fileInputRef = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const localError = ref('');
const cancelBtnRef = ref<HTMLButtonElement | null>(null);

const viewportLabel = computed(() =>
  props.viewport === 'pc' ? 'PC' : 'SP',
);

const title = computed(() =>
  props.mode === 'replace'
    ? `${viewportLabel.value}参照画像を置き換え`
    : `${viewportLabel.value}参照画像を追加`,
);

const maxSizeLabel = computed(
  () => `${Math.floor(MAX_REFERENCE_IMAGE_UPLOAD_BYTES / (1024 * 1024))} MiB`,
);

const displayError = computed(() => props.serverError || localError.value);

function onFileChange(event: Event): void {
  localError.value = '';
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  selectedFile.value = file;
  const check = validateReferenceImageFile(file);
  if (!check.ok) {
    localError.value = check.message;
  }
}

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

function onSubmit(): void {
  if (props.submitting) {
    return;
  }
  localError.value = '';
  const check = validateReferenceImageFile(selectedFile.value);
  if (!check.ok || !selectedFile.value) {
    localError.value = check.ok
      ? 'PNGファイルを選択してください。'
      : check.message;
    return;
  }
  emit('submit', selectedFile.value);
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
    data-testid="reference-image-upload-dialog"
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
          画面: {{ screenName || '（未設定）' }} / {{ viewportLabel }}
        </p>
        <p class="spec-field__hint">PNGファイルを選択してください。</p>
        <p class="spec-field__hint">
          最大ファイルサイズは{{ maxSizeLabel }}です。
        </p>

        <label class="spec-field">
          <span>PNGファイル</span>
          <input
            ref="fileInputRef"
            type="file"
            accept="image/png,.png"
            data-testid="reference-image-file-input"
            :disabled="submitting"
            @change="onFileChange"
          />
        </label>

        <p
          v-if="displayError"
          class="create-screen-dialog__error"
          role="alert"
          data-testid="reference-image-upload-error"
        >
          {{ displayError }}
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
            class="spec-page__btn"
            data-testid="reference-image-upload-submit"
            :disabled="submitting"
            @click="onSubmit"
          >
            {{ mode === 'replace' ? '置き換え' : 'アップロード' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
