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
import {
  clearPendingDeviceCapture,
  peekPendingDeviceCapture,
  setPendingDeviceCapture,
  type PendingDeviceCapture,
} from './pending-device-capture.js';
import type { DeviceCaptureViewport } from './preview-provider.js';

const POLL_INTERVAL_MS = 800;

export type UseDeviceCapturePanelOptions = {
  projectName: ComputedRef<string> | Ref<string> | (() => string);
  screenId: ComputedRef<string> | Ref<string> | (() => string);
  stateId: ComputedRef<string> | Ref<string> | (() => string);
  viewport: ComputedRef<DeviceCaptureViewport | null> | Ref<DeviceCaptureViewport | null> | (() => DeviceCaptureViewport | null);
  screen: ComputedRef<ScreenData | null> | Ref<ScreenData | null> | (() => ScreenData | null);
  editable: ComputedRef<boolean> | Ref<boolean> | (() => boolean);
  /** screen JSON 再読込（manifest revision 反映後） */
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

export function useDeviceCapturePanel(options: UseDeviceCapturePanelOptions) {
  const runtime = ref<DeviceCaptureRuntimeState>({ status: 'idle' });
  const localPending = ref(false);
  const awaitingManifest = ref(false);
  const statusMessage = ref('');
  const errorMessage = ref('');
  const infoMessage = ref('');
  /** 進行中リクエストの key（stale response 無視用） */
  const activeRequestKey = ref<string | null>(null);

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
      localPending.value ||
      awaitingManifest.value ||
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
    runtime.value = result.data.runtime;
    if (result.data.runtime.status === 'collecting') {
      startPolling();
    } else {
      stopPolling();
      if (result.data.runtime.status === 'failed') {
        const msg =
          result.data.runtime.error?.message ||
          '前回の収集に失敗しました。';
        errorMessage.value = msg;
      }
    }
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
        if (runtime.value.status === 'idle' && !localPending.value) {
          stopPolling();
          // collecting 完了後に manifest を取り直す
          await options.reloadScreen();
        }
      });
    }, interval);
  }

  async function resumePendingIfNeeded(): Promise<void> {
    if (!resolve(options.editable)) {
      return;
    }
    const pending = peekPendingDeviceCapture(resolve(options.projectName));
    if (!pending) {
      return;
    }
    const vp = resolve(options.viewport);
    if (
      !vp ||
      pending.screenId !== resolve(options.screenId) ||
      pending.stateId !== resolve(options.stateId) ||
      pending.viewport !== vp
    ) {
      return;
    }
    awaitingManifest.value = true;
    statusMessage.value = '収集結果を反映しています…';
    await waitForPending(pending);
  }

  async function waitForPending(pending: PendingDeviceCapture): Promise<void> {
    stopWait();
    waitAbort = new AbortController();
    const keyAtStart = captureKeyOf(pending);
    const ok = await waitForDeviceCaptureRevision({
      screenDataUrl: options.screenDataUrl(pending.screenId),
      stateId: pending.stateId,
      viewport: pending.viewport,
      expectedImageRevision: pending.expectedImageRevision,
      signal: waitAbort.signal,
      fetchFn: options.fetchFn,
    });
    if (disposed || currentKey.value !== keyAtStart) {
      return;
    }
    if (ok) {
      clearPendingDeviceCapture(resolve(options.projectName));
      awaitingManifest.value = false;
      localPending.value = false;
      activeRequestKey.value = null;
      statusMessage.value = '';
      infoMessage.value = 'Device Previewを更新しました。';
      errorMessage.value = '';
      await options.reloadScreen();
      runtime.value = { status: 'idle' };
    }
  }

  function captureKeyOf(p: {
    screenId: string;
    stateId: string;
    viewport: DeviceCaptureViewport;
  }): string {
    return `${p.screenId}\0${p.stateId}\0${p.viewport}`;
  }

  async function collectCurrent(): Promise<void> {
    if (!resolve(options.editable) || isCollecting.value) {
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

    clearUiMessages();
    const reqKey = `${resolve(options.screenId)}\0${resolve(options.stateId)}\0${vp}`;
    activeRequestKey.value = reqKey;
    localPending.value = true;
    statusMessage.value = '収集中…';
    runtime.value = { status: 'collecting' };

    const result = await postDeviceCaptureCollect({
      screenId: resolve(options.screenId),
      stateId: resolve(options.stateId),
      viewport: vp,
      fetchFn: options.fetchFn,
    });

    if (disposed || activeRequestKey.value !== reqKey) {
      // stale response — 進行中 UI は触らない（別キーへ移っている）
      return;
    }

    if (!result.ok) {
      localPending.value = false;
      activeRequestKey.value = null;
      statusMessage.value = '';

      if (result.error.code === 'SPEC_DEVICE_CAPTURE_IN_PROGRESS') {
        statusMessage.value = '同じDevice Previewを収集中です。';
        await refreshStatus();
        return;
      }
      if (result.error.code === 'SPEC_DEVICE_CAPTURE_INPUT_CHANGED') {
        errorMessage.value =
          '収集中に画面またはリソースが変更されました。最新の状態で再度収集してください。';
        runtime.value = { status: 'idle' };
        await refreshStatus();
        await options.reloadScreen();
        return;
      }
      if (result.error.status === 404) {
        errorMessage.value = result.error.message;
        runtime.value = { status: 'idle' };
        await options.reloadScreen();
        return;
      }
      errorMessage.value = result.error.message;
      runtime.value = {
        status: 'failed',
        error: { code: result.error.code, message: result.error.message },
      };
      return;
    }

    if (result.data.result === 'unchanged') {
      localPending.value = false;
      activeRequestKey.value = null;
      awaitingManifest.value = false;
      clearPendingDeviceCapture(resolve(options.projectName));
      statusMessage.value = '';
      infoMessage.value = 'Device Previewは最新です。';
      runtime.value = { status: 'idle' };
      return;
    }

    // created / updated — watcher reload を待つ
    const imageRevision = result.data.capture.imageRevision;
    if (!imageRevision) {
      localPending.value = false;
      activeRequestKey.value = null;
      errorMessage.value = '収集結果の revision を取得できませんでした。';
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
    await waitForPending(pending);
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
  });

  return {
    runtime,
    persistedCapture,
    localPending,
    awaitingManifest,
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
