<script setup lang="ts">
import { computed, inject, ref, watch, type ComputedRef } from 'vue';
import DomPreview, {
  type PreviewStylesheet,
} from '../components/DomPreview.vue';
import StateSelector from '../components/StateSelector.vue';
import ItemDescriptionTable from '../components/ItemDescriptionTable.vue';
import { useDescriptionEditor } from '../editing/useDescriptionEditor';
import type { DocumentContext, ScreenData, ViewerManifest } from '../types';

const props = defineProps<{
  screenId: string;
}>();

const manifest = inject<ComputedRef<ViewerManifest>>('manifest');

const screen = ref<ScreenData | null>(null);
const selectedStateId = ref('default');
const selectedItemId = ref<string | null>(null);
const snapshotHtml = ref('');
const previewCss = ref('');
const stylesheets = ref<PreviewStylesheet[]>([]);
const loadError = ref<string | null>(null);

const editor = useDescriptionEditor(() => props.screenId);

const currentDocumentContext = computed<DocumentContext | null>(() => {
  if (!screen.value) {
    return null;
  }
  const state = screen.value.states.find((s) => s.id === selectedStateId.value);
  return state?.documentContext ?? null;
});

const displayName = computed(() => {
  if (editor.editingEnabled && editor.draftDocument.value) {
    return editor.draftDocument.value.screen.name || screen.value?.name || '';
  }
  return screen.value?.name || '';
});

const statusLabel = computed(() => {
  switch (editor.status.value) {
    case 'dirty':
      return '未保存の変更あり';
    case 'saving':
      return '保存中…';
    case 'saved':
      return '保存済み';
    case 'conflict':
      return '外部変更の衝突';
    case 'error':
      return '保存失敗';
    case 'clean':
      return '保存済み';
    default:
      return '';
  }
});

async function loadScreen(screenId: string): Promise<void> {
  loadError.value = null;
  screen.value = null;
  selectedItemId.value = null;
  stylesheets.value = [];

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

  if (editor.editingEnabled) {
    await editor.loadDescription(screenId);
  }

  const firstVisible =
    data.states.find((s) => s.viewer.visible) || data.states[0];
  selectedStateId.value = firstVisible?.id ?? 'default';

  if (!previewCss.value) {
    const cssRes = await fetch(`${base}data/theme/preview.css`);
    previewCss.value = cssRes.ok ? await cssRes.text() : '';
  }

  await loadSnapshot(selectedStateId.value);
}

async function resolveStylesheets(
  stateId: string,
): Promise<PreviewStylesheet[]> {
  if (!screen.value) {
    return [];
  }
  const state = screen.value.states.find((s) => s.id === stateId);
  const styles = state?.styles || [];
  const result: PreviewStylesheet[] = [];

  for (const style of styles) {
    if (style.disabled) {
      continue;
    }
    if (style.kind === 'style') {
      try {
        const res = await fetch(style.href);
        const cssText = res.ok ? await res.text() : '';
        result.push({ cssText, media: style.media || 'all' });
      } catch {
        result.push({ cssText: '', media: style.media || 'all' });
      }
    } else {
      result.push({ href: style.href, media: style.media || 'all' });
    }
  }

  return result;
}

async function loadSnapshot(stateId: string): Promise<void> {
  if (!screen.value) {
    return;
  }
  const state = screen.value.states.find((s) => s.id === stateId);
  if (!state) {
    snapshotHtml.value = '';
    stylesheets.value = [];
    return;
  }
  const base = import.meta.env.BASE_URL;
  const res = await fetch(`${base}data/${state.snapshotFile}`);
  if (!res.ok) {
    loadError.value = `snapshot の読み込みに失敗しました: ${state.snapshotFile}`;
    return;
  }
  snapshotHtml.value = await res.text();
  stylesheets.value = await resolveStylesheets(stateId);
}

function onSelectState(stateId: string): void {
  selectedStateId.value = stateId;
  void loadSnapshot(stateId);
}

