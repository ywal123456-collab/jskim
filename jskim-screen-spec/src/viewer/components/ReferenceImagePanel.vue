<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { ReferenceImageManifestEntry } from '../types';
import type {
  FigmaWidthMismatchConfirmation,
  ReferenceImageRuntimeState,
} from '../preview/reference-image-client';
import { formatReferenceSourceImportedAt } from '../preview/reference-image-client';
import type { ReferenceViewport } from '../preview/preview-provider';
import PreviewImage from './PreviewImage.vue';
import ReferenceViewportTabs from './ReferenceViewportTabs.vue';
import ReferenceImageUploadDialog from './ReferenceImageUploadDialog.vue';
import ReferenceImageDeleteDialog from './ReferenceImageDeleteDialog.vue';
import ReferenceImageFigmaImportDialog from './ReferenceImageFigmaImportDialog.vue';

const props = defineProps<{
  viewport: ReferenceViewport;
  screenName: string;
  reference: ReferenceImageManifestEntry | null;
  runtime: ReferenceImageRuntimeState;
  editable: boolean;
  busy: boolean;
  actionsDisabled: boolean;
  statusMessage: string;
  errorMessage: string;
  infoMessage: string;
  dialogError: string;
  figmaConfirmation: FigmaWidthMismatchConfirmation | null;
  imageBaseUrl: string;
  panelId: string;
  labelledBy: string;
}>();

const emit = defineEmits<{
  'update:viewport': [ReferenceViewport];
  upload: [payload: { file: File; expectedImageRevision: string | null }];
  delete: [expectedImageRevision: string];
  'figma-import': [
    payload: {
      figmaUrl: string;
      expectedImageRevision: string | null;
      confirmWidthMismatch: boolean;
    },
  ];
  'figma-reimport': [
    payload: {
      expectedImageRevision: string;
      confirmWidthMismatch: boolean;
    },
  ];
  'clear-dialog-error': [];
  'abort-figma': [];
  'clear-figma-confirmation': [];
}>();

const uploadDialogOpen = ref(false);
const uploadMode = ref<'upload' | 'replace'>('upload');
const capturedExpectedRevision = ref<string | null>(null);
const deleteDialogOpen = ref(false);
const deleteExpectedRevision = ref('');
const figmaDialogOpen = ref(false);
const figmaDialogMode = ref<'import' | 'reimport'>('import');
const figmaExpectedRevision = ref<string | null>(null);
/** dialog を開いた trigger（Import / Reimport）。close 後に focus を戻す */
const figmaTriggerEl = ref<HTMLElement | null>(null);
/** viewport 切替など focus 復帰を抑止するとき false */
let restoreFigmaFocusOnClose = true;
let panelDisposed = false;

const persistedStatus = computed(
  () => props.reference?.status ?? 'missing',
);

const statusLabel = computed(() => {
  switch (persistedStatus.value) {
    case 'current':
      return '登録済み';
    case 'missing':
      return '未登録';
    case 'invalid':
      return 'データ破損';
    default:
      return '';
  }
});

const imagePath = computed(() => {
  const r = props.reference;
  if (!r || r.status !== 'current') {
    return '';
  }
  return r.imagePath;
});

const imageSrc = computed(() => {
  if (!imagePath.value) {
    return '';
  }
  const base = props.imageBaseUrl.endsWith('/')
    ? props.imageBaseUrl
    : `${props.imageBaseUrl}/`;
  return `${base}data/${imagePath.value}`;
});

const imageAlt = computed(() => {
  const vp = props.viewport === 'pc' ? 'PC' : 'SP';
  const screen = props.screenName || '画面';
  return `${screen}・${vp}参照画像`;
});

const showImage = computed(() => Boolean(imageSrc.value));

const metaLine = computed(() => {
  const r = props.reference;
  if (!r || r.status !== 'current') {
    return '';
  }
  return `${r.imageWidth} × ${r.imageHeight}`;
});

