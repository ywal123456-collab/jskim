<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import {
  countDirectChildGroups,
  countDirectChildItems,
  type UngroupChildRef,
} from '../editing/group-ungroup-helpers.js';

const props = defineProps<{
  groupId: string;
  groupName: string;
  parentGroupId: string | null;
  parentGroupName: string | null;
  directChildren: UngroupChildRef[];
  pending?: boolean;
  submitDisabled?: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

const titleId = 'group-ungroup-dialog-title';

const placementLabel = computed(() => {
  if (props.parentGroupId == null) {
    return 'ルート';
  }
  const name = props.parentGroupName?.trim();
  if (name) {
    return `${name}（${props.parentGroupId}）`;
  }
  return props.parentGroupId;
});

const currentLocationLabel = computed(() => {
  if (props.parentGroupId == null) {
    return 'ルート直下';
  }
  const name = props.parentGroupName?.trim();
  if (name) {
    return `${name} の配下`;
  }
  return `${props.parentGroupId} の配下`;
});

const isEmpty = computed(() => props.directChildren.length === 0);

const directGroupCount = computed(() =>
  countDirectChildGroups(props.directChildren),
);

const directItemCount = computed(() =>
  countDirectChildItems(props.directChildren),
);

const displayName = computed(
  () => props.groupName.trim() || props.groupId,
);

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

function onConfirm(): void {
  if (props.pending || props.submitDisabled) {
    return;
  }
  emit('confirm');
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown);
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
      data-testid="group-ungroup-dialog"
    >
      <h2 :id="titleId" class="create-screen-dialog__title">グループを解除</h2>

      <div class="create-screen-dialog__form">
        <p class="spec-field__hint">
          グループ名: {{ displayName }}
        </p>
        <p class="spec-field__hint">
          グループ ID: <code>{{ groupId }}</code>
        </p>
        <p class="spec-field__hint" data-testid="group-ungroup-current-location">
          現在の位置: {{ currentLocationLabel }}
        </p>
        <p class="spec-field__hint" data-testid="group-ungroup-promote-to">
          昇格先: {{ placementLabel }}
        </p>
        <p class="spec-field__hint" data-testid="group-ungroup-child-counts">
          直下の子: グループ {{ directGroupCount }} / 項目 {{ directItemCount }}
        </p>

        <p
          v-if="isEmpty"
          class="group-ungroup-dialog__message"
          data-testid="group-ungroup-empty-message"
        >
          このグループは空です。グループだけが削除されます。
        </p>
        <p
          v-else
          class="group-ungroup-dialog__message"
          data-testid="group-ungroup-promote-message"
        >
          グループ「{{ displayName }}」だけを解除し、配下のグループと項目を現在の上位階層へ移動します。配下の内容は削除されません。
        </p>

        <p
          v-if="errorMessage"
          class="spec-field__error"
          data-testid="group-ungroup-error"
          role="alert"
        >
          {{ errorMessage }}
        </p>

        <div class="create-screen-dialog__actions">
          <button
            type="button"
            class="spec-page__btn spec-page__btn--secondary"
            :disabled="pending"
            data-testid="group-ungroup-cancel"
            @click="requestClose"
          >
            キャンセル
          </button>
          <button
            type="button"
            class="spec-page__btn"
            data-testid="group-ungroup-confirm"
            :disabled="pending || submitDisabled"
            @click="onConfirm"
          >
            {{ pending ? '解除中…' : '解除する' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.group-ungroup-dialog__message {
  margin: 0.75rem 0;
  line-height: 1.5;
  white-space: pre-wrap;
}
</style>
