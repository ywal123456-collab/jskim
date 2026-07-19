<script setup lang="ts">
import { computed, inject, nextTick, ref, watch, type ComputedRef } from 'vue';
import DomPreview, {
  type PreviewStylesheet,
} from '../components/DomPreview.vue';
import StateSelector from '../components/StateSelector.vue';
import PreviewProviderTabs from '../components/PreviewProviderTabs.vue';
import DeviceCapturePanel from '../components/DeviceCapturePanel.vue';
import ReferenceImagePanel from '../components/ReferenceImagePanel.vue';
import ItemDescriptionTable from '../components/ItemDescriptionTable.vue';
import CreateItemDialog from '../components/CreateItemDialog.vue';
import DuplicateItemDialog from '../components/DuplicateItemDialog.vue';
import DeleteItemDialog from '../components/DeleteItemDialog.vue';
import ExcludeItemDialog from '../components/ExcludeItemDialog.vue';
import ExcludedItemsPanel from '../components/ExcludedItemsPanel.vue';
import DuplicateScreenDialog from '../components/DuplicateScreenDialog.vue';
import DeleteScreenDialog from '../components/DeleteScreenDialog.vue';
import { useDescriptionEditor } from '../editing/useDescriptionEditor';
import { useDeviceCapturePanel } from '../preview/useDeviceCapturePanel';
import { useReferenceImagePanel } from '../preview/useReferenceImagePanel';
import {
  listAvailablePreviewProviders,
  readPreferredPreviewProvider,
  resolveEffectivePreviewProvider,
  writePreferredPreviewProvider,
  type DeviceCaptureViewport,
  type PreviewProvider,
  type ReferenceViewport,
} from '../preview/preview-provider';
import {
  resolveInitialReferenceViewport,
  writeReferenceViewport,
} from '../preview/reference-viewport';
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
const preferredProvider = ref<PreviewProvider>('live');
const referenceViewport = ref<ReferenceViewport>('pc');
const referencePanelRef = ref<{
  closeUpload: () => void;
  closeDelete: () => void;
  closeFigma: () => void;
} | null>(null);
const previewTabsIdPrefix = 'screen-preview';
const createItemDialogOpen = ref(false);
const duplicateSourceItemId = ref<string | null>(null);
const deleteTargetItemId = ref<string | null>(null);
const excludeTargetItemId = ref<string | null>(null);
const duplicateScreenDialogOpen = ref(false);
const deleteScreenDialogOpen = ref(false);
const deleteSuccessMessage = ref('');

const editor = useDescriptionEditor(() => props.screenId);

const projectName = computed(
  () => manifest?.value.projectName || 'default',
);

const viewerBaseUrl = computed(() => import.meta.env.BASE_URL);

/** LINKED / IMPLEMENTATION_ONLY で Live/PC/SP を出す */
const canShowDeviceTabs = computed(
  () =>
    Boolean(screen.value?.hasPreview) &&
    (screen.value?.states.length ?? 0) > 0,
);

/**
 * 参照タブ:
 * - editable: 常に表示（DESIGN_ONLY の upload 入口含む）
 * - LINKED / IMPLEMENTATION_ONLY read-only: 常に表示（missing 案内含む）
 * - DESIGN_ONLY read-only: current/invalid があるときのみ
 */
const canShowReferenceTab = computed(() => {
  if (!screen.value || props.screenId === '_empty') {
    return false;
  }
  if (editor.editingEnabled) {
    return true;
  }
  if (canShowDeviceTabs.value) {
    return true;
  }
  const refs = screen.value.referenceImages;
  if (!refs) {
    return false;
  }
  const visible = (entry: { status: string }) =>
    entry.status === 'current' || entry.status === 'invalid';
  return visible(refs.pc) || visible(refs.sp);
});

const availableProviders = computed(() =>
  listAvailablePreviewProviders({
    canShowDeviceTabs: canShowDeviceTabs.value,
    canShowReferenceTab: canShowReferenceTab.value,
  }),
);

const showPreviewTabs = computed(() => availableProviders.value.length > 0);

const showNoPreview = computed(
  () => !showPreviewTabs.value && !canShowDeviceTabs.value,
);

const effectiveProvider = computed<PreviewProvider>(() =>
  resolveEffectivePreviewProvider(preferredProvider.value, {
    canShowDeviceTabs: canShowDeviceTabs.value,
    canShowReferenceTab: canShowReferenceTab.value,
  }),
);

const captureViewport = computed<DeviceCaptureViewport | null>(() => {
  if (effectiveProvider.value === 'pc' || effectiveProvider.value === 'sp') {
    return effectiveProvider.value;
  }
  return null;
});

const activeReferenceViewport = computed<ReferenceViewport | null>(() => {
  if (effectiveProvider.value !== 'reference') {
    return null;
  }
  return referenceViewport.value;
});

