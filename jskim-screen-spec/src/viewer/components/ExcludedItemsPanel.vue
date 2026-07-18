<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{
  excludedItems: Record<
    string,
    { name: string; type: string; description: string; note: string }
  >;
  collectedItemIds: string[];
}>();

const emit = defineEmits<{
  restore: [itemId: string];
}>();

const expanded = ref(false);

const sortedIds = computed(() =>
  Object.keys(props.excludedItems).sort((a, b) => a.localeCompare(b)),
);

const collectedSet = computed(() => new Set(props.collectedItemIds || []));

function implementationLabel(itemId: string): string {
  return collectedSet.value.has(itemId) ? '実装あり' : '実装なし';
}
</script>

<template>
  <section
    v-if="sortedIds.length > 0"
    class="excluded-items-panel"
    aria-label="除外した項目"
  >
    <button
      type="button"
      class="excluded-items-panel__toggle"
      :aria-expanded="expanded ? 'true' : 'false'"
      aria-controls="excluded-items-panel-body"
      @click="expanded = !expanded"
    >
      除外した項目（{{ sortedIds.length }}）
    </button>

    <div
      v-show="expanded"
      id="excluded-items-panel-body"
      class="excluded-items-panel__body"
    >
      <table class="excluded-items-panel__table">
        <thead>
          <tr>
            <th scope="col">項目 ID</th>
            <th scope="col">項目名</th>
            <th scope="col">種類</th>
            <th scope="col">実装状態</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="itemId in sortedIds"
            :id="`excluded-item-row-${itemId}`"
            :key="itemId"
          >
            <td class="item-table__id">
              <code>{{ itemId }}</code>
            </td>
            <td>{{ excludedItems[itemId]?.name || '（未設定）' }}</td>
            <td>{{ excludedItems[itemId]?.type || '（未設定）' }}</td>
            <td>
              <span
                class="excluded-items-panel__impl"
                :data-impl="
                  collectedSet.has(itemId) ? 'present' : 'absent'
                "
              >
                {{ implementationLabel(itemId) }}
              </span>
            </td>
            <td>
              <button
                type="button"
                class="item-table__action-btn"
                :aria-label="`設計対象に戻す: ${itemId}`"
                title="設計対象に戻す"
                @click="emit('restore', itemId)"
              >
                設計対象に戻す
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
