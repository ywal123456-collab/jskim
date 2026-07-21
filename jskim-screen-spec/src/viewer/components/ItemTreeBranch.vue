<script setup lang="ts">
import { computed } from 'vue';
import { formatGroupKindLabel } from '../editing/description-tree-labels.js';
import {
  buildGroupMap,
  countDirectChildren,
  isSelectedTreeNode,
  itemDisplayName,
} from '../editing/description-tree-helpers.js';
import type {
  DescriptionTreeGetResponse,
  DescriptionTreeNodeRef,
  SelectedTreeNode,
} from '../editing/description-tree-types.js';
import ItemTreeBranch from './ItemTreeBranch.vue';

const props = defineProps<{
  nodes: DescriptionTreeNodeRef[];
  depth: number;
  response: DescriptionTreeGetResponse;
  expandedGroupIds: Set<string>;
  selectedTreeNode: SelectedTreeNode | null;
}>();

const emit = defineEmits<{
  toggleGroup: [groupId: string];
  selectGroup: [groupId: string];
  selectItem: [itemId: string];
}>();

const groupMap = computed(() => buildGroupMap(props.response));

function groupLabel(groupId: string): string {
  const group = groupMap.value.get(groupId);
  if (!group) {
    return `（定義が見つかりません: ${groupId}）`;
  }
  if (group.name.trim()) {
    return group.name.trim();
  }
  return groupId;
}

function groupKindLabel(groupId: string): string {
  const group = groupMap.value.get(groupId);
  if (!group) {
    return '不明';
  }
  return formatGroupKindLabel(group.kind);
}

function isExpanded(groupId: string): boolean {
  return props.expandedGroupIds.has(groupId);
}
</script>

<template>
  <ul v-if="nodes.length > 0" class="item-tree__list" :data-depth="depth">
    <li
      v-for="ref in nodes"
      :key="`${ref.type}:${ref.id}`"
      class="item-tree__node"
      :data-depth="depth"
    >
      <template v-if="ref.type === 'group'">
        <div
          class="item-tree__row"
          :class="{ 'is-selected': isSelectedTreeNode(selectedTreeNode, ref) }"
        >
          <button
            type="button"
            class="item-tree__toggle"
            :aria-expanded="isExpanded(ref.id) ? 'true' : 'false'"
            :aria-label="isExpanded(ref.id) ? '折りたたむ' : '展開'"
            @click.stop="emit('toggleGroup', ref.id)"
          >
            {{ isExpanded(ref.id) ? '▼' : '▶' }}
          </button>
          <button
            type="button"
            class="item-tree__select"
            :aria-current="
              isSelectedTreeNode(selectedTreeNode, ref) ? 'true' : undefined
            "
            @click="emit('selectGroup', ref.id)"
          >
            <span class="item-tree__label">{{ groupLabel(ref.id) }}</span>
            <span class="item-tree__meta">{{ groupKindLabel(ref.id) }}</span>
            <span
              v-if="groupMap.get(ref.id)"
              class="item-tree__count"
            >
              {{ countDirectChildren(groupMap.get(ref.id)!) }}
            </span>
          </button>
        </div>
        <p
          v-if="!groupMap.get(ref.id)"
          class="item-tree__error"
        >
          Group 定義が見つかりません: {{ ref.id }}
        </p>
        <template v-else-if="isExpanded(ref.id)">
          <p
            v-if="groupMap.get(ref.id)!.children.length === 0"
            class="item-tree__empty"
          >
            このグループには項目がありません。
          </p>
          <ItemTreeBranch
            v-else
            :nodes="groupMap.get(ref.id)!.children"
            :depth="depth + 1"
            :response="response"
            :expanded-group-ids="expandedGroupIds"
            :selected-tree-node="selectedTreeNode"
            @toggle-group="emit('toggleGroup', $event)"
            @select-group="emit('selectGroup', $event)"
            @select-item="emit('selectItem', $event)"
          />
        </template>
      </template>

      <template v-else>
        <div
          class="item-tree__row item-tree__row--item"
          :class="{ 'is-selected': isSelectedTreeNode(selectedTreeNode, ref) }"
        >
          <span class="item-tree__spacer" aria-hidden="true" />
          <button
            type="button"
            class="item-tree__select"
            :aria-current="
              isSelectedTreeNode(selectedTreeNode, ref) ? 'true' : undefined
            "
            @click="emit('selectItem', ref.id)"
          >
            <span class="item-tree__label">{{
              itemDisplayName(response, ref.id)
            }}</span>
            <span
              v-if="response.description.items[ref.id]?.type"
              class="item-tree__meta"
            >
              {{ response.description.items[ref.id]?.type }}
            </span>
          </button>
        </div>
        <p
          v-if="!response.description.items[ref.id]"
          class="item-tree__error"
        >
          Item 定義が見つかりません: {{ ref.id }}
        </p>
      </template>
    </li>
  </ul>
</template>