function scrollToSection(id: string): void {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function onSelectItem(itemId: string): void {
  selectedItemId.value = itemId;
  const row = document.getElementById(`item-row-${itemId}`);
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function copyDraftJson(): void {
  if (!editor.draftDocument.value) {
    return;
  }
  const text = JSON.stringify(editor.draftDocument.value, null, 2);
  void navigator.clipboard?.writeText(text);
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
  <div v-else class="spec-page" :class="{ 'spec-page--editing': editor.editingEnabled }">
    <header class="spec-page__header">
      <div class="spec-page__header-main">
        <h1>{{ displayName || screen.id }}</h1>
        <p class="spec-page__meta">
          <span>画面 ID: {{ screen.id }}</span>
          <span>実装 path: {{ screen.path }}</span>
        </p>
      </div>

      <div v-if="editor.editingEnabled" class="spec-page__edit-bar">
        <span
          class="spec-page__status"
          :data-status="editor.status.value"
        >{{ statusLabel }}</span>
        <button
          type="button"
          class="spec-page__btn"
          :disabled="!editor.dirty.value || editor.saving.value"
          @click="editor.save()"
        >
          保存
        </button>
        <button
          type="button"
          class="spec-page__btn spec-page__btn--secondary"
          :disabled="!editor.dirty.value || editor.saving.value"
          @click="editor.cancel()"
        >
          キャンセル
        </button>
      </div>
    </header>

    <div
      v-if="editor.statusMessage.value"
      class="spec-page__banner"
      :data-status="editor.status.value"
    >
      <p>{{ editor.statusMessage.value }}</p>
      <div v-if="editor.status.value === 'conflict'" class="spec-page__banner-actions">
        <button type="button" class="spec-page__btn" @click="editor.reloadLatest()">
          最新内容を読み込む
        </button>
        <button
          type="button"
          class="spec-page__btn spec-page__btn--secondary"
          @click="copyDraftJson()"
        >
          編集中の内容をコピー
        </button>
      </div>
    </div>

    <StateSelector
      :states="screen.states"
      :selected-state-id="selectedStateId"
      @select="onSelectState"
    />

    <nav v-if="editor.editingEnabled" class="spec-page__nav" aria-label="セクション">
      <button type="button" @click="scrollToSection('section-preview')">Preview</button>
      <button type="button" @click="scrollToSection('section-basic')">基本情報</button>
      <button type="button" @click="scrollToSection('section-items')">項目定義</button>
    </nav>

    <div class="spec-page__workspace">
      <aside id="section-preview" class="spec-page__preview-pane" aria-label="DOM プレビュー">
        <h2 class="spec-page__section-title">Preview</h2>
        <DomPreview
          :html="snapshotHtml"
          :item-order="screen.itemOrder"
          :selected-item-id="selectedItemId"
          :stylesheets="stylesheets"
          :preview-css="previewCss"
          :document-context="currentDocumentContext"
          @select="onSelectItem"
        />
      </aside>

      <div class="spec-page__doc-pane">
        <section
          v-if="editor.editingEnabled && editor.draftDocument.value"
          id="section-basic"
          class="spec-page__basic"
          aria-label="基本情報"
        >
          <h2 class="spec-page__section-title">基本情報</h2>
          <label class="spec-field">
            <span>画面名</span>
            <input
              :value="editor.draftDocument.value.screen.name"
              type="text"
              @input="editor.updateScreenField('name', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="spec-field">
            <span>画面説明</span>
            <textarea
              :value="editor.draftDocument.value.screen.description"
              rows="4"
              @input="editor.updateScreenField('description', ($event.target as HTMLTextAreaElement).value)"
            />
          </label>
          <p class="spec-field__hint">画面 ID（{{ screen.id }}）は変更できません。</p>
        </section>

        <section
          v-else
          id="section-basic"
          class="spec-page__basic"
          aria-label="基本情報"
        >
          <h2 class="spec-page__section-title">基本情報</h2>
          <p class="spec-page__desc">{{ screen.description }}</p>
        </section>

        <section id="section-items" class="spec-page__table" aria-label="項目定義">
          <h2 class="spec-page__section-title">項目定義</h2>
          <ItemDescriptionTable
            :screen="screen"
            :selected-item-id="selectedItemId"
            :editable="editor.editingEnabled"
            :draft-items="editor.draftDocument.value?.items || null"
            @select="onSelectItem"
            @change-state="onSelectState"
            @update-item="
              (itemId, field, value) => editor.updateItemField(itemId, field, value)
            "
          />
        </section>
      </div>
    </div>
  </div>
</template>
