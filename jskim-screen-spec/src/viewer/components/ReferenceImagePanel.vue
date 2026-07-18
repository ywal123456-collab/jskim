<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ReferenceImageManifestEntry } from '../types';
import type { ReferenceImageRuntimeState } from '../preview/reference-image-client';
import type { ReferenceViewport } from '../preview/preview-provider';
import PreviewImage from './PreviewImage.vue';
import ReferenceViewportTabs from './ReferenceViewportTabs.vue';
import ReferenceImageUploadDialog from './ReferenceImageUploadDialog.vue';
import ReferenceImageDeleteDialog from './ReferenceImageDeleteDialog.vue';

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
  imageBaseUrl: string;
  panelId: string;
  labelledBy: string;
}>();

const emit = defineEmits<{
  'update:viewport': [ReferenceViewport];
  upload: [payload: { file: File; expectedImageRevision: string | null }];
  delete: [expectedImageRevision: string];
  'clear-dialog-error': [];
}>();

const uploadDialogOpen = ref(false);
const uploadMode = ref<'upload' | 'replace'>('upload');
const capturedExpectedRevision = ref<string | null>(null);
const deleteDialogOpen = ref(false);
const deleteExpectedRevision = ref('');

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

const showAdd = computed(
  () =>
    props.editable &&
    persistedStatus.value === 'missing' &&
    (props.runtime.status === 'idle' || props.runtime.status === 'failed'),
);

const showReplaceDelete = computed(
  () => props.editable && persistedStatus.value === 'current',
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
    return props.runtime.operation === 'delete'
      ? '前回の削除に失敗しました。'
      : '前回のアップロードに失敗しました。';
  }
  return '';
});

watch(
  () => props.viewport,
  () => {
    uploadDialogOpen.value = false;
    deleteDialogOpen.value = false;
  },
);

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

function onUploadSubmit(file: File): void {
  emit('upload', {
    file,
    expectedImageRevision: capturedExpectedRevision.value,
  });
}

function onDeleteConfirm(): void {
  emit('delete', deleteExpectedRevision.value);
}

function closeUpload(): void {
  uploadDialogOpen.value = false;
}

function closeDelete(): void {
  deleteDialogOpen.value = false;
}

/** 親から unchanged / validation keep を制御できるように公開 */
defineExpose({
  closeUpload,
  closeDelete,
  openUpload,
  openReplace,
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
  </div>
</template>