const sourceLines = computed(() => {
  const r = props.reference;
  if (!r || r.status !== 'current') {
    return [] as string[];
  }
  const source = r.source;
  if (!source || source.type === 'upload') {
    return ['参照画像：アップロード'];
  }
  if (source.type === 'figma') {
    return [
      '参照画像：Figma',
      `Frame：${source.frameName || '（名称不明）'}`,
      `取込日時：${formatReferenceSourceImportedAt(source.importedAt)}`,
    ];
  }
  return ['参照画像：不明なソース'];
});

const isFigmaSource = computed(() => {
  const r = props.reference;
  return (
    r?.status === 'current' &&
    r.source?.type === 'figma'
  );
});

const showAdd = computed(
  () =>
    props.editable &&
    persistedStatus.value === 'missing' &&
    (props.runtime.status === 'idle' || props.runtime.status === 'failed'),
);

const showReplaceDelete = computed(
  () => props.editable && persistedStatus.value === 'current',
);

const showFigmaImport = computed(
  () =>
    props.editable &&
    (persistedStatus.value === 'missing' ||
      persistedStatus.value === 'current') &&
    (props.runtime.status === 'idle' || props.runtime.status === 'failed'),
);

const showFigmaReimport = computed(
  () => props.editable && isFigmaSource.value,
);

const guidance = computed(() => {
  if (persistedStatus.value === 'missing') {
    return props.editable
      ? ''
      : 'この参照画像は登録されていません。';
  }
  if (persistedStatus.value === 'invalid') {
    return props.editable
      ? '参照画像の保存データを読み込めません。現在のバージョンでは破損した参照画像を画面から復旧できません。'
      : '参照画像の保存データを読み込めません。';
  }
  return '';
});

const progressText = computed(() => {
  if (props.statusMessage) {
    return props.statusMessage;
  }
  if (props.runtime.status === 'uploading') {
    return 'アップロード中…';
  }
  if (props.runtime.status === 'deleting') {
    return '削除中…';
  }
  if (props.runtime.status === 'importing') {
    return 'Figma 取り込み中…';
  }
  return '';
});

const showFailed = computed(
  () => props.runtime.status === 'failed' || Boolean(props.errorMessage),
);

const failedText = computed(() => {
  if (props.errorMessage) {
    return props.errorMessage;
  }
  if (props.runtime.status === 'failed') {
    if (props.runtime.operation === 'delete') {
      return '前回の削除に失敗しました。';
    }
    if (
      props.runtime.operation === 'import' ||
      props.runtime.operation === 'reimport'
    ) {
      return '前回の Figma 取り込みに失敗しました。';
    }
    return '前回のアップロードに失敗しました。';
  }
  return '';
});

watch(
  () => props.viewport,
  () => {
    uploadDialogOpen.value = false;
    deleteDialogOpen.value = false;
    // viewport 切替は navigation 相当のため trigger へ focus しない
    restoreFigmaFocusOnClose = false;
    figmaTriggerEl.value = null;
    if (figmaDialogOpen.value) {
      emit('abort-figma');
    }
    figmaDialogOpen.value = false;
  },
);

onBeforeUnmount(() => {
  panelDisposed = true;
  restoreFigmaFocusOnClose = false;
  figmaTriggerEl.value = null;
});

function rememberFigmaTrigger(event?: Event): void {
  const target = event?.currentTarget;
  figmaTriggerEl.value = target instanceof HTMLElement ? target : null;
  restoreFigmaFocusOnClose = true;
}

/** close 後に開いた trigger へ focus。要素が消えていれば何もしない */
function restoreFigmaTriggerFocus(): void {
  if (panelDisposed || !restoreFigmaFocusOnClose) {
    figmaTriggerEl.value = null;
    return;
  }
  const el = figmaTriggerEl.value;
  figmaTriggerEl.value = null;
  if (!el || !el.isConnected) {
    return;
  }
  void nextTick(() => {
    if (panelDisposed || !el.isConnected) {
      return;
    }
    try {
      el.focus();
    } catch {
      // focus 失敗は機能エラーに伝播させない
    }
  });
}

