<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  type ComputedRef,
} from 'vue';
import { useRouter } from 'vue-router';
import { getSpecEditBootstrap } from '../editing/types';
import {
  clearPendingDeleteFallback,
  clearPendingScreen,
  peekPendingScreen,
  setPendingDeleteFallback,
  waitForScreenAbsentFromManifest,
  waitForScreenStatusInManifest,
} from '../editing/pending-screen';
import {
  resolveDeleteScreenFallback,
  resolveFallbackAgainstCurrentScreens,
  type DeleteScreenFallback,
} from '../editing/resolve-delete-screen-fallback';
import type { ViewerManifest } from '../types';

const props = defineProps<{
  screenId: string;
  screenName: string;
  /** design-only | linked（削除結果の説明に使う） */
  status: 'design-only' | 'linked';
  /** 親の dirty。true のとき submit 拒否 */
  sourceDirty: boolean;
  /** 親の保存中 */
  sourceSaving: boolean;
  /** loaded Description revision（draft / manifest から推測しない） */
  expectedRevision: string | null;
}>();

const emit = defineEmits<{
  close: [];
  /** LINKED 削除後に親が loadScreen し直す */
  completed: [payload: { kind: 'design-only' | 'linked' }];
  /** 409 等で最新の再読込を促す */
  reloadLatest: [];
}>();

const manifest = inject<ComputedRef<ViewerManifest>>('manifest');
const bootstrap = getSpecEditBootstrap();
const router = useRouter();

const titleId = 'delete-screen-dialog-title';
const descId = 'delete-screen-dialog-desc';

const serverError = ref('');
const waitingMessage = ref('');
const deleting = ref(false);
const showReloadAction = ref(false);
const cancelButtonRef = ref<HTMLButtonElement | null>(null);

const isDesignOnly = computed(() => props.status === 'design-only');
const isLinked = computed(() => props.status === 'linked');

const titleText = computed(() =>
  isLinked.value
    ? '画面設計書のみ削除しますか？'
    : '画面設計を削除しますか？',
);

const confirmLabel = computed(() =>
  isLinked.value ? '画面設計書を削除' : '削除',
);

const submitBlockedReason = computed(() => {
  if (props.sourceDirty) {
    return '画面設計を削除する前に、編集中の変更を保存またはキャンセルしてください。';
  }
  if (props.sourceSaving) {
    return '保存が完了するまで画面設計を削除できません。';
  }
  if (!props.expectedRevision) {
    return '画面設計書の revision を取得できていません。再読み込みしてください。';
  }
  return '';
});

const confirmDisabled = computed(
  () =>
    deleting.value ||
    props.sourceDirty ||
    props.sourceSaving ||
    !props.expectedRevision,
);

