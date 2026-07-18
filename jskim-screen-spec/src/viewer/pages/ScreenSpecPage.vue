<script setup lang="ts">
import { computed, inject, nextTick, ref, watch, type ComputedRef } from 'vue';
import DomPreview, {
  type PreviewStylesheet,
} from '../components/DomPreview.vue';
import StateSelector from '../components/StateSelector.vue';
import ItemDescriptionTable from '../components/ItemDescriptionTable.vue';
import CreateItemDialog from '../components/CreateItemDialog.vue';
import DuplicateItemDialog from '../components/DuplicateItemDialog.vue';
import DeleteItemDialog from '../components/DeleteItemDialog.vue';
import ExcludeItemDialog from '../components/ExcludeItemDialog.vue';
import ExcludedItemsPanel from '../components/ExcludedItemsPanel.vue';
import { useDescriptionEditor } from '../editing/useDescriptionEditor';
import {
  SCREEN_SPEC_STATUS_LABEL,
  type DocumentContext,
  type ScreenData,
  type ViewerManifest,
} from '../types';

const props = defineProps<{
  screenId: string;
}>();

const manifest = inject<ComputedRef<ViewerManifest>>('manifest');
const editingEnabled = inject<boolean>('editingEnabled', false);
const openCreateScreen = inject<() => void>('openCreateScreen', () => {});

const screen = ref<ScreenData | null>(null);
const isEmptyState = ref(false);
const selectedStateId = ref('');
const selectedItemId = ref<string | null>(null);
const snapshotHtml = ref('');
const previewCss = ref('');
const stylesheets = ref<PreviewStylesheet[]>([]);
const loadError = ref<string | null>(null);
const createItemDialogOpen = ref(false);
const duplicateSourceItemId = ref<string | null>(null);
const deleteTargetItemId = ref<string | null>(null);
const excludeTargetItemId = ref<string | null>(null);

const editor = useDescriptionEditor(() => props.screenId);

/** 新規 ID 重複チェック用（active + excluded） */
const existingItemIdsForCreate = computed(() => {
  const doc = editor.draftDocument.value;
  if (!doc) {
    return [] as string[];
  }
  return [
    ...Object.keys(doc.items || {}),
    ...Object.keys(doc.excludedItems || {}),
  ];
});

const specStatusLabel = computed(() => {
  if (!screen.value) {
    return '';
  }
  return SCREEN_SPEC_STATUS_LABEL[screen.value.status] ?? '';
});

const showPreview = computed(
  () => Boolean(screen.value?.hasPreview) && (screen.value?.states.length ?? 0) > 0,
);

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

