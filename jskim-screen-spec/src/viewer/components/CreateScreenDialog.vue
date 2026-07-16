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
import type { ViewerManifest } from '../types';

const emit = defineEmits<{
  close: [];
}>();

const manifest = inject<ComputedRef<ViewerManifest>>('manifest');
const bootstrap = getSpecEditBootstrap();
const router = useRouter();

const titleId = 'create-screen-dialog-title';

const screenId = ref('');
const name = ref('');
const description = ref('');
const fieldErrors = ref<CreateScreenFieldErrors>({});
const serverError = ref('');
const saving = ref(false);
const waitingMessage = ref('');
const screenIdInputRef = ref<HTMLInputElement | null>(null);

const dirty = computed(
  () =>
    screenId.value.trim() !== '' ||
    name.value.trim() !== '' ||
    description.value.trim() !== '',
);

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

  const input = {
    screenId: screenId.value.trim(),
    name: name.value.trim(),
    description: description.value,
  };
  const errors = validateCreateScreenInput(input);
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
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      serverError.value = err?.message || '画面の作成に失敗しました。';
      return;
    }

    const createdId = input.screenId;
    setPendingScreen(createdId);
    waitingMessage.value = '画面を作成しました。反映を待っています…';

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
      err instanceof Error ? err.message : '画面の作成に失敗しました。';
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown);
  void nextTick(() => {
    screenIdInputRef.value?.focus();
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
    >
      <h2 :id="titleId" class="create-screen-dialog__title">画面を作成</h2>

      <form class="create-screen-dialog__form" @submit.prevent="onSubmit">
        <label class="spec-field">
          <span>画面 ID</span>
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
            data-error="screenId"
            >{{ fieldError('screenId') }}</span
          >
        </label>

        <label class="spec-field">
          <span>画面名</span>
          <input
            v-model="name"
            type="text"
            data-field="name"
            :disabled="saving"
          />
          <span
            v-if="fieldError('name')"
            class="spec-field__error"
            data-error="name"
            >{{ fieldError('name') }}</span
          >
        </label>

        <label class="spec-field">
          <span>画面説明</span>
          <textarea
            v-model="description"
            rows="4"
            data-field="description"
            :disabled="saving"
          />
          <span
            v-if="fieldError('description')"
            class="spec-field__error"
            data-error="description"
            >{{ fieldError('description') }}</span
          >
        </label>

        <p class="spec-field__hint">
          画面IDは作成後に変更できません。英数字とハイフンなど、許可された形式で入力してください。
        </p>

        <p
          v-if="serverError"
          class="create-screen-dialog__server-error"
          data-error="server"
        >
          {{ serverError }}
        </p>
        <p
          v-if="waitingMessage"
          class="create-screen-dialog__waiting"
          data-status="waiting"
        >
          {{ waitingMessage }}
        </p>

        <div class="create-screen-dialog__actions">
          <button
            type="button"
            class="spec-page__btn spec-page__btn--secondary"
            :disabled="saving"
            @click="requestClose"
          >
            キャンセル
          </button>
          <button type="submit" class="spec-page__btn" :disabled="saving">
            {{ saving ? '作成中…' : '作成' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
