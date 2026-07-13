<script setup lang="ts">
import { computed, inject, ref, watch, type ComputedRef } from 'vue';
import DomPreview from '../components/DomPreview.vue';
import StateSelector from '../components/StateSelector.vue';
import ItemDescriptionTable from '../components/ItemDescriptionTable.vue';
import type { ScreenData, ViewerManifest } from '../types';

const props = defineProps<{
  screenId: string;
}>();

const manifest = inject<ComputedRef<ViewerManifest>>('manifest');

const screen = ref<ScreenData | null>(null);
const selectedStateId = ref('default');
const selectedItemId = ref<string | null>(null);
const snapshotHtml = ref('');
const previewCss = ref('');
const loadError = ref<string | null>(null);

const visibleStates = computed(
  () => screen.value?.states.filter((s) => s.viewer.visible) ?? [],
);

async function loadScreen(screenId: string): Promise<void> {
  loadError.value = null;
  screen.value = null;
  selectedItemId.value = null;

  if (screenId === '_empty') {
    loadError.value = '表示できる画面がありません。';
    return;
  }

  const base = import.meta.env.BASE_URL;
  const entry = manifest?.value.screens.find((s) => s.id === screenId);
  if (!entry) {
    loadError.value = `画面「${screenId}」は登録されていません。`;
    return;
  }

  const screenRes = await fetch(`${base}data/${entry.dataFile}`);
  if (!screenRes.ok) {
    loadError.value = `画面データの読み込みに失敗しました: ${entry.dataFile}`;
    return;
  }
  const data = (await screenRes.json()) as ScreenData;
  screen.value = data;

  const firstVisible =
    data.states.find((s) => s.viewer.visible) || data.states[0];
  selectedStateId.value = firstVisible?.id ?? 'default';

  if (!previewCss.value) {
    const cssRes = await fetch(`${base}data/theme/preview.css`);
    previewCss.value = cssRes.ok ? await cssRes.text() : '';
  }

  await loadSnapshot(selectedStateId.value);
}

async function loadSnapshot(stateId: string): Promise<void> {
  if (!screen.value) {
    return;
  }
  const state = screen.value.states.find((s) => s.id === stateId);
  if (!state) {
    snapshotHtml.value = '';
    return;
  }
  const base = import.meta.env.BASE_URL;
  const res = await fetch(`${base}data/${state.snapshotFile}`);
  if (!res.ok) {
    loadError.value = `snapshot の読み込みに失敗しました: ${state.snapshotFile}`;
    return;
  }
  snapshotHtml.value = await res.text();
}

function onSelectState(stateId: string): void {
  selectedStateId.value = stateId;
  void loadSnapshot(stateId);
}

watch(
  () => props.screenId,
  (id) => {
    void loadScreen(id);
  },
  { immediate: true },
);
</script>

<template>
  <div v-if="loadError" class="spec-page spec-page--error">
    <p>{{ loadError }}</p>
  </div>
  <div v-else-if="!screen" class="spec-page">
    <p>読み込み中…</p>
  </div>
  <div v-else class="spec-page">
    <header class="spec-page__header">
      <h1>{{ screen.name }}</h1>
      <p class="spec-page__desc">{{ screen.description }}</p>
      <p class="spec-page__meta">
        <span>画面 ID: {{ screen.id }}</span>
        <span>実装 path: {{ screen.path }}</span>
      </p>
    </header>

    <StateSelector
      :states="visibleStates"
      :selected-state-id="selectedStateId"
      @select="onSelectState"
    />

    <section class="spec-page__preview" aria-label="DOM プレビュー">
      <DomPreview
        :html="snapshotHtml"
        :item-order="screen.itemOrder"
        :selected-item-id="selectedItemId"
        :preview-css="previewCss"
        @select="selectedItemId = $event"
      />
    </section>

    <section class="spec-page__table" aria-label="項目説明">
      <h2>項目説明</h2>
      <ItemDescriptionTable
        :screen="screen"
        :selected-item-id="selectedItemId"
        @select="selectedItemId = $event"
        @change-state="onSelectState"
      />
    </section>
  </div>
</template>