const currentStateName = computed(() => {
  const state = screen.value?.states.find((s) => s.id === selectedStateId.value);
  return state?.name || selectedStateId.value;
});

const captureDisabledReason = computed(() => {
  if (!screen.value?.hasImplementation) {
    return '実装画面がないため収集できません。';
  }
  if (!selectedStateId.value) {
    return '状態が選択されていません。';
  }
  if (duplicateScreenDialogOpen.value || deleteScreenDialogOpen.value) {
    return '画面操作が完了するまで収集できません。';
  }
  return '';
});

const referenceBlocked = computed(
  () => duplicateScreenDialogOpen.value || deleteScreenDialogOpen.value,
);

function screenDataUrl(screenId: string): string {
  const base = import.meta.env.BASE_URL;
  const entry = manifest?.value.screens.find((s) => s.id === screenId);
  if (!entry) {
    return `${base}data/screens/${screenId}.json`;
  }
  return `${base}data/${entry.dataFile}`;
}

async function reloadScreenData(): Promise<void> {
  if (!screen.value || props.screenId === '_empty') {
    return;
  }
  const base = import.meta.env.BASE_URL;
  const entry = manifest?.value.screens.find((s) => s.id === props.screenId);
  if (!entry) {
    return;
  }
  try {
    const screenRes = await fetch(`${base}data/${entry.dataFile}`, {
      cache: 'no-store',
    });
    if (!screenRes.ok) {
      return;
    }
    const data = (await screenRes.json()) as ScreenData;
    const prevState = selectedStateId.value;
    screen.value = data;
    if (prevState && data.states.some((s) => s.id === prevState)) {
      selectedStateId.value = prevState;
    } else {
      const firstVisible =
        data.states.find((s) => s.viewer.visible) || data.states[0];
      selectedStateId.value = firstVisible?.id ?? '';
      if (selectedStateId.value) {
        await loadSnapshot(selectedStateId.value);
      }
    }
  } catch {
    // ignore transient reload errors
  }
}

const deviceCapture = useDeviceCapturePanel({
  projectName: () => projectName.value,
  screenId: () => props.screenId,
  stateId: () => selectedStateId.value,
  viewport: () => captureViewport.value,
  screen: () => screen.value,
  editable: () => Boolean(editor.editingEnabled),
  reloadScreen: reloadScreenData,
  screenDataUrl,
});

const referenceImage = useReferenceImagePanel({
  projectName: () => projectName.value,
  screenId: () => props.screenId,
  viewport: () => activeReferenceViewport.value,
  active: () => effectiveProvider.value === 'reference',
  screen: () => screen.value,
  editable: () => Boolean(editor.editingEnabled),
  blocked: () => referenceBlocked.value,
  reloadScreen: reloadScreenData,
  screenDataUrl,
});

function onPreviewProviderChange(next: PreviewProvider): void {
  preferredProvider.value = next;
  writePreferredPreviewProvider(projectName.value, next);
}

function onReferenceViewportChange(next: ReferenceViewport): void {
  referenceViewport.value = next;
  writeReferenceViewport(projectName.value, next);
}

function initPreferredProvider(): void {
  preferredProvider.value = readPreferredPreviewProvider(projectName.value);
}

function initReferenceViewport(): void {
  referenceViewport.value = resolveInitialReferenceViewport({
    projectName: projectName.value,
    editable: Boolean(editor.editingEnabled),
    referenceImages: screen.value?.referenceImages,
  });
}

async function onReferenceUpload(payload: {
  file: File;
  expectedImageRevision: string | null;
}): Promise<void> {
  const result = await referenceImage.uploadOrReplace(payload);
  if (result.ok) {
    referencePanelRef.value?.closeUpload();
  } else if (!('keepDialog' in result) || !result.keepDialog) {
    referencePanelRef.value?.closeUpload();
  }
}

async function onReferenceDelete(expectedImageRevision: string): Promise<void> {
  referencePanelRef.value?.closeDelete();
  await referenceImage.deleteCurrent(expectedImageRevision);
}

async function onReferenceFigmaImport(payload: {
  figmaUrl: string;
  expectedImageRevision: string | null;
  confirmWidthMismatch: boolean;
}): Promise<void> {
  const result = await referenceImage.importFromFigma(payload);
  if (result.ok) {
    referencePanelRef.value?.closeFigma();
  } else if (result.confirmation) {
    // dialog を維持して幅確認 UI を表示
    return;
  } else if (!result.keepDialog) {
    referencePanelRef.value?.closeFigma();
  }
}

