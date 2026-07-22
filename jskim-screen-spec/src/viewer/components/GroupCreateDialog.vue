<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { formatGroupKindLabel } from '../editing/description-tree-labels.js';
import {
  GROUP_EDIT_KINDS,
  hasGroupCreateErrors,
  toGroupCreatePayload,
  validateGroupCreateDraft,
  type GroupCreateFieldErrors,
  type GroupCreatePayload,
  type GroupEditKind,
} from '../editing/group-create-validation.js';

const props = defineProps<{
  mode: 'root' | 'child';
  generation: number;
  parentGroupId: string | null;
  parentGroupName: string | null;
  existingNodeIds: string[];
  parentDepth: number | null;
  parentActive: boolean;
  pending?: boolean;
  submitDisabled?: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  close: [];
  create: [payload: GroupCreatePayload];
}>();

const titleId = 'group-create-dialog-title';
const groupIdInputRef = ref<HTMLInputElement | null>(null);

const groupId = ref('');
const name = ref('');
const kind = ref<GroupEditKind>('SECTION');
const description = ref('');
const fieldErrors = ref<GroupCreateFieldErrors>({});

const kindOptions = GROUP_EDIT_KINDS.map((value) => ({
  value,
  label: formatGroupKindLabel(value),
}));

const dialogTitle = computed(() =>
  props.mode === 'root' ? 'グループを追加' : '子グループを追加',
);

const placementLabel = computed(() => {
  if (props.mode === 'root' || props.parentGroupId == null) {
    return 'ルート';
  }
  const parentName = props.parentGroupName?.trim();
  return parentName || props.parentGroupId;
});

const dirty = computed(
  () =>
    groupId.value.trim() !== '' ||
    name.value.trim() !== '' ||
    description.value !== '' ||
    kind.value !== 'SECTION',
);

function resetDraft(): void {
  groupId.value = '';
  name.value = '';
  kind.value = 'SECTION';
  description.value = '';
  fieldErrors.value = {};
}

function fieldError(field: keyof GroupCreateFieldErrors): string {
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
  const draft = {
    groupId: groupId.value,
    name: name.value,
    kind: kind.value,
    description: description.value,
  };
  const errors = validateGroupCreateDraft(draft, {
    existingNodeIds: props.existingNodeIds,
    parentGroupId: props.parentGroupId,
    parentDepth: props.parentDepth,
    parentActive: props.parentActive,
  });
  fieldErrors.value = errors;
  if (hasGroupCreateErrors(errors)) {
    return;
  }
  emit('create', toGroupCreatePayload(draft));
}

watch(
  () => [props.generation, props.mode, props.parentGroupId] as const,
  () => {
    resetDraft();
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown);
  void nextTick(() => {
    groupIdInputRef.value?.focus();
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
      data-testid="group-create-dialog"
    >
      <h2 :id="titleId" class="create-screen-dialog__title">{{ dialogTitle }}</h2>

      <p class="group-create-dialog__placement" data-testid="group-create-placement">
        追加先：{{ placementLabel }}
      </p>

      <form class="create-screen-dialog__form" @submit.prevent="onSubmit">
        <label class="spec-field">
          <span>グループ ID</span>
          <input
            ref="groupIdInputRef"
            v-model="groupId"
            type="text"
            data-field="group-id"
            autocomplete="off"
          />
          <span
            v-if="fieldError('groupId')"
            class="spec-field__error"
            data-error="groupId"
            >{{ fieldError('groupId') }}</span
          >
        </label>

        <p class="spec-field__hint">グループ ID は作成後に変更できません。</p>

        <label class="spec-field">
          <span>名前</span>
          <input
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
          v-if="fieldError('parent') || fieldError('depth')"
          class="spec-field__error"
          data-testid="group-create-context-error"
          role="alert"
        >
          {{ fieldError('parent') || fieldError('depth') }}
        </p>

        <p
          v-if="errorMessage"
          class="spec-field__error"
          data-testid="group-create-error"
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
            data-testid="group-create-submit"
            :disabled="pending || submitDisabled"
          >
            {{ pending ? '追加中…' : '追加' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.group-create-dialog__placement {
  margin: 0 0 0.75rem;
  color: var(--spec-muted, #57606a);
  font-size: 0.9rem;
}
</style>