const displayItemOrder = computed(() => {
  if (editor.editingEnabled && editor.draftDocument.value) {
    return editor.draftDocument.value.itemOrder;
  }
  return screen.value?.itemOrder ?? [];
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
  isEmptyState.value = false;
  screen.value = null;
  selectedItemId.value = null;
  selectedStateId.value = '';
  snapshotHtml.value = '';
  stylesheets.value = [];

  if (screenId === '_empty') {
    isEmptyState.value = true;
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

  // 状態が無い画面（design-only 等）は default state を発明しない
  const firstVisible =
    data.states.find((s) => s.viewer.visible) || data.states[0];
  selectedStateId.value = firstVisible?.id ?? '';

  if (!previewCss.value) {
    const cssRes = await fetch(`${base}data/theme/preview.css`);
    previewCss.value = cssRes.ok ? await cssRes.text() : '';
  }

  if (firstVisible) {
    await loadSnapshot(selectedStateId.value);
  }
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
  // 除外済み ID は通常一覧に無いため選択しない
  if (
    editor.editingEnabled &&
    editor.draftDocument.value &&
    !editor.draftDocument.value.items[itemId]
  ) {
    return;
  }
  selectedItemId.value = itemId;
  const row = document.getElementById(`item-row-${itemId}`);
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function syncSelectionAfterOrderChange(
  previousOrder: string[],
  removedId: string,
  wasSelected: boolean,
): void {
  if (!wasSelected) {
    return;
  }
  const index = previousOrder.indexOf(removedId);
  const nextOrder = editor.draftDocument.value?.itemOrder ?? [];
  const nextId = nextOrder[index] ?? nextOrder[index - 1] ?? null;
  selectedItemId.value = nextId;
  if (nextId) {
    void nextTick(() => {
      document
        .getElementById(`item-row-${nextId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
}

function onCancelEdits(): void {
  editor.cancel();
  const order = editor.draftDocument.value?.itemOrder ?? [];
  if (selectedItemId.value && !order.includes(selectedItemId.value)) {
    selectedItemId.value = order[0] ?? null;
  }
}

function openCreateItem(): void {
  createItemDialogOpen.value = true;
}

function closeCreateItem(): void {
  createItemDialogOpen.value = false;
}

function onCreateItem(payload: {
  itemId: string;
  name: string;
  type: string;
  description: string;
  note: string;
}): void {
  const added = editor.addItem(payload);
  if (!added) {
    return;
  }
  void nextTick(() => {
    onSelectItem(payload.itemId);
  });
}

function openDuplicateItem(itemId: string): void {
  duplicateSourceItemId.value = itemId;
}

function closeDuplicateItem(): void {
  duplicateSourceItemId.value = null;
}

const duplicateSourceItem = computed(() => {
  const id = duplicateSourceItemId.value;
  if (!id || !editor.draftDocument.value) {
    return null;
  }
  const item = editor.draftDocument.value.items[id];
  if (!item) {
    return null;
  }
  return { itemId: id, ...item };
});

function onDuplicateItem(payload: {
  itemId: string;
  name: string;
  type: string;
  description: string;
  note: string;
}): void {
  const sourceId = duplicateSourceItemId.value;
  if (!sourceId) {
    return;
  }
  const ok = editor.duplicateItem(sourceId, payload);
  if (!ok) {
    return;
  }
  void nextTick(() => {
    onSelectItem(payload.itemId);
  });
}

function openDeleteItem(itemId: string): void {
  if (editor.isCollectedItem(itemId)) {
    return;
  }
  deleteTargetItemId.value = itemId;
}

function closeDeleteItem(): void {
  deleteTargetItemId.value = null;
}

const deleteTargetItem = computed(() => {
  const id = deleteTargetItemId.value;
  if (!id || !editor.draftDocument.value) {
    return null;
  }
  const item = editor.draftDocument.value.items[id];
  if (!item) {
    return null;
  }
  return { itemId: id, name: item.name };
});

function onConfirmDeleteItem(): void {
  const itemId = deleteTargetItemId.value;
  if (!itemId || !editor.draftDocument.value) {
    return;
  }
  const order = [...editor.draftDocument.value.itemOrder];
  const wasSelected = selectedItemId.value === itemId;
  const removed = editor.removeItem(itemId);
  if (!removed) {
    return;
  }
  syncSelectionAfterOrderChange(order, itemId, wasSelected);
}

function openExcludeItem(itemId: string): void {
  if (!editor.isCollectedItem(itemId)) {
    return;
  }
  if (!editor.draftDocument.value?.items[itemId]) {
    return;
  }
  excludeTargetItemId.value = itemId;
}

function closeExcludeItem(): void {
  excludeTargetItemId.value = null;
}

const excludeTargetItem = computed(() => {
  const id = excludeTargetItemId.value;
  if (!id || !editor.draftDocument.value) {
    return null;
  }
  const item = editor.draftDocument.value.items[id];
  if (!item) {
    return null;
  }
  return { itemId: id, name: item.name };
});

function onConfirmExcludeItem(): void {
  const itemId = excludeTargetItemId.value;
  if (!itemId || !editor.draftDocument.value) {
    return;
  }
  const order = [...editor.draftDocument.value.itemOrder];
  const wasSelected = selectedItemId.value === itemId;
  const ok = editor.excludeItem(itemId);
  if (!ok) {
    return;
  }
  syncSelectionAfterOrderChange(order, itemId, wasSelected);
}

function onRestoreExcludedItem(itemId: string): void {
  const ok = editor.restoreItem(itemId);
  if (!ok) {
    return;
  }
  void nextTick(() => {
    onSelectItem(itemId);
  });
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
  <div v-if="isEmptyState" class="spec-page spec-page--empty">
    <template v-if="editingEnabled">
      <p>画面がまだありません。</p>
      <p>
        画面設計を先に作成するか、<br />
        実装画面を収集すると、ここに表示されます。
      </p>
      <button type="button" class="spec-page__btn" @click="openCreateScreen()">
        ＋ 画面を作成
      </button>
    </template>
    <template v-else>
      <p>表示できる画面がありません。</p>
    </template>
  </div>
  <div v-else-if="loadError" class="spec-page spec-page--error">
    <p>{{ loadError }}</p>
  </div>
  <div v-else-if="!screen" class="spec-page">
    <p>読み込み中…</p>
  </div>
  <div v-else class="spec-page" :class="{ 'spec-page--editing': editor.editingEnabled }">
    <header class="spec-page__header">
      <div class="spec-page__header-main">
        <div class="spec-page__title-row">
          <h1>{{ displayName || screen.id }}</h1>
          <span
            class="spec-page__status-badge"
            :data-status="screen.status"
            >{{ specStatusLabel }}</span
          >
        </div>
        <p class="spec-page__meta">
          <span>画面 ID: {{ screen.id }}</span>
          <span>実装 path: {{ screen.path || '（未連携）' }}</span>
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
          @click="onCancelEdits"
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
      v-if="screen.states.length > 0"
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
          v-if="showPreview"
          :html="snapshotHtml"
          :item-order="displayItemOrder"
          :selected-item-id="selectedItemId"
          :stylesheets="stylesheets"
          :preview-css="previewCss"
          :document-context="currentDocumentContext"
          @select="onSelectItem"
        />
        <div v-else class="spec-page__no-preview" data-testid="no-preview">
          <p>この画面はまだ実装画面と連携されていません。</p>
          <p>基本情報は先に編集できます。</p>
          <p>実装後に <code>jskim spec collect</code> を実行すると Preview が表示されます。</p>
        </div>
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
          <div class="spec-page__section-header">
            <h2 class="spec-page__section-title">項目定義</h2>
            <button
              v-if="editor.editingEnabled"
              type="button"
              class="spec-page__btn spec-page__btn--secondary"
              @click="openCreateItem"
            >
              ＋ 項目を追加
            </button>
          </div>
          <ItemDescriptionTable
            :screen="screen"
            :selected-item-id="selectedItemId"
            :editable="editor.editingEnabled"
            :draft-items="editor.draftDocument.value?.items || null"
            :item-order="editor.editingEnabled ? displayItemOrder : null"
            :collected-item-ids="
              editor.editingEnabled ? editor.collectedItemIds.value : null
            "
            @select="onSelectItem"
            @change-state="onSelectState"
            @update-item="
              (itemId, field, value) => editor.updateItemField(itemId, field, value)
            "
            @move-up="editor.moveItemUp"
            @move-down="editor.moveItemDown"
            @duplicate="openDuplicateItem"
            @remove="openDeleteItem"
            @exclude="openExcludeItem"
          />

          <ExcludedItemsPanel
            v-if="
              editor.editingEnabled &&
              editor.draftDocument.value &&
              Object.keys(editor.draftDocument.value.excludedItems || {}).length >
                0
            "
            :excluded-items="editor.draftDocument.value.excludedItems"
            :collected-item-ids="editor.collectedItemIds.value"
            @restore="onRestoreExcludedItem"
          />
        </section>
      </div>
    </div>

    <CreateItemDialog
      v-if="createItemDialogOpen"
      :existing-item-ids="existingItemIdsForCreate"
      @close="closeCreateItem"
      @create="onCreateItem"
    />

    <DuplicateItemDialog
      v-if="duplicateSourceItem"
      :existing-item-ids="existingItemIdsForCreate"
      :source-item-id="duplicateSourceItem.itemId"
      :initial-name="duplicateSourceItem.name"
      :initial-type="duplicateSourceItem.type"
      :initial-description="duplicateSourceItem.description"
      :initial-note="duplicateSourceItem.note"
      @close="closeDuplicateItem"
      @create="onDuplicateItem"
    />

    <DeleteItemDialog
      v-if="deleteTargetItem"
      :item-id="deleteTargetItem.itemId"
      :item-name="deleteTargetItem.name"
      @close="closeDeleteItem"
      @confirm="onConfirmDeleteItem"
    />

    <ExcludeItemDialog
      v-if="excludeTargetItem"
      :item-id="excludeTargetItem.itemId"
      :item-name="excludeTargetItem.name"
      @close="closeExcludeItem"
      @confirm="onConfirmExcludeItem"
    />
  </div>
</template>
