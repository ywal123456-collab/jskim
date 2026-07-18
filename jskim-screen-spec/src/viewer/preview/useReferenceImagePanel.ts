/**
 * 参照画像 panel の状態・upload/replace/delete・runtime polling・pending 再開。
 */

import {
  computed,
  onUnmounted,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue';
import type {
  ReferenceImageManifestEntry,
  ScreenData,
} from '../types.js';
import {
  clearPendingReferenceImage,
  peekPendingReferenceImage,
  referenceImageKey,
  setPendingReferenceImage,
  type PendingReferenceImage,
} from './pending-reference-image.js';
import type { ReferenceViewport } from './preview-provider.js';
import {
  deleteReferenceImageRequest,
  fetchReferenceImageStatus,
  putReferenceImageMultipart,
  validateReferenceImageFile,
  waitForReferenceImageManifest,
  type ReferenceImageRuntimeState,
} from './reference-image-client.js';

const POLL_INTERVAL_MS = 800;

export type UseReferenceImagePanelOptions = {
  projectName: ComputedRef<string> | Ref<string> | (() => string);
  screenId: ComputedRef<string> | Ref<string> | (() => string);
  viewport: ComputedRef<ReferenceViewport | null> | Ref<ReferenceViewport | null> | (() => ReferenceViewport | null);
  /** effectiveProvider === 'reference' のとき true。false なら polling しない */
  active: ComputedRef<boolean> | Ref<boolean> | (() => boolean);
  screen: ComputedRef<ScreenData | null> | Ref<ScreenData | null> | (() => ScreenData | null);
  editable: ComputedRef<boolean> | Ref<boolean> | (() => boolean);
  /** 画面 create/delete/duplicate 等の他 pending */
  blocked: ComputedRef<boolean> | Ref<boolean> | (() => boolean);
  reloadScreen: () => Promise<void>;
  screenDataUrl: (screenId: string) => string;
  fetchFn?: typeof fetch;
  pollIntervalMs?: number;
};

function resolve<T>(v: ComputedRef<T> | Ref<T> | (() => T)): T {
  if (typeof v === 'function') {
    return (v as () => T)();
  }
  return v.value;
}

export function useReferenceImagePanel(options: UseReferenceImagePanelOptions) {
  const runtime = ref<ReferenceImageRuntimeState>({ status: 'idle' });
  const localPending = ref(false);
  const awaitingManifest = ref(false);
  const statusMessage = ref('');
  const errorMessage = ref('');
  const infoMessage = ref('');
  const activeRequestKey = ref<string | null>(null);
  const dialogError = ref('');

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let waitAbort: AbortController | null = null;
  let disposed = false;

  const currentKey = computed(() => {
    const vp = resolve(options.viewport);
    if (!vp || !resolve(options.active)) {
      return null;
    }
    return referenceImageKey(resolve(options.screenId), vp);
  });

  const persistedReference = computed((): ReferenceImageManifestEntry => {
    const vp = resolve(options.viewport);
    const scr = resolve(options.screen);
    if (!vp || !scr?.referenceImages) {
      return { status: 'missing' };
    }
    return scr.referenceImages[vp] ?? { status: 'missing' };
  });

  const isBusy = computed(
    () =>
      localPending.value ||
      awaitingManifest.value ||
      runtime.value.status === 'uploading' ||
      runtime.value.status === 'deleting',
  );

  const actionsDisabled = computed(
    () =>
      isBusy.value ||
      resolve(options.blocked) ||
      !resolve(options.screen) ||
      !resolve(options.viewport),
  );

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function stopWait(): void {
    if (waitAbort) {
      waitAbort.abort();
      waitAbort = null;
    }
  }

  function clearUiMessages(): void {
    statusMessage.value = '';
    errorMessage.value = '';
    infoMessage.value = '';
    dialogError.value = '';
  }

  async function refreshStatus(): Promise<void> {
    if (!resolve(options.editable) || !resolve(options.active)) {
      runtime.value = { status: 'idle' };
      stopPolling();
      return;
    }
    const vp = resolve(options.viewport);
    if (!vp) {
      stopPolling();
      runtime.value = { status: 'idle' };
      return;
    }
    const keyAtStart = currentKey.value;
    const result = await fetchReferenceImageStatus({
      screenId: resolve(options.screenId),
      viewport: vp,
      fetchFn: options.fetchFn,
    });
    if (disposed || currentKey.value !== keyAtStart) {
      return;
    }
    if (!result.ok) {
      if (result.error.status === 404) {
        runtime.value = { status: 'idle' };
        stopPolling();
        errorMessage.value = result.error.message;
      }
      return;
    }
    runtime.value = result.data.runtime;
    if (
      result.data.runtime.status === 'uploading' ||
      result.data.runtime.status === 'deleting'
    ) {
      startPolling();
      statusMessage.value =
        result.data.runtime.status === 'uploading'
          ? 'アップロード中…'
          : '削除中…';
    } else {
      stopPolling();
      if (result.data.runtime.status === 'failed') {
        const op = result.data.runtime.operation;
        errorMessage.value =
          result.data.runtime.error?.message ||
          (op === 'delete'
            ? '前回の削除に失敗しました。'
            : '前回のアップロードに失敗しました。');
      }
    }
  }

  function startPolling(): void {
    if (pollTimer || !resolve(options.editable) || !resolve(options.active)) {
      return;
    }
    const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    pollTimer = setInterval(() => {
      void refreshStatus().then(async () => {
        if (disposed) {
          return;
        }
        if (
          runtime.value.status === 'idle' &&
          !localPending.value &&
          !awaitingManifest.value
        ) {
          stopPolling();
          await options.reloadScreen();
        }
      });
    }, interval);
  }

  async function resumePendingIfNeeded(): Promise<void> {
    if (!resolve(options.editable) || !resolve(options.active)) {
      return;
    }
    const pending = peekPendingReferenceImage(resolve(options.projectName));
    if (!pending) {
      return;
    }
    const vp = resolve(options.viewport);
    if (
      !vp ||
      pending.screenId !== resolve(options.screenId) ||
      pending.viewport !== vp
    ) {
      return;
    }
    awaitingManifest.value = true;
    statusMessage.value =
      pending.operation === 'delete'
        ? '削除結果を反映しています…'
        : 'アップロード結果を反映しています…';
    await waitForPending(pending);
  }

  async function waitForPending(pending: PendingReferenceImage): Promise<void> {
    stopWait();
    waitAbort = new AbortController();
    const keyAtStart = referenceImageKey(pending.screenId, pending.viewport);
    const ok =
      pending.operation === 'delete'
        ? await waitForReferenceImageManifest({
            screenDataUrl: options.screenDataUrl(pending.screenId),
            viewport: pending.viewport,
            mode: 'missing',
            signal: waitAbort.signal,
            fetchFn: options.fetchFn,
          })
        : await waitForReferenceImageManifest({
            screenDataUrl: options.screenDataUrl(pending.screenId),
            viewport: pending.viewport,
            mode: 'revision',
            expectedImageRevision: pending.resultImageRevision,
            signal: waitAbort.signal,
            fetchFn: options.fetchFn,
          });
    if (disposed || currentKey.value !== keyAtStart) {
      return;
    }
    if (ok) {
      clearPendingReferenceImage(resolve(options.projectName));
      awaitingManifest.value = false;
      localPending.value = false;
      activeRequestKey.value = null;
      statusMessage.value = '';
      infoMessage.value =
        pending.operation === 'delete'
          ? '参照画像を削除しました。'
          : '参照画像を更新しました。';
      errorMessage.value = '';
      await options.reloadScreen();
      runtime.value = { status: 'idle' };
    }
  }

  async function uploadOrReplace(optionsUpload: {
    file: File;
    expectedImageRevision: string | null;
  }): Promise<{ ok: true; result: string } | { ok: false; keepDialog: boolean }> {
    if (!resolve(options.editable) || actionsDisabled.value) {
      return { ok: false, keepDialog: true };
    }
    const vp = resolve(options.viewport);
    if (!vp) {
      return { ok: false, keepDialog: true };
    }

    const fileCheck = validateReferenceImageFile(optionsUpload.file);
    if (!fileCheck.ok) {
      dialogError.value = fileCheck.message;
      return { ok: false, keepDialog: true };
    }

    clearUiMessages();
    const reqKey = referenceImageKey(resolve(options.screenId), vp);
    activeRequestKey.value = reqKey;
    localPending.value = true;
    statusMessage.value = 'アップロード中…';
    runtime.value = { status: 'uploading' };

    const putOpts: Parameters<typeof putReferenceImageMultipart>[0] = {
      screenId: resolve(options.screenId),
      viewport: vp,
      file: optionsUpload.file,
      fetchFn: options.fetchFn,
    };
    if (optionsUpload.expectedImageRevision != null) {
      putOpts.expectedImageRevision = optionsUpload.expectedImageRevision;
    }

    const result = await putReferenceImageMultipart(putOpts);

    if (disposed || activeRequestKey.value !== reqKey) {
      return { ok: false, keepDialog: false };
    }

    if (!result.ok) {
      localPending.value = false;
      activeRequestKey.value = null;
      statusMessage.value = '';

      if (result.error.code === 'SPEC_REFERENCE_IMAGE_IN_PROGRESS') {
        statusMessage.value =
          '同じ参照画像を更新または削除しています。完了後に再度実行してください。';
        await refreshStatus();
        return { ok: false, keepDialog: false };
      }
      if (result.error.code === 'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT') {
        errorMessage.value =
          '参照画像が別の操作で更新されました。最新の状態を確認してから再度実行してください。';
        runtime.value = { status: 'idle' };
        await refreshStatus();
        await options.reloadScreen();
        return { ok: false, keepDialog: false };
      }
      if (result.error.code === 'SPEC_REFERENCE_IMAGE_INVALID') {
        errorMessage.value = result.error.message;
        runtime.value = { status: 'idle' };
        await options.reloadScreen();
        return { ok: false, keepDialog: false };
      }
      if (result.error.status === 404) {
        errorMessage.value = result.error.message;
        runtime.value = { status: 'idle' };
        await options.reloadScreen();
        return { ok: false, keepDialog: false };
      }
      if (
        result.error.status === 400 ||
        result.error.status === 413 ||
        result.error.status === 415
      ) {
        dialogError.value = result.error.message;
        runtime.value = { status: 'idle' };
        return { ok: false, keepDialog: true };
      }
      errorMessage.value = result.error.message;
      runtime.value = {
        status: 'failed',
        operation: 'upload',
        error: { code: result.error.code, message: result.error.message },
      };
      return { ok: false, keepDialog: false };
    }

    if (result.data.result === 'unchanged') {
      localPending.value = false;
      activeRequestKey.value = null;
      awaitingManifest.value = false;
      clearPendingReferenceImage(resolve(options.projectName));
      statusMessage.value = '';
      infoMessage.value = '同じ参照画像が登録されています。';
      runtime.value = { status: 'idle' };
      return { ok: true, result: 'unchanged' };
    }

    const imageRevision = result.data.referenceImage.imageRevision;
    const pending: PendingReferenceImage = {
      operation: 'upload',
      screenId: result.data.screenId,
      viewport: result.data.viewport,
      expectedImageRevision: optionsUpload.expectedImageRevision,
      resultImageRevision: imageRevision,
    };
    setPendingReferenceImage(resolve(options.projectName), pending);
    awaitingManifest.value = true;
    statusMessage.value = 'アップロード結果を反映しています…';
    await waitForPending(pending);
    return { ok: true, result: result.data.result };
  }

  async function deleteCurrent(expectedImageRevision: string): Promise<boolean> {
    if (!resolve(options.editable) || actionsDisabled.value) {
      return false;
    }
    const vp = resolve(options.viewport);
    if (!vp) {
      return false;
    }

    clearUiMessages();
    const reqKey = referenceImageKey(resolve(options.screenId), vp);
    activeRequestKey.value = reqKey;
    localPending.value = true;
    statusMessage.value = '削除中…';
    runtime.value = { status: 'deleting' };

    const result = await deleteReferenceImageRequest({
      screenId: resolve(options.screenId),
      viewport: vp,
      expectedImageRevision,
      fetchFn: options.fetchFn,
    });

    if (disposed || activeRequestKey.value !== reqKey) {
      return false;
    }

    if (!result.ok) {
      localPending.value = false;
      activeRequestKey.value = null;
      statusMessage.value = '';

      if (result.error.code === 'SPEC_REFERENCE_IMAGE_IN_PROGRESS') {
        statusMessage.value =
          '同じ参照画像を更新または削除しています。完了後に再度実行してください。';
        await refreshStatus();
        return false;
      }
      if (result.error.code === 'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT') {
        errorMessage.value =
          '参照画像が別の操作で更新されました。最新の状態を確認してから再度実行してください。';
        runtime.value = { status: 'idle' };
        await refreshStatus();
        await options.reloadScreen();
        return false;
      }
      if (
        result.error.code === 'SPEC_REFERENCE_IMAGE_INVALID' ||
        result.error.status === 404
      ) {
        errorMessage.value = result.error.message;
        runtime.value = { status: 'idle' };
        await options.reloadScreen();
        return false;
      }
      errorMessage.value = result.error.message;
      runtime.value = {
        status: 'failed',
        operation: 'delete',
        error: { code: result.error.code, message: result.error.message },
      };
      return false;
    }

    const pending: PendingReferenceImage = {
      operation: 'delete',
      screenId: result.data.screenId,
      viewport: result.data.viewport,
      expectedImageRevision,
      expectedMissing: true,
    };
    setPendingReferenceImage(resolve(options.projectName), pending);
    awaitingManifest.value = true;
    statusMessage.value = '削除結果を反映しています…';
    await waitForPending(pending);
    return true;
  }

  watch(
    currentKey,
    () => {
      stopPolling();
      stopWait();
      localPending.value = false;
      awaitingManifest.value = false;
      activeRequestKey.value = null;
      clearUiMessages();
      runtime.value = { status: 'idle' };
      if (
        resolve(options.active) &&
        resolve(options.viewport) &&
        resolve(options.editable)
      ) {
        void refreshStatus().then(() => resumePendingIfNeeded());
      }
    },
    { immediate: true },
  );

  onUnmounted(() => {
    disposed = true;
    stopPolling();
    stopWait();
  });

  return {
    runtime,
    persistedReference,
    localPending,
    awaitingManifest,
    isBusy,
    actionsDisabled,
    statusMessage,
    errorMessage,
    infoMessage,
    dialogError,
    refreshStatus,
    uploadOrReplace,
    deleteCurrent,
    resumePendingIfNeeded,
    stopPolling,
    clearDialogError: () => {
      dialogError.value = '';
    },
  };
}
