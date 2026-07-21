<script setup lang="ts">
import { computed } from 'vue';
import { formatRevisionPreview } from '../editing/description-tree-types.js';
import type {
  DescriptionTreeGetResponse,
  SelectedTreeNode,
} from '../editing/description-tree-types.js';
import type { DescriptionTreePanelStatus } from '../editing/use-description-tree-panel.js';
import ItemTreeBranch from './ItemTreeBranch.vue';

const props = defineProps<{
  status: DescriptionTreePanelStatus;
  response: DescriptionTreeGetResponse | null;
  errorMessage: string;
  expandedGroupIds: Set<string>;
  selectedTreeNode: SelectedTreeNode | null;
}>();

const emit = defineEmits<{
  reload: [];
  toggleGroup: [groupId: string];
  selectGroup: [groupId: string];
  selectItem: [itemId: string];
}>();

const revisionPreview = computed(() =>
  props.response ? formatRevisionPreview(props.response.revision) : '',
);

const sourceSchemaVersion = computed(
  () => props.response?.sourceSchemaVersion ?? '',
);

const rootNodes = computed(() => props.response?.description.rootNodes ?? []);
</script>

<template>
  <section class="item-tree-panel" aria-label="項目ツリー">
    <div class="item-tree-panel__header">
      <h3 class="item-tree-panel__title">項目ツリー</h3>
      <button
        type="button"
        class="item-tree-panel__reload"
        :disabled="status === 'loading'"
        @click="emit('reload')"
      >
        再読み込み
      </button>
    </div>

    <div
      v-if="response && status !== 'loading'"
      class="item-tree-panel__meta"
    >
      <span>保存形式: v{{ sourceSchemaVersion }}</span>
      <span>Revision: {{ revisionPreview }}</span>
    </div>

    <p v-if="status === 'loading'" class="item-tree-panel__status">
      Item Tree を読み込んでいます…
    </p>

    <div
      v-else-if="status === 'error'"
      class="item-tree-panel__error"
      role="alert"
    >
      <p>Item Tree を取得できませんでした。</p>
      <p v-if="errorMessage">{{ errorMessage }}</p>
      <button type="button" class="item-tree-panel__retry" @click="emit('reload')">
        再試行
      </button>
    </div>

    <p v-else-if="status === 'empty'" class="item-tree-panel__status">
      表示する画面項目はありません。
    </p>

    <div v-else-if="status === 'ready' && response" class="item-tree-panel__body">
      <ItemTreeBranch
        :nodes="rootNodes"
        :depth="0"
        :response="response"
        :expanded-group-ids="expandedGroupIds"
        :selected-tree-node="selectedTreeNode"
        @toggle-group="emit('toggleGroup', $event)"
        @select-group="emit('selectGroup', $event)"
        @select-item="emit('selectItem', $event)"
      />
    </div>
  </section>
</template>