async function onReferenceFigmaReimport(payload: {
  expectedImageRevision: string;
  confirmWidthMismatch: boolean;
}): Promise<void> {
  const result = await referenceImage.reimportFromFigma(payload);
  if (result.ok) {
    referencePanelRef.value?.closeFigma();
  } else if (result.confirmation) {
    return;
  } else if (!result.keepDialog) {
    referencePanelRef.value?.closeFigma();
  }
}

initPreferredProvider();
initReferenceViewport();

/** Description ファイルがある DESIGN_ONLY / LINKED のみ削除 action を出す */
const canDeleteScreenDescription = computed(() => {
  if (!editor.editingEnabled || !screen.value) {
    return false;
  }
  if (!screen.value.hasDescription) {
    return false;
  }
  return (
    screen.value.status === 'design-only' || screen.value.status === 'linked'
  );
});

const deleteScreenBlockedReason = computed(() => {
  if (editor.dirty.value) {
    return '画面設計を削除する前に、編集中の変更を保存またはキャンセルしてください。';
  }
  if (editor.saving.value) {
    return '保存が完了するまで画面設計を削除できません。';
  }
  if (duplicateScreenDialogOpen.value) {
    return '画面の複製が完了するまで画面設計を削除できません。';
  }
  if (deleteScreenDialogOpen.value) {
    return '画面設計の削除処理中です。';
  }
  if (!editor.revision.value) {
    return '画面設計書の revision を取得できていません。再読み込みしてください。';
  }
  return '';
});

const deleteScreenDisabled = computed(
  () => Boolean(deleteScreenBlockedReason.value),
);

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
  initReferenceViewport();

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

function openDuplicateScreen(): void {
  if (editor.dirty.value || editor.saving.value || deleteScreenDialogOpen.value) {
    return;
  }
  duplicateScreenDialogOpen.value = true;
}

function closeDuplicateScreen(): void {
  duplicateScreenDialogOpen.value = false;
}

function openDeleteScreen(): void {
  if (deleteScreenDisabled.value || !canDeleteScreenDescription.value) {
    return;
  }
  deleteSuccessMessage.value = '';
  deleteScreenDialogOpen.value = true;
}

function closeDeleteScreen(): void {
  deleteScreenDialogOpen.value = false;
}

async function onDeleteScreenCompleted(payload: {
  kind: 'design-only' | 'linked';
}): Promise<void> {
  deleteScreenDialogOpen.value = false;
  if (payload.kind === 'linked') {
    deleteSuccessMessage.value =
      '画面設計書を削除しました。この画面は「実装のみ」として残ります。';
    await loadScreen(props.screenId);
    return;
  }
  deleteSuccessMessage.value = '画面設計を削除しました。';
}

function onDeleteReloadLatest(): void {
  deleteScreenDialogOpen.value = false;
  void editor.reloadLatest();
}

/** 複製元は保存済み（loaded）内容。dirty draft は使わない */
const duplicateSourceMeta = computed(() => {
  const loaded = editor.loadedDocument.value;
  if (loaded) {
    return {
      name: loaded.screen.name || screen.value?.name || props.screenId,
      description: loaded.screen.description || '',
    };
  }
  return {
    name: screen.value?.name || props.screenId,
    description: '',
  };
});

const deleteDialogScreenName = computed(() => {
  const loaded = editor.loadedDocument.value;
  if (loaded?.screen.name) {
    return loaded.screen.name;
  }
  return screen.value?.name || props.screenId;
});

const deleteDialogStatus = computed((): 'design-only' | 'linked' => {
  if (screen.value?.status === 'linked') {
    return 'linked';
  }
  return 'design-only';
});