function openUpload(): void {
  uploadMode.value = 'upload';
  capturedExpectedRevision.value = null;
  emit('clear-dialog-error');
  uploadDialogOpen.value = true;
}

function openReplace(): void {
  const r = props.reference;
  if (!r || r.status !== 'current') {
    return;
  }
  uploadMode.value = 'replace';
  capturedExpectedRevision.value = r.imageRevision;
  emit('clear-dialog-error');
  uploadDialogOpen.value = true;
}

function openDelete(): void {
  const r = props.reference;
  if (!r || r.status !== 'current') {
    return;
  }
  deleteExpectedRevision.value = r.imageRevision;
  emit('clear-dialog-error');
  deleteDialogOpen.value = true;
}

function openFigmaImport(event?: Event): void {
  rememberFigmaTrigger(event);
  const r = props.reference;
  figmaDialogMode.value = 'import';
  figmaExpectedRevision.value =
    r?.status === 'current' ? r.imageRevision : null;
  emit('clear-dialog-error');
  emit('clear-figma-confirmation');
  figmaDialogOpen.value = true;
}

function openFigmaReimport(event?: Event): void {
  const r = props.reference;
  if (!r || r.status !== 'current' || r.source?.type !== 'figma') {
    return;
  }
  rememberFigmaTrigger(event);
  figmaDialogMode.value = 'reimport';
  figmaExpectedRevision.value = r.imageRevision;
  emit('clear-dialog-error');
  emit('clear-figma-confirmation');
  figmaDialogOpen.value = true;
}

function onUploadSubmit(file: File): void {
  emit('upload', {
    file,
    expectedImageRevision: capturedExpectedRevision.value,
  });
}

function onDeleteConfirm(): void {
  emit('delete', deleteExpectedRevision.value);
}

function onFigmaImportSubmit(payload: {
  figmaUrl: string;
  confirmWidthMismatch: boolean;
}): void {
  emit('figma-import', {
    figmaUrl: payload.figmaUrl,
    expectedImageRevision: figmaExpectedRevision.value,
    confirmWidthMismatch: payload.confirmWidthMismatch,
  });
}

function onFigmaReimportSubmit(payload: {
  confirmWidthMismatch: boolean;
}): void {
  const rev = figmaExpectedRevision.value;
  if (!rev) {
    return;
  }
  emit('figma-reimport', {
    expectedImageRevision: rev,
    confirmWidthMismatch: payload.confirmWidthMismatch,
  });
}

function closeUpload(): void {
  uploadDialogOpen.value = false;
}

function closeDelete(): void {
  deleteDialogOpen.value = false;
}

function closeFigma(): void {
  emit('abort-figma');
  figmaDialogOpen.value = false;
  restoreFigmaTriggerFocus();
}

/** 親から unchanged / validation keep を制御できるように公開 */
defineExpose({
  closeUpload,
  closeDelete,
  closeFigma,
  openUpload,
  openReplace,
  openFigmaImport,
  openFigmaReimport,
});
</script>

