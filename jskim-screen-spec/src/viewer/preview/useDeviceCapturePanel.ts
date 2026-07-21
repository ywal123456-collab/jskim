/**
 * PC/SP Device Capture panel の状態・再収集・runtime polling。
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
  DeviceCaptureManifestEntry,
  ScreenData,
} from '../types.js';
import {
  fetchDeviceCaptureStatus,
  postDeviceCaptureCollect,
  waitForDeviceCaptureRevision,
  type DeviceCaptureRuntimeState,
} from './device-capture-client.js';
import type { ScreenDataReloadOutcome } from '../screen-view-bundle.js';
import {
  clearPendingDeviceCapture,
  peekPendingDeviceCapture,
  setPendingDeviceCapture,
  type PendingDeviceCapture,
} from './pending-device-capture.js';
import {
  createPanelOperationController,
  type PanelFetchFn,
  type PanelWorkIdentity,
} from './panel-operation-lifecycle.js';
import type { DeviceCaptureViewport } from './preview-provider.js';

const POLL_INTERVAL_MS = 800;

const RELOAD_FAILED_MESSAGE =
  'Device Previewは更新されましたが、画面を再読み込みできませんでした。最新内容を再読み込みしてください。';

export type UseDeviceCapturePanelOptions = {
  projectName: ComputedRef<string> | Ref<string> | (() => string);
  screenId: ComputedRef<string> | Ref<string> | (() => string);
  stateId: ComputedRef<string> | Ref<string> | (() => string);
  viewport: ComputedRef<DeviceCaptureViewport | null> | Ref<DeviceCaptureViewport | null> | (() => DeviceCaptureViewport | null);
  screen: ComputedRef<ScreenData | null> | Ref<ScreenData | null> | (() => ScreenData | null);
  editable: ComputedRef<boolean> | Ref<boolean> | (() => boolean);
  /** screen JSON 再読込（manifest revision 反映後） */
  reloadScreen: () => Promise<ScreenDataReloadOutcome>;
  screenDataUrl: (screenId: string) => string;
  fetchFn?: PanelFetchFn;
  pollIntervalMs?: number;
};

function resolve<T>(v: ComputedRef<T> | Ref<T> | (() => T)): T {
  if (typeof v === 'function') {
    return (v as () => T)();
  }
  return v.value;
}

