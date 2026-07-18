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
  hasCreateScreenErrors,
  validateCreateScreenInput,
  type CreateScreenFieldErrors,
} from '../editing/create-screen-validation';
import {
  clearPendingScreen,
  setPendingScreen,
  waitForScreenInManifest,
} from '../editing/pending-screen';
import {
  suggestCopyScreenId,
  suggestCopyScreenName,
} from '../editing/suggest-copy-screen-id';
import type { ViewerManifest } from '../types';

const props = defineProps<{
  copyFromScreenId: string;
  sourceName: string;
  sourceDescription: string;
  /** 親が dirty のときは submit を拒否する */
  sourceDirty: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const manifest = inject<ComputedRef<ViewerManifest>>('manifest');
const bootstrap = getSpecEditBootstrap();
const router = useRouter();

const titleId = 'duplicate-screen-dialog-title';
const descId = 'duplicate-screen-dialog-desc';

const screenId = ref('');
const name = ref('');
const description = ref('');
const fieldErrors = ref<CreateScreenFieldErrors>({});
const serverError = ref('');
const saving = ref(false);
const waitingMessage = ref('');
const screenIdInputRef = ref<HTMLInputElement | null>(null);

const dirty = computed(() => true);

function fieldError(field: keyof CreateScreenFieldErrors): string {
  return fieldErrors.value[field] || '';
}

function requestClose(): void {
  if (saving.value) {
    return;
  }
  if (dirty.value) {
    const ok = window.confirm(
      '入力内容が保存されていません。このダイアログを閉じますか？',
    );
    if (!ok) {
      return;
    }
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

async function onSubmit(): Promise<void> {
  if (saving.value) {
    return;
  }
  serverError.value = '';
  waitingMessage.value = '';

  if (props.sourceDirty) {
    serverError.value =
      '画面を複製する前に、編集中の変更を保存してください。';
    return;
  }

  const input = {
    screenId: screenId.value.trim(),
    name: name.value.trim(),
    description: description.value,
  };
  const errors = validateCreateScreenInput(input);
  if (input.screenId === props.copyFromScreenId) {
    errors.screenId =
      '複製先の画面IDには、複製元と異なるIDを指定してください。';
  }
  fieldErrors.value = errors;
  if (hasCreateScreenErrors(errors)) {
    return;
  }

  if (!bootstrap) {
    serverError.value = '編集 API が利用できません。';
    return;
  }

  saving.value = true;
  try {
    const res = await fetch(bootstrap.apiBase, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...input,
        copyFromScreenId: props.copyFromScreenId,
      }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      serverError.value = err?.message || '画面の複製に失敗しました。';
      return;
    }

    const createdId = input.screenId;
    setPendingScreen(createdId);
    waitingMessage.value = '画面を複製しました。反映を待っています…';

    const base = manifest?.value.base ?? '/spec/';
    const found = await waitForScreenInManifest(createdId, {
      manifestUrl: `${base}data/manifest.json`,
    });

    if (found) {
      clearPendingScreen();
      await router.push(`/screens/${createdId}`);
    }
    emit('close');
  } catch (err) {
    serverError.value =
      err instanceof Error ? err.message : '画面の複製に失敗しました。';
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  const existingIds = (manifest?.value.screens || []).map((s) => s.id);
  screenId.value = suggestCopyScreenId(props.copyFromScreenId, existingIds);
  name.value = suggestCopyScreenName(props.sourceName);
  description.value = props.sourceDescription;
  window.addEventListener('keydown', onWindowKeydown);
  void nextTick(() => {
    screenIdInputRef.value?.focus();
    screenIdInputRef.value?.select();
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
      <h2 :id="titleId" class="create-screen-dialog__title">画面を複製</h2>

      <form class="create-screen-dialog__form" @submit.prevent="onSubmit">
        <div :id="descId" class="spec-field__hint">
          <p>画面IDは作成後に変更できません。</p>
          <p>
            画面項目と並び順を複製します。実装画面やPreview、除外項目は複製されません。
          </p>
          <p>
            複製元: <code>{{ copyFromScreenId }}</code>
          </p>
        </div>

        <label class="spec-field">
          <span>新しい画面ID</span>
          <input
            ref="screenIdInputRef"
            v-model="screenId"
            type="text"
            data-field="screen-id"
            autocomplete="off"
            :disabled="saving"
          />
          <span
            v-if="fieldError('screenId')"
            class="spec-field__error"
            role="alert"
            >{{ fieldError('screenId') }}</span
          >
        </label>

        <label class="spec-field">
          <span>画面名</span>
          <input
            v-model="name"
            type="text"
            data-field="screen-name"
            autocomplete="off"
            :disabled="saving"
          />
          <span
            v-if="fieldError('name')"
            class="spec-field__error"
            role="alert"
            >{{ fieldError('name') }}</span
          >
        </label>

        <label class="spec-field">
          <span>画面説明</span>
          <textarea
            v-model="description"
            rows="4"
            data-field="screen-description"
            :disabled="saving"
          />
          <span
            v-if="fieldError('description')"
            class="spec-field__error"
            role="alert"
            >{{ fieldError('description') }}</span
          >
        </label>

        <p v-if="serverError" class="spec-field__error" role="alert">
          {{ serverError }}
        </p>
        <p v-if="waitingMessage" class="spec-field__hint">{{ waitingMessage }}</p>

        <div class="create-screen-dialog__actions">
          <button
            type="button"
            class="spec-page__btn spec-page__btn--secondary"
            :disabled="saving"
            @click="requestClose"
          >
            キャンセル
          </button>
          <button
            type="submit"
            class="spec-page__btn"
            data-action="confirm-duplicate-screen"
            :disabled="saving || sourceDirty"
          >
            複製
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
