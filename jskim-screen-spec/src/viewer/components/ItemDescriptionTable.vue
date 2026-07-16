<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { ScreenData, ScreenInteraction } from '../types';

const props = defineProps<{
  screen: ScreenData;
  selectedItemId: string | null;
  editable?: boolean;
  draftItems?: Record<
    string,
    { name: string; type: string; description: string; note: string }
  > | null;
  /** 編集中は draft の itemOrder を渡す。未指定時は screen.itemOrder を使う */
  itemOrder?: string[] | null;
}>();

const emit = defineEmits<{
  select: [itemId: string];
  'change-state': [stateId: string];
  'update-item': [
    itemId: string,
    field: 'name' | 'type' | 'description' | 'note',
    value: string,
  ];
  'move-up': [itemId: string];
  'move-down': [itemId: string];
}>();

const router = useRouter();

const displayItemOrder = computed(() => props.itemOrder ?? props.screen.itemOrder);

const UNREGISTERED_LABEL = '画面設計書未登録';

function interactionsFor(itemId: string): ScreenInteraction[] {
  return props.screen.interactions.filter((i) => i.itemId === itemId);
}

function handleInteraction(interaction: ScreenInteraction): void {
  if (interaction.unregisteredTarget) {
    return;
  }
  if (interaction.type === 'state-transition' && interaction.targetStateId) {
    emit('change-state', interaction.targetStateId);
    return;
  }
  if (interaction.type === 'screen-transition' && interaction.targetScreenId) {
    router.push(`/screens/${interaction.targetScreenId}`);
    return;
  }
  if (interaction.type === 'external-link' && interaction.url) {
    window.open(interaction.url, '_blank', 'noopener,noreferrer');
  }
}

function buttonLabel(interaction: ScreenInteraction): string {
  if (interaction.unregisteredTarget) {
    return UNREGISTERED_LABEL;
  }
  return interaction.label || interaction.type;
}

function itemField(
  itemId: string,
  field: 'name' | 'type' | 'description' | 'note',
): string {
  if (props.editable && props.draftItems && props.draftItems[itemId]) {
    return props.draftItems[itemId][field] || '';
  }
  return props.screen.items[itemId]?.[field] || '';
}
</script>

<template>
  <div class="item-table-wrap">
    <table class="item-table" :class="{ 'item-table--editable': editable }">
      <thead>
        <tr>
          <th scope="col">番号</th>
          <th scope="col">項目 ID</th>
          <th scope="col">項目名</th>
          <th scope="col">種別</th>
          <th scope="col">説明</th>
          <th scope="col">備考</th>
          <th scope="col">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(itemId, index) in displayItemOrder"
          :id="`item-row-${itemId}`"
          :key="itemId"
          :class="{ 'is-selected': selectedItemId === itemId }"
          @click="emit('select', itemId)"
        >
          <td>{{ index + 1 }}</td>
          <td class="item-table__id">
            <code>{{ itemId }}</code>
          </td>
          <td>
            <input
              v-if="editable"
              :value="itemField(itemId, 'name')"
              type="text"
              @click.stop
              @input="
                emit(
                  'update-item',
                  itemId,
                  'name',
                  ($event.target as HTMLInputElement).value,
                )
              "
            />
            <template v-else>{{ itemField(itemId, 'name') || itemId }}</template>
          </td>
          <td>
            <input
              v-if="editable"
              :value="itemField(itemId, 'type')"
              type="text"
              @click.stop
              @input="
                emit(
                  'update-item',
                  itemId,
                  'type',
                  ($event.target as HTMLInputElement).value,
                )
              "
            />
            <template v-else>{{ itemField(itemId, 'type') }}</template>
          </td>
          <td>
            <textarea
              v-if="editable"
              :value="itemField(itemId, 'description')"
              rows="2"
              @click.stop
              @input="
                emit(
                  'update-item',
                  itemId,
                  'description',
                  ($event.target as HTMLTextAreaElement).value,
                )
              "
            />
            <template v-else>{{ itemField(itemId, 'description') }}</template>
          </td>
          <td>
            <textarea
              v-if="editable"
              :value="itemField(itemId, 'note')"
              rows="2"
              @click.stop
              @input="
                emit(
                  'update-item',
                  itemId,
                  'note',
                  ($event.target as HTMLTextAreaElement).value,
                )
              "
            />
            <template v-else>{{ itemField(itemId, 'note') }}</template>
          </td>
          <td>
            <div class="item-table__actions">
              <template v-if="editable">
                <button
                  type="button"
                  class="item-table__reorder-btn"
                  aria-label="上へ"
                  title="上へ"
                  :disabled="index === 0"
                  @click.stop="emit('move-up', itemId)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="item-table__reorder-btn"
                  aria-label="下へ"
                  title="下へ"
                  :disabled="index === displayItemOrder.length - 1"
                  @click.stop="emit('move-down', itemId)"
                >
                  ↓
                </button>
              </template>
              <button
                v-for="(interaction, iIndex) in interactionsFor(itemId)"
                :key="`${itemId}-${iIndex}`"
                type="button"
                class="item-table__action"
                :disabled="Boolean(interaction.unregisteredTarget)"
                :title="
                  interaction.unregisteredTarget
                    ? UNREGISTERED_LABEL
                    : buttonLabel(interaction)
                "
                @click.stop="handleInteraction(interaction)"
              >
                {{ buttonLabel(interaction) }}
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