function requestClose(): void {
  if (deleting.value) {
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

function clearCreatePendingIfSame(): void {
  if (peekPendingScreen() === props.screenId) {
    clearPendingScreen();
  }
}

async function fetchLatestScreenIds(manifestUrl: string): Promise<string[]> {
  const res = await fetch(`${manifestUrl}?_t=${Date.now()}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    return [];
  }
  const data = (await res.json()) as {
    screens?: Array<{ id: string }>;
  };
  return (data.screens || []).map((s) => s.id);
}

async function navigateDesignOnlyFallback(
  preferred: DeleteScreenFallback,
  manifestUrl: string,
): Promise<void> {
  const remaining = await fetchLatestScreenIds(manifestUrl);
  const resolved = resolveFallbackAgainstCurrentScreens(remaining, preferred);
  clearPendingDeleteFallback();
  if (resolved.kind === 'empty') {
    await router.push('/screens/_empty');
  } else {
    await router.push(`/screens/${resolved.screenId}`);
  }
}

async function onSubmit(): Promise<void> {
  if (deleting.value) {
    return;
  }
  serverError.value = '';
  waitingMessage.value = '';
  showReloadAction.value = false;

  if (props.sourceDirty) {
    serverError.value =
      '画面設計を削除する前に、編集中の変更を保存またはキャンセルしてください。';
    return;
  }
  if (props.sourceSaving) {
    serverError.value = '保存が完了するまで画面設計を削除できません。';
    return;
  }
  if (!props.expectedRevision) {
    serverError.value =
      '画面設計書の revision を取得できていません。再読み込みしてください。';
    return;
  }
  if (!bootstrap) {
    serverError.value = '編集 API が利用できません。';
    return;
  }

  const orderedIds = (manifest?.value.screens || []).map((s) => s.id);
  const preferred = resolveDeleteScreenFallback(orderedIds, props.screenId);
  const fallbackScreenId =
    preferred.kind === 'empty' ? '_empty' : preferred.screenId;

  deleting.value = true;
  waitingMessage.value = '削除中…';

  try {
    clearCreatePendingIfSame();

    if (isDesignOnly.value) {
      setPendingDeleteFallback({
        removedScreenId: props.screenId,
        fallbackScreenId,
      });
    }

    const url = `${bootstrap.apiBase}/${encodeURIComponent(props.screenId)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedRevision: props.expectedRevision,
      }),
    });

    if (res.status === 409) {
      clearPendingDeleteFallback();
      const err = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      serverError.value =
        err?.message ||
        '画面設計書が別の処理で更新されています。最新の内容を読み込み直してください。';
      showReloadAction.value = true;
      waitingMessage.value = '';
      return;
    }

    if (res.status === 404) {
      clearPendingDeleteFallback();
      const err = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      serverError.value =
        err?.message ||
        '画面設計書が見つかりません。最新の内容を読み込み直してください。';
      showReloadAction.value = true;
      waitingMessage.value = '';
      return;
    }

    if (!res.ok) {
      clearPendingDeleteFallback();
      const err = (await res.json().catch(() => null)) as {
        message?: string;
        code?: string;
      } | null;
      serverError.value =
        err?.message || '画面設計書の削除に失敗しました。';
      waitingMessage.value = '';
      return;
    }

    const base = manifest?.value.base ?? '/spec/';
    const manifestUrl = `${base}data/manifest.json`;

    if (isDesignOnly.value) {
      const absent = await waitForScreenAbsentFromManifest(props.screenId, {
        manifestUrl,
      });
      if (!absent) {
        clearPendingDeleteFallback();
        serverError.value =
          '画面一覧の更新を確認できませんでした。ページを再読み込みしてください。';
        waitingMessage.value = '';
        return;
      }
      await navigateDesignOnlyFallback(preferred, manifestUrl);
      emit('completed', { kind: 'design-only' });
      emit('close');
      return;
    }

    const statusReady = await waitForScreenStatusInManifest(props.screenId, {
      manifestUrl,
      status: 'implementation-only',
    });
    if (!statusReady) {
      serverError.value =
        '画面一覧の更新を確認できませんでした。ページを再読み込みしてください。';
      waitingMessage.value = '';
      return;
    }
    emit('completed', { kind: 'linked' });
    emit('close');
  } catch (err) {
    clearPendingDeleteFallback();
    serverError.value =
      err instanceof Error ? err.message : '画面設計書の削除に失敗しました。';
    waitingMessage.value = '';
  } finally {
    deleting.value = false;
  }
}

function onReloadLatest(): void {
  if (deleting.value) {
    return;
  }
  emit('reloadLatest');
  emit('close');
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown);
  void nextTick(() => {
    cancelButtonRef.value?.focus();
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown);
});
</script>

<template>
  <div class="create-screen-dialog-overlay" @click.self="onOverlayClick">
    <div
      class="create-screen-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="descId"
    >
      <h2 :id="titleId" class="create-screen-dialog__title">{{ titleText }}</h2>

      <div class="create-screen-dialog__form">
        <div :id="descId" class="spec-field__hint">
          <p>
            画面ID: <code>{{ screenId }}</code>
          </p>
          <p>画面名: {{ screenName || '（未設定）' }}</p>

          <template v-if="isDesignOnly">
            <p>
              この画面は実装画面と連携されていないため、削除後は画面一覧から消えます。
            </p>
            <p>画面設計書のJSONファイルが削除されます。</p>
            <p>この操作はViewerから元に戻せません。</p>
          </template>

          <template v-else>
            <p>画面設計書のJSONファイルのみ削除します。</p>
            <p>実装画面やソースファイル、Previewは削除されません。</p>
            <p>削除後、この画面は「実装のみ」として残ります。</p>
          </template>
        </div>

        <p
          v-if="submitBlockedReason && !serverError"
          class="spec-field__hint"
          role="status"
        >
          {{ submitBlockedReason }}
        </p>

        <p v-if="serverError" class="spec-field__error" role="alert">
          {{ serverError }}
        </p>
        <p v-if="waitingMessage" class="spec-field__hint" aria-live="polite">
          {{ waitingMessage }}
        </p>

        <div class="create-screen-dialog__actions">
          <button
            ref="cancelButtonRef"
            type="button"
            class="spec-page__btn spec-page__btn--secondary"
            :disabled="deleting"
            @click="requestClose"
          >
            キャンセル
          </button>
          <button
            v-if="showReloadAction"
            type="button"
            class="spec-page__btn"
            :disabled="deleting"
            data-action="reload-after-delete-conflict"
            @click="onReloadLatest"
          >
            最新内容を読み込む
          </button>
          <button
            type="button"
            class="spec-page__btn spec-page__btn--danger"
            data-action="confirm-delete-screen"
            :disabled="confirmDisabled"
            :aria-busy="deleting"
            :title="submitBlockedReason || confirmLabel"
            @click="onSubmit"
          >
            {{ deleting ? '削除中…' : confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
