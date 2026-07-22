<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { formatGroupKindLabel } from '../editing/description-tree-labels.js';
import {
  GROUP_EDIT_KINDS,
  groupEditPayloadEquals,
  hasGroupEditErrors,
  toGroupEditPayload,
  validateGroupEditDraft,
  type GroupEditDraft,
  type GroupEditFieldErrors,
  type GroupEditKind,
  type GroupEditPayload,
} from '../editing/group-edit-validation.js';

const props = defineProps<{
  groupId: string;
  generation: number;
  initialName: string;
  initialKind: string;
  initialDescription: string;
  pending?: boolean;
  submitDisabled?: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  close: [];
  save: [payload: GroupEditPayload];
}>();

const titleId = 'group-edit-dialog-title';
const nameInputRef = ref<HTMLInputElement | null>(null);

const name = ref('');
const kind = ref<GroupEditKind>('SECTION');
const description = ref('');
const fieldErrors = ref<GroupEditFieldErrors>({});

const kindOptions = GROUP_EDIT_KINDS.map((value) => ({
  value,
  label: formatGroupKindLabel(value),
}));

function resolveInitialKind(value: string): GroupEditKind {
  return (GROUP_EDIT_KINDS as readonly string[]).includes(value)
    ? (value as GroupEditKind)
    : 'SECTION';
}

function resetFromProps(): void {
  name.value = props.initialName;
  kind.value = resolveInitialKind(props.initialKind);
  description.value = props.initialDescription;
  fieldErrors.value = {};
}

const draft = computed<GroupEditDraft>(() => ({
  name: name.value,
  kind: kind.value,
  description: description.value,
}));

const isUnchanged = computed(() => {
  const payload = toGroupEditPayload(draft.value);
  return groupEditPayloadEquals(payload, {
    name: props.initialName,
    kind: props.initialKind,
    description: props.initialDescription,
  });
});

const saveDisabled = computed(
  () =>
    Boolean(props.pending) ||
    Boolean(props.submitDisabled) ||
    isUnchanged.value,
);

function fieldError(field: keyof GroupEditFieldErrors): string {
  return fieldErrors.value[field] || '';
}

function requestClose(): void {
  if (props.pending) {
    return;
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
  if (saveDisabled.value) {
    return;
  }
  const errors = validateGroupEditDraft(draft.value);
  fieldErrors.value = errors;
  if (hasGroupEditErrors(errors)) {
    return;
  }
  emit('save', toGroupEditPayload(draft.value));
}

watch(
  () => [props.groupId, props.generation] as const,
  () => {
    resetFromProps();
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown);
  void nextTick(() => {
    nameInputRef.value?.focus();
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
      data-testid="group-edit-dialog"
    >
      <h2 :id="titleId" class="create-screen-dialog__title">グループを編集</h2>

      <form class="create-screen-dialog__form" @submit.prevent="onSubmit">
        <div class="spec-field">
          <span id="group-edit-id-label">グループ ID</span>
          <p
            class="group-edit-dialog__readonly-id"
            data-field="group-id"
            aria-labelledby="group-edit-id-label"
          >
            {{ groupId }}
          </p>
        </div>

        <label class="spec-field">
          <span>名前</span>
          <input
            ref="nameInputRef"
            v-model="name"
            type="text"
            data-field="group-name"
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
          <select v-model="kind" data-field="group-kind">
            <option
              v-for="option in kindOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <span
            v-if="fieldError('kind')"
            class="spec-field__error"
            data-error="kind"
            >{{ fieldError('kind') }}</span
          >
        </label>

        <label class="spec-field">
          <span>説明</span>
          <textarea
            v-model="description"
            data-field="group-description"
            rows="3"
          />
          <span
            v-if="fieldError('description')"
            class="spec-field__error"
            data-error="description"
            >{{ fieldError('description') }}</span
          >
        </label>

        <p
          v-if="errorMessage"
          class="spec-field__error"
          data-testid="group-edit-error"
          role="alert"
        >
          {{ errorMessage }}
        </p>

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
            data-testid="group-edit-save"
            :disabled="saveDisabled"
          >
            {{ pending ? '保存中…' : '保存' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.group-edit-dialog__readonly-id {
  margin: 0;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--spec-border, #d0d7de);
  border-radius: 4px;
  background: var(--spec-muted-bg, #f6f8fa);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9rem;
  word-break: break-all;
}
</style>
