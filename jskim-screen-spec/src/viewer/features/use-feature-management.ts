import { getCurrentInstance, onBeforeUnmount, ref, shallowRef } from 'vue';
import { createFeatureClient } from './feature-client.js';
import {
  getSpecFeatureBootstrap,
  type ApiFeature,
  type FeatureWorkingResponse,
} from './types.js';

export function useFeatureManagement() {
  const bootstrap = getSpecFeatureBootstrap();
  const available = Boolean(bootstrap);
  const open = ref(false);
  const loading = ref(false);
  const saving = ref(false);
  const errorMessage = ref('');
  const conflictMessage = ref('');
  const revision = ref<string | null>(null);
  const features = shallowRef<ApiFeature[]>([]);
  const ungroupedScreenIds = shallowRef<string[]>([]);

  let requestSeq = 0;
  let abort: AbortController | null = null;

  function client() {
    const boot = getSpecFeatureBootstrap();
    if (!boot) {
      throw new Error('Feature editing bootstrap がありません。');
    }
    return createFeatureClient(boot);
  }

  function abortInflight(): void {
    abort?.abort();
    abort = null;
  }

  function applyState(state: FeatureWorkingResponse): void {
    revision.value = state.revision;
    features.value = state.features;
    ungroupedScreenIds.value = state.ungroupedScreenIds;
  }

  async function reload(): Promise<boolean> {
    if (!available) return false;
    abortInflight();
    abort = new AbortController();
    const seq = ++requestSeq;
    loading.value = true;
    errorMessage.value = '';
    conflictMessage.value = '';
    const result = await client().getWorkingState(abort.signal);
    if (seq !== requestSeq) return false;
    loading.value = false;
    if (!result.ok) {
      if (!result.aborted) {
        errorMessage.value = result.error.message;
      }
      return false;
    }
    applyState(result.data);
    return true;
  }

  async function openDialog(): Promise<void> {
    if (!available) return;
    open.value = true;
    await reload();
  }

  function closeDialog(): void {
    if (saving.value) return;
    open.value = false;
    abortInflight();
  }

  async function runMutation(
    action: (
      expectedRevision: string | null,
      signal: AbortSignal,
    ) => Promise<
      | { ok: true; data: FeatureWorkingResponse & { status?: string } }
      | { ok: false; error: { code: string; message: string }; aborted?: boolean }
    >,
  ): Promise<boolean> {
    if (!available || saving.value) return false;
    saving.value = true;
    errorMessage.value = '';
    conflictMessage.value = '';
    abortInflight();
    abort = new AbortController();
    const seq = ++requestSeq;
    const expected = revision.value;
    const result = await action(expected, abort.signal);
    if (seq !== requestSeq) {
      saving.value = false;
      return false;
    }
    saving.value = false;
    if (!result.ok) {
      if (result.aborted) return false;
      if (result.error.code === 'SPEC_FEATURE_REVISION_CONFLICT') {
        conflictMessage.value =
          '他の操作によって機能構成が更新されました。\n最新状態を再読み込みしてください。';
      } else {
        errorMessage.value = result.error.message;
      }
      return false;
    }
    applyState(result.data);
    return true;
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      abortInflight();
    });
  }

  return {
    available,
    open,
    loading,
    saving,
    errorMessage,
    conflictMessage,
    revision,
    features,
    ungroupedScreenIds,
    openDialog,
    closeDialog,
    reload,
    runMutation,
    client,
  };
}

export type FeatureManagementHandle = ReturnType<typeof useFeatureManagement>;
