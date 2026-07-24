<script setup lang="ts">
import { computed } from 'vue';
import { formatGroupKindLabel } from '../editing/description-tree-labels.js';
import {
  buildGroupMap,
  countDescendantGroups,
  countDescendantItems,
  countDirectChildren,
} from '../editing/description-tree-helpers.js';
import type { DescriptionTreeGetResponse } from '../editing/description-tree-types.js';

const props = defineProps<{
  groupId: string;
  response: DescriptionTreeGetResponse;
  editingEnabled?: boolean;
  mutationPending?: boolean;
  reloadRequired?: boolean;
  unresolvedItemConflict?: boolean;
  canAddChildGroup?: boolean;
  depthLimitReached?: boolean;
}>();

const emit = defineEmits<{
  edit: [];
  addChildGroup: [];
  ungroup: [];
  deleteSubtree: [];
}>();

const groupMap = computed(() => buildGroupMap(props.response));

const group = computed(() => groupMap.value.get(props.groupId) ?? null);

const directChildren = computed(() =>
  group.value ? countDirectChildren(group.value) : 0,
);

const descendantItems = computed(() =>
  group.value ? countDescendantItems(props.groupId, groupMap.value) : 0,
);

const descendantGroups = computed(() =>
  group.value ? countDescendantGroups(props.groupId, groupMap.value) : 0,
);

const canMutate = computed(
  () =>
    Boolean(props.editingEnabled) &&
    !props.mutationPending &&
    !props.reloadRequired &&
    !props.unresolvedItemConflict,
);

const canEdit = computed(() => canMutate.value);

const canAddChild = computed(
  () => canMutate.value && props.canAddChildGroup !== false && !props.depthLimitReached,
);

const canUngroup = computed(() => canMutate.value);

const canDeleteSubtree = computed(() => canMutate.value);

function onEditClick(): void {
  if (!canEdit.value) {
    return;
  }
  emit('edit');
}

function onAddChildClick(): void {
  if (!canAddChild.value) {
    return;
  }
  emit('addChildGroup');
}

function onUngroupClick(): void {
  if (!canUngroup.value) {
    return;
  }
  emit('ungroup');
}

function onDeleteSubtreeClick(): void {
  if (!canDeleteSubtree.value) {
    return;
  }
  emit('deleteSubtree');
}
</script>

<template>
  <section
    v-if="group"
    class="group-info-panel"
    aria-label="グループ情報"
    data-testid="group-info-panel"
  >
    <div class="group-info-panel__header">
      <h3 class="group-info-panel__title">グループ情報</h3>
      <div v-if="editingEnabled" class="group-info-panel__actions">
        <button
          type="button"
          class="spec-page__btn spec-page__btn--secondary"
          data-testid="group-edit-open"
          :disabled="!canEdit"
          @click="onEditClick"
        >
          グループを編集
        </button>
        <button
          type="button"
          class="spec-page__btn spec-page__btn--secondary"
          data-testid="group-add-child-open"
          :disabled="!canAddChild"
          @click="onAddChildClick"
        >
          子グループを追加
        </button>
        <button
          type="button"
          class="spec-page__btn spec-page__btn--secondary"
          data-testid="group-ungroup-open"
          :disabled="!canUngroup"
          @click="onUngroupClick"
        >
          グループを解除
        </button>
        <button
          type="button"
          class="spec-page__btn spec-page__btn--danger"
          data-testid="group-delete-subtree-open"
          :disabled="!canDeleteSubtree"
          @click="onDeleteSubtreeClick"
        >
          グループを削除
        </button>
      </div>
    </div>
    <p
      v-if="editingEnabled && depthLimitReached"
      class="group-info-panel__depth-note"
      data-testid="group-depth-limit-note"
    >
      最大階層（8階層）に達しているため、子グループを追加できません。
    </p>
    <dl class="group-info-panel__list">
      <div class="group-info-panel__row">
        <dt>名前</dt>
        <dd>{{ group.name.trim() || '（未設定）' }}</dd>
      </div>
      <div class="group-info-panel__row">
        <dt>種類</dt>
        <dd>{{ formatGroupKindLabel(group.kind) }}</dd>
      </div>
      <div class="group-info-panel__row">
        <dt>説明</dt>
        <dd>{{ group.description?.trim() || '（未設定）' }}</dd>
      </div>
      <div class="group-info-panel__row">
        <dt>直下の子</dt>
        <dd>{{ directChildren }}</dd>
      </div>
      <div class="group-info-panel__row">
        <dt>下位 Group 数</dt>
        <dd>{{ descendantGroups }}</dd>
      </div>
      <div class="group-info-panel__row">
        <dt>下位 Item 数</dt>
        <dd>{{ descendantItems }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.group-info-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.group-info-panel__header .group-info-panel__title {
  margin: 0;
}

.group-info-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.group-info-panel__depth-note {
  margin: 0 0 0.75rem;
  color: var(--spec-muted, #57606a);
  font-size: 0.85rem;
}
</style>