<template>
  <div
    :id="panelId"
    class="reference-image-panel"
    role="tabpanel"
    :aria-labelledby="labelledBy"
    data-testid="reference-image-panel"
    :data-viewport="viewport"
    :data-persisted-status="persistedStatus"
    :data-runtime-status="runtime.status"
  >
    <ReferenceViewportTabs
      :model-value="viewport"
      id-prefix="reference-viewport"
      @update:model-value="emit('update:viewport', $event)"
    />

    <div class="reference-image-panel__toolbar">
      <p
        class="reference-image-panel__status"
        data-testid="reference-image-status-label"
      >
        状態: {{ statusLabel }}
      </p>
      <div class="reference-image-panel__actions">
        <button
          v-if="showAdd"
          type="button"
          class="spec-page__btn"
          data-testid="reference-image-add"
          :disabled="actionsDisabled"
          @click="openUpload"
        >
          参照画像を追加
        </button>
        <button
          v-if="showFigmaImport"
          type="button"
          class="spec-page__btn spec-page__btn--secondary"
          data-testid="reference-image-figma-import"
          :disabled="actionsDisabled"
          @click="openFigmaImport"
        >
          Figmaから取込
        </button>
        <button
          v-if="showFigmaReimport"
          type="button"
          class="spec-page__btn spec-page__btn--secondary"
          data-testid="reference-image-figma-reimport"
          :disabled="actionsDisabled"
          @click="openFigmaReimport"
        >
          Figmaから再取込
        </button>
        <button
          v-if="showReplaceDelete"
          type="button"
          class="spec-page__btn spec-page__btn--secondary"
          data-testid="reference-image-replace"
          :disabled="actionsDisabled"
          @click="openReplace"
        >
          参照画像を置き換え
        </button>
        <button
          v-if="showReplaceDelete"
          type="button"
          class="spec-page__btn spec-page__btn--danger"
          data-testid="reference-image-delete"
          :disabled="actionsDisabled"
          @click="openDelete"
        >
          参照画像を削除
        </button>
      </div>
    </div>

    <p
      v-if="progressText"
      class="reference-image-panel__progress"
      data-testid="reference-image-progress"
      aria-live="polite"
    >
      {{ progressText }}
    </p>
    <p
      v-if="infoMessage"
      class="reference-image-panel__info"
      data-testid="reference-image-info"
      role="status"
    >
      {{ infoMessage }}
    </p>
    <p
      v-if="showFailed"
      class="reference-image-panel__error"
      data-testid="reference-image-error"
      role="alert"
    >
      {{ failedText }}
    </p>
    <p
      v-if="guidance"
      class="reference-image-panel__guidance"
      data-testid="reference-image-guidance"
    >
      {{ guidance }}
    </p>
    <div
      v-if="sourceLines.length"
      class="reference-image-panel__source"
      data-testid="reference-image-source"
    >
      <p
        v-for="(line, index) in sourceLines"
        :key="index"
        class="reference-image-panel__source-line"
      >
        {{ line }}
      </p>
    </div>
    <p
      v-if="metaLine"
      class="reference-image-panel__meta"
      data-testid="reference-image-meta"
    >
      {{ metaLine }}
    </p>

    <PreviewImage
      v-if="showImage"
      :src="imageSrc"
      :alt="imageAlt"
      kind="reference"
    />

    <ReferenceImageUploadDialog
      v-if="uploadDialogOpen"
      :mode="uploadMode"
      :screen-name="screenName"
      :viewport="viewport"
      :expected-image-revision="capturedExpectedRevision"
      :submitting="busy"
      :server-error="dialogError"
      @close="closeUpload"
      @submit="onUploadSubmit"
    />

    <ReferenceImageDeleteDialog
      v-if="deleteDialogOpen"
      :screen-name="screenName"
      :viewport="viewport"
      :submitting="busy"
      :server-error="dialogError"
      @close="closeDelete"
      @confirm="onDeleteConfirm"
    />

    <ReferenceImageFigmaImportDialog
      v-if="figmaDialogOpen"
      :mode="figmaDialogMode"
      :screen-name="screenName"
      :viewport="viewport"
      :has-existing-reference="persistedStatus === 'current'"
      :existing-is-figma="isFigmaSource"
      :submitting="busy"
      :server-error="dialogError"
      :confirmation="figmaConfirmation"
      @close="closeFigma"
      @submit="onFigmaImportSubmit"
      @submit-reimport="onFigmaReimportSubmit"
      @url-change="emit('clear-figma-confirmation')"
    />
  </div>
</template>

<style scoped>
.reference-image-panel__source {
  margin: 0.35rem 0;
}

.reference-image-panel__source-line {
  margin: 0.15rem 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.reference-image-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
</style>
