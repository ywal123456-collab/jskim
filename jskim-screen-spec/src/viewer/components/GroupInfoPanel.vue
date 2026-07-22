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
}>();

const emit = defineEmits<{
  edit: [];
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

const canEdit = computed(
  () =>
    Boolean(props.editingEnabled) &&
    !props.mutationPending &&
    !props.reloadRequired,
);

function onEditClick(): void {
  if (!canEdit.value) {
    return;
  }
  emit('edit');
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
      <button
        v-if="editingEnabled"
        type="button"
        class="spec-page__btn spec-page__btn--secondary"
        data-testid="group-edit-open"
        :disabled="!canEdit"
        @click="onEditClick"
      >
        グループを編集
      </button>
    </div>
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
</style>
