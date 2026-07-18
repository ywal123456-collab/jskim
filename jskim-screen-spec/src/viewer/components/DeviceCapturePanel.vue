<script setup lang="ts">
import { computed } from 'vue';
import type { DeviceCaptureManifestEntry } from '../types';
import type { DeviceCaptureRuntimeState } from '../preview/device-capture-client';
import type { DeviceCaptureViewport } from '../preview/preview-provider';
import DeviceCaptureImage from './DeviceCaptureImage.vue';

const props = defineProps<{
  viewport: DeviceCaptureViewport;
  screenName: string;
  stateName: string;
  capture: DeviceCaptureManifestEntry | null;
  runtime: DeviceCaptureRuntimeState;
  editable: boolean;
  collecting: boolean;
  statusMessage: string;
  errorMessage: string;
  infoMessage: string;
  imageBaseUrl: string;
  panelId: string;
  labelledBy: string;
  disabledReason?: string;
}>();

const emit = defineEmits<{
  collect: [];
}>();

const persistedStatus = computed(
  () => props.capture?.status ?? 'missing',
);

const statusLabel = computed(() => {
  switch (persistedStatus.value) {
    case 'current':
      return '最新';
    case 'stale':
      return '更新が必要';
    case 'missing':
      return '未収集';
    case 'invalid':
      return 'データ破損';
    default:
      return '';
  }
});

const imagePath = computed(() => {
  const c = props.capture;
  if (!c || (c.status !== 'current' && c.status !== 'stale')) {
    return '';
  }
  return c.imagePath;
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
  const state = props.stateName || '状態';
  return `${screen}・${state}・${vp} Device Preview`;
});

const collectLabel = computed(() =>
  props.viewport === 'pc' ? 'PC Previewを再収集' : 'SP Previewを再収集',
);

const showCollectButton = computed(() => props.editable);

const collectDisabled = computed(
  () => props.collecting || Boolean(props.disabledReason),
);

const showImage = computed(() => Boolean(imageSrc.value));

const guidance = computed(() => {
  if (persistedStatus.value === 'stale') {
    return '実装またはリソースが変更されています。必要に応じてPreviewを再収集してください。';
  }
  if (persistedStatus.value === 'missing') {
    return props.editable
      ? 'このDevice Previewはまだ収集されていません。'
      : 'このDevice Previewはまだ収集されていません。';
  }
  if (persistedStatus.value === 'invalid') {
    return props.editable
      ? 'Device Previewの保存データを読み込めません。再収集してください。'
      : 'Device Previewの保存データを読み込めません。管理者に再生成を依頼してください。';
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
    return (
      props.runtime.error?.message || '前回の収集に失敗しました。'
    );
  }
  return '';
});
</script>

<template>
  <div
    :id="panelId"
    class="device-capture-panel"
    role="tabpanel"
    :aria-labelledby="labelledBy"
    data-testid="device-capture-panel"
    :data-viewport="viewport"
    :data-persisted-status="persistedStatus"
    :data-runtime-status="runtime.status"
  >
    <div class="device-capture-panel__toolbar">
      <p
        class="device-capture-panel__status"
        data-testid="device-capture-status-label"
      >
        状態: {{ statusLabel }}
      </p>
      <button
        v-if="showCollectButton"
        type="button"
        class="spec-page__btn spec-page__btn--secondary device-capture-panel__collect"
        data-testid="device-capture-collect"
        :disabled="collectDisabled"
        :aria-label="collectLabel"
        :title="disabledReason || collectLabel"
        @click="emit('collect')"
      >
        {{ collectLabel }}
      </button>
    </div>

    <p
      v-if="collecting || statusMessage"
      class="device-capture-panel__progress"
      data-testid="device-capture-progress"
      aria-live="polite"
    >
      {{ statusMessage || '収集中…' }}
    </p>

    <p
      v-if="infoMessage"
      class="device-capture-panel__info"
      data-testid="device-capture-info"
      role="status"
    >
      {{ infoMessage }}
    </p>

    <p
      v-if="showFailed"
      class="device-capture-panel__error"
      data-testid="device-capture-error"
      role="alert"
    >
      {{ failedText }}
    </p>

    <p
      v-if="guidance"
      class="device-capture-panel__guidance"
      data-testid="device-capture-guidance"
    >
      {{ guidance }}
    </p>

    <DeviceCaptureImage
      v-if="showImage"
      :src="imageSrc"
      :alt="imageAlt"
    />
  </div>
</template>