export function useDeviceCapturePanel(options: UseDeviceCapturePanelOptions) {
  const runtime = ref<DeviceCaptureRuntimeState>({ status: 'idle' });
  const localPending = ref(false);
  const awaitingManifest = ref(false);
  const reloadPending = ref(false);
  const statusMessage = ref('');
  const errorMessage = ref('');
  const infoMessage = ref('');

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let waitAbort: AbortController | null = null;
  let disposed = false;

  const currentKey = computed(() => {
    const vp = resolve(options.viewport);
    if (!vp) {
      return null;
    }
    return `${resolve(options.screenId)}\0${resolve(options.stateId)}\0${vp}`;
  });

  const operation = createPanelOperationController(
    () => currentKey.value,
    () => disposed,
    { localPending, awaitingManifest, reloadPending },
  );

  const persistedCapture = computed((): DeviceCaptureManifestEntry | null => {
    const vp = resolve(options.viewport);
    const scr = resolve(options.screen);
    if (!vp || !scr) {
      return null;
    }
    const state = scr.states.find((s) => s.id === resolve(options.stateId));
    return state?.deviceCaptures?.[vp] ?? { status: 'missing' };
  });

  const isCollecting = computed(
    () =>
      operation.hasActiveWork() ||
      runtime.value.status === 'collecting',
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
  }

  function setRuntimeIdle(): void {
    runtime.value = { status: 'idle' };
  }

  async function completeAfterServerSuccess(
    identity: PanelWorkIdentity,
    successInfoMessage: string,
  ): Promise<void> {
    if (!operation.isActiveWork(identity)) {
      return;
    }
    statusMessage.value = '';
    const reloadOutcome = await operation.reloadWithOutcome(options.reloadScreen);
    if (!operation.isActiveWork(identity)) {
      return;
    }
    if (reloadOutcome.status === 'applied') {
      infoMessage.value = successInfoMessage;
      errorMessage.value = '';
    } else if (reloadOutcome.status === 'failed') {
      infoMessage.value = '';
      errorMessage.value = RELOAD_FAILED_MESSAGE;
    }
    if (operation.finishWork(identity)) {
      setRuntimeIdle();
    }
  }

  /** local operation identity 内で reconcile reload を完了してから finish */
  async function reconcileWithinOperation(
    identity: PanelWorkIdentity,
  ): Promise<void> {
    if (!operation.isActiveWork(identity)) {
      return;
    }
    const reloadOutcome = await operation.reloadWithOutcome(options.reloadScreen);
    if (!operation.isActiveWork(identity)) {
      return;
    }
    if (reloadOutcome.status === 'failed' && !errorMessage.value) {
      errorMessage.value = RELOAD_FAILED_MESSAGE;
    }
    if (operation.finishWork(identity)) {
      setRuntimeIdle();
    }
  }

  async function runBackgroundReload(contextKey: string): Promise<boolean> {
    const identity = operation.beginReload(contextKey);
    if (!identity) {
      return false;
    }
    stopPolling();
    const reloadOutcome = await operation.reloadWithOutcome(options.reloadScreen);
    if (!operation.isActiveWork(identity)) {
      return true;
    }
    if (reloadOutcome.status === 'failed' && !errorMessage.value) {
      errorMessage.value = RELOAD_FAILED_MESSAGE;
    }
    operation.finishWork(identity);
    return true;
  }

  async function refreshStatus(): Promise<void> {
    if (!resolve(options.editable)) {
      runtime.value = { status: 'idle' };
      return;
    }
    const vp = resolve(options.viewport);
    if (!vp) {
      stopPolling();
      runtime.value = { status: 'idle' };
      return;
    }
    const keyAtStart = currentKey.value;
    const result = await fetchDeviceCaptureStatus({
      screenId: resolve(options.screenId),
      stateId: resolve(options.stateId),
      viewport: vp,
      fetchFn: options.fetchFn,
    });
    if (disposed || currentKey.value !== keyAtStart) {
      return;
    }
    if (!result.ok) {
      return;
    }
    // local / reload work 中は API runtime で上書きしない（busy 契約を壊さない）
    if (!operation.hasActiveWork()) {
      runtime.value = result.data.runtime;
    }
    if (result.data.runtime.status === 'collecting') {
      startPolling();
    } else if (!operation.hasActiveWork()) {
      stopPolling();
      if (result.data.runtime.status === 'failed') {
        const msg =
          result.data.runtime.error?.message ||
          '前回の収集に失敗しました。';
        errorMessage.value = msg;
      }
    }
    // hasActiveWork 中に idle を見ても polling は維持（完了後の再試行用）
  }

  function startPolling(): void {
    if (pollTimer || !resolve(options.editable)) {
      return;
    }
    const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    pollTimer = setInterval(() => {
      void refreshStatus().then(async () => {
        if (disposed) {
          return;
        }
        const contextKey = currentKey.value;
        if (!contextKey) {
          return;
        }
        // local / 別 reload 中は reload せず timer を維持して次 tick で再評価
        if (operation.hasActiveWork()) {
          return;
        }
        if (runtime.value.status !== 'idle') {
          return;
        }
        await runBackgroundReload(contextKey);
      });
    }, interval);
  }

  async function resumePendingIfNeeded(): Promise<void> {
    if (!resolve(options.editable) || operation.hasActiveWork()) {
      return;
    }
    const pending = peekPendingDeviceCapture(resolve(options.projectName));
    if (!pending) {
      return;
    }
    const vp = resolve(options.viewport);
    const contextKey = currentKey.value;
    if (
      !vp ||
      !contextKey ||
      pending.screenId !== resolve(options.screenId) ||
      pending.stateId !== resolve(options.stateId) ||
      pending.viewport !== vp
    ) {
      return;
    }
    const identity = operation.beginOperation(contextKey);
    if (!identity) {
      return;
    }
    awaitingManifest.value = true;
    statusMessage.value = '収集結果を反映しています…';
    await waitForPending(pending, identity);
  }

  async function waitForPending(
    pending: PendingDeviceCapture,
    identity: PanelWorkIdentity,
  ): Promise<void> {
    stopWait();
    waitAbort = new AbortController();
    const ok = await waitForDeviceCaptureRevision({
      screenDataUrl: options.screenDataUrl(pending.screenId),
      stateId: pending.stateId,
      viewport: pending.viewport,
      expectedImageRevision: pending.expectedImageRevision,
      signal: waitAbort.signal,
      fetchFn: options.fetchFn,
    });
    if (!operation.isActiveWork(identity)) {
      return;
    }
    if (!ok) {
      statusMessage.value = '';
      if (operation.finishWork(identity)) {
        setRuntimeIdle();
      }
      return;
    }
    clearPendingDeviceCapture(resolve(options.projectName));
    awaitingManifest.value = true;
    await completeAfterServerSuccess(identity, 'Device Previewを更新しました。');
  }

  async function collectCurrent(): Promise<void> {
    if (!resolve(options.editable)) {
      return;
    }
    const contextKey = currentKey.value;
    if (!contextKey) {
      return;
    }
    const vp = resolve(options.viewport);
    if (!vp) {
      return;
    }
    const scr = resolve(options.screen);
    if (!scr?.hasImplementation || !resolve(options.stateId)) {
      return;
    }
    if (operation.hasActiveWork()) {
      return;
    }

    const identity = operation.beginOperation(contextKey);
    if (!identity) {
      return;
    }

    clearUiMessages();
    statusMessage.value = '収集中…';
    runtime.value = { status: 'collecting' };

    const result = await postDeviceCaptureCollect({
      screenId: resolve(options.screenId),
      stateId: resolve(options.stateId),
      viewport: vp,
      fetchFn: options.fetchFn,
    });

    if (!operation.isActiveWork(identity)) {
      return;
    }

    if (!result.ok) {
      statusMessage.value = '';

      if (result.error.code === 'SPEC_DEVICE_CAPTURE_IN_PROGRESS') {
        statusMessage.value = '同じDevice Previewを収集中です。';
        if (operation.finishWork(identity)) {
          setRuntimeIdle();
        }
        await refreshStatus();
        return;
      }
      if (result.error.code === 'SPEC_DEVICE_CAPTURE_INPUT_CHANGED') {
        errorMessage.value =
          '収集中に画面またはリソースが変更されました。最新の状態で再度収集してください。';
        await refreshStatus();
        await reconcileWithinOperation(identity);
        return;
      }
      if (result.error.status === 404) {
        errorMessage.value = result.error.message;
        await reconcileWithinOperation(identity);
        return;
      }
      errorMessage.value = result.error.message;
      runtime.value = {
        status: 'failed',
        error: { code: result.error.code, message: result.error.message },
      };
      operation.finishWork(identity);
      return;
    }

    if (result.data.result === 'unchanged') {
      clearPendingDeviceCapture(resolve(options.projectName));
      statusMessage.value = '';
      infoMessage.value = 'Device Previewは最新です。';
      if (operation.finishWork(identity)) {
        setRuntimeIdle();
      }
      return;
    }

    const imageRevision = result.data.capture.imageRevision;
    if (!imageRevision) {
      errorMessage.value = '収集結果の revision を取得できませんでした。';
      if (operation.finishWork(identity)) {
        setRuntimeIdle();
      }
      return;
    }

    const pending: PendingDeviceCapture = {
      screenId: result.data.screenId,
      stateId: result.data.stateId,
      viewport: result.data.viewport,
      expectedImageRevision: imageRevision,
      expectedInputRevision: result.data.capture.inputRevision,
    };
    setPendingDeviceCapture(resolve(options.projectName), pending);
    awaitingManifest.value = true;
    statusMessage.value = '収集結果を反映しています…';
    await waitForPending(pending, identity);
  }

  watch(
    currentKey,
    () => {
      stopPolling();
      stopWait();
      operation.invalidateAllWork();
      clearUiMessages();
      runtime.value = { status: 'idle' };
      if (resolve(options.viewport) && resolve(options.editable)) {
        void refreshStatus().then(() => resumePendingIfNeeded());
      }
    },
    { immediate: true },
  );

  onUnmounted(() => {
    disposed = true;
    stopPolling();
    stopWait();
    operation.invalidateAllWork();
  });

  return {
    runtime,
    persistedCapture,
    localPending,
    awaitingManifest,
    reloadPending,
    isCollecting,
    statusMessage,
    errorMessage,
    infoMessage,
    refreshStatus,
    collectCurrent,
    resumePendingIfNeeded,
    stopPolling,
  };
}
