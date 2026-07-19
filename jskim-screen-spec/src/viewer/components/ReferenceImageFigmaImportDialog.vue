<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ReferenceViewport } from '../preview/preview-provider';
import type { FigmaWidthMismatchConfirmation } from '../preview/reference-image-client';

const props = defineProps<{
  mode: 'import' | 'reimport';
  screenName: string;
  viewport: ReferenceViewport;
  /** 既存 Reference があるとき true（上書き警告） */
  hasExistingReference: boolean;
  /** 既存が Figma source のとき true（別 URL 取込の説明） */
  existingIsFigma: boolean;
  submitting: boolean;
  serverError: string;
  confirmation: FigmaWidthMismatchConfirmation | null;
}>();

const emit = defineEmits<{
  close: [];
  /** confirmWidthMismatch は confirmation 表示後の再実行時のみ true */
  submit: [payload: { figmaUrl: string; confirmWidthMismatch: boolean }];
  /** Reimport 実行（URL なし） */
  'submit-reimport': [payload: { confirmWidthMismatch: boolean }];
  'url-change': [];
}>();

const titleId = 'reference-image-figma-dialog-title';
const descId = 'reference-image-figma-dialog-desc';
const urlInputId = 'reference-image-figma-url';
const urlInputRef = ref<HTMLInputElement | null>(null);
const cancelBtnRef = ref<HTMLButtonElement | null>(null);
const figmaUrl = ref('');
const localError = ref('');
/** confirmation を受けたあとユーザーが続行を選ぶまでのフラグ（親が confirmation を渡す） */
const awaitingConfirm = computed(() => Boolean(props.confirmation));

const viewportLabel = computed(() =>
  props.viewport === 'pc' ? 'PC' : 'SP',
);

const title = computed(() =>
  props.mode === 'reimport'
    ? 'Figma Frameを再取り込み'
    : 'Figma Frameを参照画像として取り込む',
);

const displayError = computed(() => props.serverError || localError.value);

const executeLabel = computed(() => {
  if (awaitingConfirm.value) {
    return '幅の違いを理解して取り込む';
  }
  return props.mode === 'reimport' ? '再取り込む' : '取り込む';
});

watch(
  () => props.confirmation,
  () => {
    localError.value = '';
  },
);

watch(
  () => figmaUrl.value,
  () => {
    if (props.mode === 'import') {
      localError.value = '';
      emit('url-change');
    }
  },
);

function requestClose(): void {
  // 進行中でも閉じると親が AbortController で request をキャンセルする
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

  if (props.mode === 'reimport') {
    emit('submit-reimport', {
      confirmWidthMismatch: awaitingConfirm.value,
    });
    return;
  }

  const trimmed = figmaUrl.value.trim();
  if (!trimmed) {
    localError.value = 'Figma Frame URL を入力してください。';
    return;
  }
  emit('submit', {
    figmaUrl: trimmed,
    confirmWidthMismatch: awaitingConfirm.value,
  });
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown);
  void nextTick(() => {
    if (props.mode === 'import') {
      urlInputRef.value?.focus();
    } else {
      cancelBtnRef.value?.focus();
    }
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown);
});
</script>

<template>
  <div
    class="create-screen-dialog-overlay"
    data-testid="reference-image-figma-dialog"
    @click.self="onOverlayClick"
  >
    <div
      class="create-screen-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="descId"
      :aria-busy="submitting ? 'true' : 'false'"
    >
      <h2 :id="titleId" class="create-screen-dialog__title">{{ title }}</h2>

      <div class="create-screen-dialog__form">
        <p :id="descId" class="spec-field__hint">
          対象画面: {{ screenName || '（未設定）' }} / ビューポート:
          {{ viewportLabel }}
        </p>

        <p
          v-if="hasExistingReference && mode === 'import'"
          class="spec-field__hint reference-image-figma-dialog__warn"
          data-testid="reference-image-figma-overwrite-warn"
          role="status"
        >
          現在の参照画像は置き換えられます。
          <template v-if="existingIsFigma">
            別の Figma Frame を取り込むと、再取り込み用の元 Frame
            も新しいものに切り替わります。
          </template>
        </p>

        <div
          v-if="mode === 'import' && !awaitingConfirm"
          class="spec-field"
        >
          <label class="spec-field__label" :for="urlInputId">
            Figma Frame URL
          </label>
          <input
            :id="urlInputId"
            ref="urlInputRef"
            v-model="figmaUrl"
            type="url"
            class="spec-field__input"
            data-testid="reference-image-figma-url"
            autocomplete="off"
            :disabled="submitting"
            placeholder="https://www.figma.com/design/..."
          />
        </div>

        <div
          v-if="awaitingConfirm && confirmation"
          class="reference-image-figma-dialog__confirm"
          data-testid="reference-image-figma-width-confirm"
          role="alert"
        >
          <p>
            Frame の幅がビューポート幅と異なります。このまま取り込む場合は確認してください。
          </p>
          <p class="reference-image-figma-dialog__confirm-meta">
            Frame：{{ confirmation.frame.frameName }}（{{
              confirmation.frame.width
            }}
            × {{ confirmation.frame.height }}）
          </p>
          <p class="reference-image-figma-dialog__confirm-meta">
            ビューポート：{{ confirmation.viewport.width }} ×
            {{ confirmation.viewport.height }}
          </p>
        </div>

        <p
          v-if="displayError"
          class="spec-field__error"
          data-testid="reference-image-figma-error"
          role="alert"
        >
          {{ displayError }}
        </p>
      </div>

      <div class="create-screen-dialog__actions">
        <button
          ref="cancelBtnRef"
          type="button"
          class="spec-page__btn spec-page__btn--secondary"
          data-testid="reference-image-figma-cancel"
          @click="requestClose"
        >
          キャンセル
        </button>
        <button
          type="button"
          class="spec-page__btn"
          data-testid="reference-image-figma-submit"
          :disabled="submitting"
          @click="onSubmit"
        >
          {{ submitting ? '処理中…' : executeLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reference-image-figma-dialog__warn {
  color: var(--spec-warning, #8a5a00);
}

.reference-image-figma-dialog__confirm {
  margin: 0.75rem 0;
  padding: 0.75rem;
  border: 1px solid var(--spec-border, #ccc);
  border-radius: 4px;
  background: var(--spec-surface-muted, #f7f7f5);
}

.reference-image-figma-dialog__confirm-meta {
  margin: 0.35rem 0 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}
</style>
