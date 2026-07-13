<script setup lang="ts">
import { useRouter } from 'vue-router';
import type { ScreenData, ScreenInteraction } from '../types';

const props = defineProps<{
  screen: ScreenData;
  selectedItemId: string | null;
}>();

const emit = defineEmits<{
  select: [itemId: string];
  'change-state': [stateId: string];
}>();

const router = useRouter();

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
</script>

<template>
  <div class="item-table-wrap">
    <table class="item-table">
      <thead>
        <tr>
          <th scope="col">番号</th>
          <th scope="col">項目名</th>
          <th scope="col">種別</th>
          <th scope="col">説明</th>
          <th scope="col">備考</th>
          <th scope="col">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(itemId, index) in screen.itemOrder"
          :key="itemId"
          :class="{ 'is-selected': selectedItemId === itemId }"
          @click="emit('select', itemId)"
        >
          <td>{{ index + 1 }}</td>
          <td>{{ screen.items[itemId]?.name || itemId }}</td>
          <td>{{ screen.items[itemId]?.type || '' }}</td>
          <td>{{ screen.items[itemId]?.description || '' }}</td>
          <td>{{ screen.items[itemId]?.note || '' }}</td>
          <td>
            <div class="item-table__actions">
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
