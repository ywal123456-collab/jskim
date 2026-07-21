<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  hasCreateItemErrors,
  toCreateItemPayload,
  validateCreateItemInput,
  type CreateItemFieldErrors,
  type CreateItemPayload,
} from '../editing/create-item-validation';
import { suggestCopyItemId } from '../editing/suggest-copy-item-id';

const props = defineProps<{
  existingItemIds: string[];
  sourceItemId: string;
  initialName: string;
  initialType: string;
  initialDescription: string;
  initialNote: string;
  pending?: boolean;
  submitDisabled?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  create: [payload: CreateItemPayload & { sourceItemId: string }];
}>();

const titleId = 'duplicate-item-dialog-title';

const itemId = ref(suggestCopyItemId(props.sourceItemId, props.existingItemIds));
const name = ref(props.initialName);
const type = ref(props.initialType);
const description = ref(props.initialDescription);
const note = ref(props.initialNote);
const fieldErrors = ref<CreateItemFieldErrors>({});
const itemIdInputRef = ref<HTMLInputElement | null>(null);

const dirty = computed(() => true);

function fieldError(field: keyof CreateItemFieldErrors): string {
  return fieldErrors.value[field] || '';
}

function requestClose(): void {
  if (props.pending) {
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
  if (props.pending) {
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    requestClose();
  }
}

function onSubmit(): void {
  if (props.pending || props.submitDisabled) {
    return;
  }
  const input = {
    itemId: itemId.value,
    name: name.value,
    type: type.value,
    description: description.value,
    note: note.value,
    existingItemIds: props.existingItemIds,
  };
  const errors = validateCreateItemInput(input);
  fieldErrors.value = errors;
  if (hasCreateItemErrors(errors)) {
    return;
  }
  emit('create', {
    sourceItemId: props.sourceItemId,
    ...toCreateItemPayload(input),
  });
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown);
  void nextTick(() => {
    itemIdInputRef.value?.focus();
    itemIdInputRef.value?.select();
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
      <h2 :id="titleId" class="create-screen-dialog__title">項目を複製</h2>

      <form class="create-screen-dialog__form" @submit.prevent="onSubmit">
        <label class="spec-field">
          <span>新しい項目 ID</span>
          <input
            ref="itemIdInputRef"
            v-model="itemId"
            type="text"
            data-field="item-id"
            autocomplete="off"
          />
          <span
            v-if="fieldError('itemId')"
            class="spec-field__error"
            data-error="itemId"
            >{{ fieldError('itemId') }}</span
          >
        </label>

        <p class="spec-field__hint">
          複製した項目は実装画面とは連携されません。実装時に同じ項目IDを指定すると連携できます。
        </p>

        <label class="spec-field">
          <span>項目名</span>
          <input
            v-model="name"
            type="text"
            data-field="item-name"
            autocomplete="off"
          />
          <span
            v-if="fieldError('name')"
            class="spec-field__error"
            data-error="name"
            >{{ fieldError('name') }}</span
          >
        </label>

        <label class="spec-field">
          <span>種類</span>
          <input
            v-model="type"
            type="text"
            data-field="item-type"
            autocomplete="off"
          />
          <span
            v-if="fieldError('type')"
            class="spec-field__error"
            data-error="type"
            >{{ fieldError('type') }}</span
          >
        </label>

        <label class="spec-field">
          <span>説明</span>
          <textarea
            v-model="description"
            data-field="item-description"
            rows="3"
          />
          <span
            v-if="fieldError('description')"
            class="spec-field__error"
            data-error="description"
            >{{ fieldError('description') }}</span
          >
        </label>

        <label class="spec-field">
          <span>備考</span>
          <textarea v-model="note" data-field="item-note" rows="2" />
          <span
            v-if="fieldError('note')"
            class="spec-field__error"
            data-error="note"
            >{{ fieldError('note') }}</span
          >
        </label>

        <div class="create-screen-dialog__actions">
          <button
            type="button"
            class="spec-page__btn spec-page__btn--secondary"
            :disabled="pending"
            @click="requestClose"
          >
            キャンセル
          </button>
          <button
            type="submit"
            class="spec-page__btn"
            :disabled="pending || submitDisabled"
          >
            複製
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