watch(
  () => props.screenId,
  (id) => {
    deleteSuccessMessage.value = '';
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
          class="spec-page__btn spec-page__btn--secondary"
          data-action="duplicate-screen"
          :disabled="
            editor.dirty.value ||
            editor.saving.value ||
            deleteScreenDialogOpen
          "
          :title="
            editor.dirty.value
              ? '画面を複製する前に、編集中の変更を保存してください。'
              : '画面を複製'
          "
          @click="openDuplicateScreen"
        >
          画面を複製
        </button>
        <button
          v-if="canDeleteScreenDescription"
          type="button"
          class="spec-page__btn spec-page__btn--danger"
          data-action="delete-screen"
          :disabled="deleteScreenDisabled"
          :title="deleteScreenBlockedReason || '画面設計を削除'"
          :aria-label="deleteScreenBlockedReason || '画面設計を削除'"
          @click="openDeleteScreen"
        >
          画面設計を削除
        </button>
        <button
          type="button"
          class="spec-page__btn"
          :disabled="
            !editor.dirty.value ||
            editor.saving.value ||
            deleteScreenDialogOpen
          "
          @click="editor.save()"
        >
          保存
        </button>
        <button
          type="button"
          class="spec-page__btn spec-page__btn--secondary"
          :disabled="
            !editor.dirty.value ||
            editor.saving.value ||
            deleteScreenDialogOpen
          "
          @click="onCancelEdits"
        >
          キャンセル
        </button>
      </div>
    </header>

    <div
      v-if="deleteSuccessMessage"
      class="spec-page__banner"
      data-status="saved"
      role="status"
    >
      <p>{{ deleteSuccessMessage }}</p>
    </div>

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
      v-if="screen.states.length > 0 && effectiveProvider !== 'reference'"
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
      <aside id="section-preview" class="spec-page__preview-pane" aria-label="プレビュー">
        <div class="spec-page__preview-header">
          <h2 class="spec-page__section-title">Preview</h2>
          <PreviewProviderTabs
            v-if="showPreviewTabs"
            :model-value="effectiveProvider"
            :providers="availableProviders"
            :id-prefix="previewTabsIdPrefix"
            data-testid="preview-provider-tabs"
            @update:model-value="onPreviewProviderChange"
          />
        </div>

        <template v-if="showPreviewTabs">
          <div
            v-show="effectiveProvider === 'live' && canShowDeviceTabs"
            :id="`${previewTabsIdPrefix}-panel-live`"
            role="tabpanel"
            :aria-labelledby="`${previewTabsIdPrefix}-tab-live`"
            data-testid="preview-panel-live"
          >
            <DomPreview
              :html="snapshotHtml"
              :item-order="displayItemOrder"
              :selected-item-id="selectedItemId"
              :stylesheets="stylesheets"
              :preview-css="previewCss"
              :document-context="currentDocumentContext"
              @select="onSelectItem"
            />
          </div>
          <DeviceCapturePanel
            v-if="captureViewport"
            :viewport="captureViewport"
            :screen-name="displayName || screen.id"
            :state-name="currentStateName"
            :capture="deviceCapture.persistedCapture.value"
            :runtime="deviceCapture.runtime.value"
            :editable="editor.editingEnabled"
            :collecting="deviceCapture.isCollecting.value"
            :status-message="deviceCapture.statusMessage.value"
            :error-message="deviceCapture.errorMessage.value"
            :info-message="deviceCapture.infoMessage.value"
            :image-base-url="viewerBaseUrl"
            :panel-id="`${previewTabsIdPrefix}-panel-${captureViewport}`"
            :labelled-by="`${previewTabsIdPrefix}-tab-${captureViewport}`"
            :disabled-reason="captureDisabledReason"
            @collect="deviceCapture.collectCurrent()"
          />
          <ReferenceImagePanel
            v-if="effectiveProvider === 'reference'"
            ref="referencePanelRef"
            :viewport="referenceViewport"
            :screen-name="displayName || screen.id"
            :reference="referenceImage.persistedReference.value"
            :runtime="referenceImage.runtime.value"
            :editable="editor.editingEnabled"
            :busy="referenceImage.isBusy.value"
            :actions-disabled="referenceImage.actionsDisabled.value"
            :status-message="referenceImage.statusMessage.value"
            :error-message="referenceImage.errorMessage.value"
            :info-message="referenceImage.infoMessage.value"
            :dialog-error="referenceImage.dialogError.value"
            :figma-confirmation="referenceImage.figmaConfirmation.value"
            :image-base-url="viewerBaseUrl"
            :panel-id="`${previewTabsIdPrefix}-panel-reference`"
            :labelled-by="`${previewTabsIdPrefix}-tab-reference`"
            @update:viewport="onReferenceViewportChange"
            @upload="onReferenceUpload"
            @delete="onReferenceDelete"
            @figma-import="onReferenceFigmaImport"
            @figma-reimport="onReferenceFigmaReimport"
            @clear-dialog-error="referenceImage.clearDialogError()"
            @abort-figma="referenceImage.abortFigmaDialogRequest()"
            @clear-figma-confirmation="referenceImage.clearFigmaConfirmation()"
          />
        </template>
        <div v-else-if="showNoPreview" class="spec-page__no-preview" data-testid="no-preview">
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

    <DuplicateScreenDialog
      v-if="duplicateScreenDialogOpen"
      :copy-from-screen-id="props.screenId"
      :source-name="duplicateSourceMeta.name"
      :source-description="duplicateSourceMeta.description"
      :source-dirty="editor.dirty.value"
      @close="closeDuplicateScreen"
    />

    <DeleteScreenDialog
      v-if="deleteScreenDialogOpen && canDeleteScreenDescription"
      :screen-id="props.screenId"
      :screen-name="deleteDialogScreenName"
      :status="deleteDialogStatus"
      :source-dirty="editor.dirty.value"
      :source-saving="editor.saving.value"
      :expected-revision="editor.revision.value"
      @close="closeDeleteScreen"
      @completed="onDeleteScreenCompleted"
      @reload-latest="onDeleteReloadLatest"
    />
  </div>
</template>
