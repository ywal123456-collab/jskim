import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { fetchDescriptionTree } from './description-tree-client.js';
import {
  cloneItemFields,
  findItemSiblingContext,
  flattenActiveItemIds,
  itemFieldsEqual,
  nodeExistsInActiveTree,
  resolveDuplicatePlacement,
  snapshotToEditableDocument,
  swapSiblingOrder,
  type ItemFields,
} from './description-editor-helpers.js';
import * as mutationClient from './description-mutation-client.js';
import type { DescriptionTreeGetResponse } from './description-tree-types.js';
import {
  cloneEditableDocument,
  getSpecEditBootstrap,
  type DescriptionApiError,
  type EditableDocument,
} from './types';

export type SaveStatus =
  | 'idle'
  | 'clean'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'error'
  | 'conflict'
  | 'reload-failed';

export type DescriptionTreePanelStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error';

/** Description Tree GET の意図。 */
export type LoadDescriptionReason =
  | 'initial-load'
  | 'screen-change'
  | 'same-screen-reload';

/** mutation 後 snapshot 適用時の draft 整理範囲。 */
export type SnapshotDraftScope = 'full' | 'none' | 'screen' | 'item';

/** Description mutation の結果（サーバー commit と Tree refresh を区別）。 */
export type DescriptionMutationOutcome =
  | { status: 'committed-refreshed' }
  | { status: 'committed-refresh-failed' }
  | { status: 'mutation-rejected' }
  | { status: 'commit-unknown' }
  | { status: 'stale-or-aborted' };

type MutationIdentity = {
  seq: number;
  screenId: string;
};

/**
 * Description 編集 state（Item Tree GET を SoT、mutation API で永続化）。
 */
export function useDescriptionEditor(screenIdRef: () => string) {
  const bootstrap = getSpecEditBootstrap();
  const editingEnabled = Boolean(bootstrap);

  const snapshot = shallowRef<DescriptionTreeGetResponse | null>(null);
  const treeStatus = ref<DescriptionTreePanelStatus>('idle');
  const treeError = ref('');
  const screenDraft = ref<{ name?: string; description?: string } | null>(null);
  const itemDraftItemId = ref<string | null>(null);
  const itemDraft = ref<ItemFields | null>(null);
  const status = ref<SaveStatus>('idle');
  const statusMessage = ref('');
  const conflictError = ref<DescriptionApiError | null>(null);
  const mutationPending = ref(false);
  const reloadFailed = ref(false);
  const reloadRequired = ref(false);

  let lifecycleGeneration = 0;
  let componentMounted = true;
  let loadSeq = 0;
  let mutationSeq = 0;
  let loadAbort: AbortController | null = null;
  let mutationAbort: AbortController | null = null;
  let mutationRefreshAbort: AbortController | null = null;
  let activeScreenId = '';
  let activeMutation: MutationIdentity | null = null;

  const revision = computed(() => snapshot.value?.revision ?? null);
  const collectedItemIds = computed(
    () => snapshot.value?.collectedItemIds ?? [],
  );

  const draftDocument = computed<EditableDocument | null>(() => {
    if (!snapshot.value) {
      return null;
    }
    const base = snapshotToEditableDocument(snapshot.value);
    if (screenDraft.value?.name !== undefined) {
      base.screen.name = screenDraft.value.name;
    }
    if (screenDraft.value?.description !== undefined) {
      base.screen.description = screenDraft.value.description;
    }
    if (itemDraftItemId.value && itemDraft.value && base.items[itemDraftItemId.value]) {
      base.items[itemDraftItemId.value] = { ...itemDraft.value };
    }
    return base;
  });

  const screenDirty = computed(() => {
    if (!snapshot.value || !screenDraft.value) {
      return false;
    }
    const current = snapshot.value.description.screen;
    if (
      screenDraft.value.name !== undefined &&
      screenDraft.value.name !== current.name
    ) {
      return true;
    }
    if (
      screenDraft.value.description !== undefined &&
      screenDraft.value.description !== current.description
    ) {
      return true;
    }
    return false;
  });

  const itemDirty = computed(() => {
    if (!snapshot.value || !itemDraftItemId.value || !itemDraft.value) {
      return false;
    }
    const current = snapshot.value.description.items[itemDraftItemId.value];
    if (!current) {
      return false;
    }
    return !itemFieldsEqual(itemDraft.value, current);
  });

  const dirty = computed(() => screenDirty.value || itemDirty.value);
  const saving = computed(() => mutationPending.value);

  function isEditorLifecycleActive(generation: number): boolean {
    return componentMounted && generation === lifecycleGeneration;
  }

  function isActiveMutationIdentity(identity: MutationIdentity): boolean {
    return (
      componentMounted &&
      activeMutation !== null &&
      activeMutation.seq === identity.seq &&
      activeMutation.screenId === identity.screenId &&
      identity.screenId === screenIdRef()
    );
  }

  function invalidateEditorLifecycle(): void {
    lifecycleGeneration += 1;
    loadSeq += 1;
    mutationSeq += 1;
    loadAbort?.abort();
    mutationAbort?.abort();
    mutationRefreshAbort?.abort();
    activeMutation = null;
    mutationPending.value = false;
    reloadRequired.value = false;
    reloadFailed.value = false;
  }

  function invalidateForScreenChange(nextScreenId: string): void {
    invalidateEditorLifecycle();
    activeScreenId = nextScreenId;
  }

  function clearDrafts(): void {
    screenDraft.value = null;
    itemDraftItemId.value = null;
    itemDraft.value = null;
  }

  function clearScreenDraft(): void {
    screenDraft.value = null;
  }

  function clearItemDraft(): void {
    itemDraftItemId.value = null;
    itemDraft.value = null;
  }

  function reconcileItemDraftWithSnapshot(): void {
    const draftId = itemDraftItemId.value;
    if (!draftId || !snapshot.value) {
      return;
    }
    if (!snapshot.value.description.items[draftId]) {
      clearItemDraft();
    }
  }

  function syncStatusAfterSnapshotApply(draftScope: SnapshotDraftScope): void {
    if (status.value === 'conflict') {
      return;
    }
    if (draftScope === 'full') {
      status.value = 'clean';
      return;
    }
    status.value = dirty.value ? 'dirty' : 'clean';
  }

  function applySnapshot(
    data: DescriptionTreeGetResponse,
    options?: { draftScope?: SnapshotDraftScope },
  ): void {
    if (!componentMounted) {
      return;
    }
    const draftScope = options?.draftScope ?? 'full';
    const preservedScreenDraft =
      draftScope === 'none' || draftScope === 'item'
        ? screenDraft.value
          ? { ...screenDraft.value }
          : null
        : null;
    const preservedItemDraftItemId =
      draftScope === 'none' || draftScope === 'screen'
        ? itemDraftItemId.value
        : null;
    const preservedItemDraft =
      draftScope === 'none' || draftScope === 'screen'
        ? itemDraft.value
          ? { ...itemDraft.value }
          : null
        : null;

    snapshot.value = data;

    if (draftScope === 'full') {
      clearDrafts();
    } else if (draftScope === 'screen') {
      clearScreenDraft();
    } else if (draftScope === 'item') {
      clearItemDraft();
      if (preservedScreenDraft) {
        screenDraft.value = preservedScreenDraft;
      }
    } else if (draftScope === 'none') {
      if (preservedScreenDraft) {
        screenDraft.value = preservedScreenDraft;
      }
      if (preservedItemDraftItemId && preservedItemDraft) {
        itemDraftItemId.value = preservedItemDraftItemId;
        itemDraft.value = preservedItemDraft;
      }
    }

    reconcileItemDraftWithSnapshot();

    treeStatus.value =
      data.description.rootNodes.length === 0 ? 'empty' : 'ready';
    treeError.value = '';
    syncStatusAfterSnapshotApply(draftScope);
  }

  async function reloadTreeAfterMutation(
    screenId: string,
    identity: MutationIdentity,
    draftScope: SnapshotDraftScope = 'none',
  ): Promise<DescriptionMutationOutcome> {
    mutationRefreshAbort?.abort();
    mutationRefreshAbort = new AbortController();
    const refreshSignal = mutationRefreshAbort.signal;
    const refreshGeneration = lifecycleGeneration;

    const result = await fetchDescriptionTree(screenId, refreshSignal, fetch);

    if (!isActiveMutationIdentity(identity)) {
      return { status: 'stale-or-aborted' };
    }
    if (!isEditorLifecycleActive(refreshGeneration)) {
      return { status: 'stale-or-aborted' };
    }
    if (result.aborted) {
      return { status: 'stale-or-aborted' };
    }
    if (!result.ok) {
      reloadFailed.value = true;
      reloadRequired.value = true;
      status.value = 'reload-failed';
      statusMessage.value =
        '保存されましたが、最新内容を再読み込みできませんでした。';
      return { status: 'committed-refresh-failed' };
    }
    reloadFailed.value = false;
    reloadRequired.value = false;
    applySnapshot(result.data, { draftScope });
    statusMessage.value = '保存しました。';
    if (dirty.value) {
      status.value = 'dirty';
    } else {
      status.value = 'saved';
    }
    return { status: 'committed-refreshed' };
  }

  function handleMutationError(
    error: mutationClient.DescriptionMutationError,
    identity: MutationIdentity,
  ): DescriptionMutationOutcome {
    if (!isActiveMutationIdentity(identity)) {
      return { status: 'stale-or-aborted' };
    }
    if (error.code === 'SPEC_DESCRIPTION_REVISION_CONFLICT') {
      conflictError.value = {
        code: error.code,
        message: error.message,
        expectedRevision: error.expectedRevision,
        currentRevision: error.currentRevision,
      };
      status.value = 'conflict';
      statusMessage.value = mutationClient.sanitizeMutationMessage(error);
      return { status: 'mutation-rejected' };
    }
    if (mutationClient.isDefiniteMutationRejection(error)) {
      status.value = 'error';
      statusMessage.value = mutationClient.sanitizeMutationMessage(error);
      return { status: 'mutation-rejected' };
    }
    reloadRequired.value = true;
    reloadFailed.value = true;
    status.value = 'reload-failed';
    statusMessage.value =
      '保存結果を確認できませんでした。最新内容を再読み込みしてください。';
    return { status: 'commit-unknown' };
  }

  function tryBeginMutation(screenId: string): MutationIdentity | null {
    if (
      !editingEnabled ||
      mutationPending.value ||
      reloadRequired.value ||
      !revision.value
    ) {
      return null;
    }
    mutationAbort?.abort();
    mutationAbort = new AbortController();
    const identity: MutationIdentity = {
      seq: ++mutationSeq,
      screenId,
    };
    activeMutation = identity;
    mutationPending.value = true;
    statusMessage.value = '';
    conflictError.value = null;
    reloadFailed.value = false;
    status.value = 'saving';
    activeScreenId = screenId;
    return identity;
  }

  function finishMutation(identity: MutationIdentity): void {
    if (!isActiveMutationIdentity(identity)) {
      return;
    }
    activeMutation = null;
    mutationPending.value = false;
  }

  async function runMutation(
    screenId: string,
    action: (
      expectedRevision: string,
      signal: AbortSignal,
    ) => Promise<
      | { ok: true; data: mutationClient.DescriptionMutationResult }
      | { ok: false; error: mutationClient.DescriptionMutationError; aborted?: boolean }
    >,
    draftScope: SnapshotDraftScope = 'none',
  ): Promise<DescriptionMutationOutcome> {
    const identity = tryBeginMutation(screenId);
    if (!identity) {
      return { status: 'mutation-rejected' };
    }

    try {
      const result = await action(revision.value!, mutationAbort!.signal);
      if (!isActiveMutationIdentity(identity)) {
        return { status: 'stale-or-aborted' };
      }
      if (!result.ok) {
        if (result.aborted) {
          return { status: 'stale-or-aborted' };
        }
        return handleMutationError(result.error, identity);
      }
      return await reloadTreeAfterMutation(screenId, identity, draftScope);
    } finally {
      finishMutation(identity);
    }
  }

  async function loadDescription(
    screenId: string,
    options?: { reason?: LoadDescriptionReason },
  ): Promise<void> {
    if (!editingEnabled) {
      return;
    }

    const reason = options?.reason ?? 'initial-load';

    if (reason === 'same-screen-reload') {
      if (mutationPending.value || activeScreenId !== screenId) {
        return;
      }
    } else if (reason === 'screen-change') {
      invalidateForScreenChange(screenId);
    } else {
      activeScreenId = screenId;
    }

    const loadGeneration = lifecycleGeneration;
    loadAbort?.abort();
    loadAbort = new AbortController();
    const seq = ++loadSeq;
    treeStatus.value = 'loading';
    treeError.value = '';
    snapshot.value = null;
    clearDrafts();
    conflictError.value = null;
    statusMessage.value = '';

    const result = await fetchDescriptionTree(
      screenId,
      loadAbort.signal,
      fetch,
    );
    if (
      !isEditorLifecycleActive(loadGeneration) ||
      seq !== loadSeq ||
      activeScreenId !== screenIdRef()
    ) {
      return;
    }
    if (!result.ok) {
      if (result.aborted) {
        return;
      }
      treeStatus.value = 'error';
      treeError.value = result.error.message || '画面設計書の読み込みに失敗しました。';
      status.value = 'error';
      statusMessage.value = treeError.value;
      return;
    }
    applySnapshot(result.data);
    reloadRequired.value = false;
    reloadFailed.value = false;
  }

  function isCollectedItem(itemId: string): boolean {
    return collectedItemIds.value.includes(itemId);
  }

  async function saveScreenMetadata(): Promise<DescriptionMutationOutcome> {
    if (!screenDirty.value || !snapshot.value) {
      return { status: 'committed-refreshed' };
    }
    const screenId = screenIdRef();
    const payload: { name?: string; description?: string } = {};
    if (screenDraft.value?.name !== undefined) {
      payload.name = screenDraft.value.name;
    }
    if (screenDraft.value?.description !== undefined) {
      payload.description = screenDraft.value.description;
    }
    return runMutation(
      screenId,
      (expectedRevision, signal) =>
        mutationClient.updateDescriptionScreen(
          screenId,
          { expectedRevision, ...payload },
          fetch,
          signal,
        ),
      'screen',
    );
  }

  async function saveItemMetadata(itemId: string): Promise<DescriptionMutationOutcome> {
    if (!itemDirty.value || itemDraftItemId.value !== itemId || !itemDraft.value) {
      return { status: 'committed-refreshed' };
    }
    const screenId = screenIdRef();
    const fields = itemDraft.value;
    return runMutation(
      screenId,
      (expectedRevision, signal) =>
        mutationClient.updateDescriptionItem(
          screenId,
          itemId,
          {
            expectedRevision,
            name: fields.name,
            type: fields.type,
            description: fields.description,
            note: fields.note,
          },
          fetch,
          signal,
        ),
      'item',
    );
  }

  /** @deprecated 互換のため残す。screen + 選択 Item を順に保存。 */
  async function save(): Promise<DescriptionMutationOutcome> {
    if (screenDirty.value) {
      const screenOutcome = await saveScreenMetadata();
      if (screenOutcome.status !== 'committed-refreshed') {
        return screenOutcome;
      }
    }
    if (itemDraftItemId.value && itemDirty.value) {
      return saveItemMetadata(itemDraftItemId.value);
    }
    return { status: 'committed-refreshed' };
  }

  function cancel(): void {
    clearDrafts();
    conflictError.value = null;
    if (!reloadRequired.value) {
      reloadFailed.value = false;
      status.value = snapshot.value ? 'clean' : 'idle';
    }
    statusMessage.value = '';
  }

  function cancelItemEdit(): void {
    itemDraftItemId.value = null;
    itemDraft.value = null;
    if (!screenDirty.value && status.value !== 'conflict') {
      status.value = 'clean';
    }
  }

  async function reloadLatest(): Promise<void> {
    await loadDescription(screenIdRef(), { reason: 'same-screen-reload' });
  }

  function updateScreenField(
    field: 'name' | 'description',
    value: string,
  ): void {
    if (!snapshot.value) {
      return;
    }
    const current = screenDraft.value ?? {};
    screenDraft.value = { ...current, [field]: value };
    if (status.value !== 'conflict') {
      status.value = 'dirty';
    }
  }

  function beginItemEdit(itemId: string): void {
    if (!snapshot.value?.description.items[itemId]) {
      return;
    }
    itemDraftItemId.value = itemId;
    itemDraft.value = cloneItemFields(snapshot.value.description.items[itemId]);
  }

  function updateItemField(
    itemId: string,
    field: 'name' | 'type' | 'description' | 'note',
    value: string,
  ): void {
    if (!snapshot.value?.description.items[itemId]) {
      return;
    }
    if (itemDraftItemId.value !== itemId || !itemDraft.value) {
      beginItemEdit(itemId);
    }
    if (!itemDraft.value) {
      return;
    }
    itemDraft.value = { ...itemDraft.value, [field]: value };
    if (status.value !== 'conflict') {
      status.value = 'dirty';
    }
  }

  async function createItem(payload: {
    itemId: string;
    name: string;
    type: string;
    description: string;
    note: string;
    parentGroupId?: string | null;
    insertIndex?: number;
  }): Promise<DescriptionMutationOutcome> {
    const screenId = screenIdRef();
    return runMutation(screenId, (expectedRevision, signal) =>
      mutationClient.createDescriptionItem(
        screenId,
        { expectedRevision, ...payload },
        fetch,
        signal,
      ),
    );
  }

  async function duplicateItem(
    sourceItemId: string,
    item: {
      itemId: string;
      name: string;
      type: string;
      description: string;
      note: string;
    },
  ): Promise<DescriptionMutationOutcome> {
    if (!snapshot.value) {
      status.value = 'error';
      statusMessage.value = '複製元の配置を特定できませんでした。';
      return { status: 'mutation-rejected' };
    }
    const placement = resolveDuplicatePlacement(snapshot.value, sourceItemId);
    if (!placement) {
      status.value = 'error';
      statusMessage.value = '複製元の配置を特定できませんでした。';
      return { status: 'mutation-rejected' };
    }
    if (!revision.value) {
      status.value = 'error';
      statusMessage.value = '画面設計書の revision が取得できません。';
      return { status: 'mutation-rejected' };
    }
    if (mutationPending.value || reloadRequired.value) {
      status.value = 'error';
      statusMessage.value = '別の保存処理が完了するまでお待ちください。';
      return { status: 'mutation-rejected' };
    }
    return createItem({
      ...item,
      parentGroupId: placement.parentGroupId ?? undefined,
      insertIndex: placement.insertIndex,
    });
  }

  async function deleteItem(itemId: string): Promise<DescriptionMutationOutcome> {
    const screenId = screenIdRef();
    return runMutation(screenId, (expectedRevision, signal) =>
      mutationClient.deleteDescriptionItem(
        screenId,
        itemId,
        expectedRevision,
        fetch,
        signal,
      ),
    );
  }

  async function excludeItem(itemId: string): Promise<DescriptionMutationOutcome> {
    const screenId = screenIdRef();
    return runMutation(screenId, (expectedRevision, signal) =>
      mutationClient.excludeDescriptionItem(
        screenId,
        itemId,
        expectedRevision,
        fetch,
        signal,
      ),
    );
  }

  async function restoreItem(itemId: string): Promise<DescriptionMutationOutcome> {
    const screenId = screenIdRef();
    return runMutation(screenId, (expectedRevision, signal) =>
      mutationClient.restoreDescriptionItem(
        screenId,
        itemId,
        expectedRevision,
        fetch,
        signal,
      ),
    );
  }

  async function reorderItem(itemId: string, direction: -1 | 1): Promise<DescriptionMutationOutcome> {
    if (!snapshot.value || !nodeExistsInActiveTree(snapshot.value, itemId)) {
      return { status: 'mutation-rejected' };
    }
    const ctx = findItemSiblingContext(snapshot.value, itemId);
    if (!ctx) {
      return { status: 'mutation-rejected' };
    }
    const orderedNodes = swapSiblingOrder(ctx.siblings, ctx.index, direction);
    if (!orderedNodes) {
      return { status: 'mutation-rejected' };
    }
    const screenId = screenIdRef();
    return runMutation(screenId, (expectedRevision, signal) =>
      mutationClient.reorderDescriptionChildren(
        screenId,
        {
          expectedRevision,
          parentGroupId: ctx.parentGroupId,
          orderedNodes,
        },
        fetch,
        signal,
      ),
    );
  }

  async function moveItemUp(itemId: string): Promise<DescriptionMutationOutcome> {
    return reorderItem(itemId, -1);
  }

  async function moveItemDown(itemId: string): Promise<DescriptionMutationOutcome> {
    return reorderItem(itemId, 1);
  }

  /** 互換: draft-only addItem → createItem API */
  function addItem(item: {
    itemId: string;
    name: string;
    type: string;
    description: string;
    note: string;
  }): boolean {
    void createItem(item).then((outcome) => {
      if (outcome.status === 'committed-refreshed') {
        statusMessage.value = '項目を追加しました。';
      }
    });
    return true;
  }

  function removeItem(itemId: string): boolean {
    void deleteItem(itemId);
    return true;
  }

  async function copyDraftJson(): Promise<void> {
    if (!draftDocument.value) {
      return;
    }
    await navigator.clipboard.writeText(
      JSON.stringify(draftDocument.value, null, 2),
    );
  }

  function onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!dirty.value && !mutationPending.value) {
      return;
    }
    event.preventDefault();
    event.returnValue = '';
  }

  onMounted(() => {
    if (editingEnabled) {
      window.addEventListener('beforeunload', onBeforeUnload);
    }
  });

  onBeforeUnmount(() => {
    componentMounted = false;
    invalidateEditorLifecycle();
    window.removeEventListener('beforeunload', onBeforeUnload);
  });

  onBeforeRouteLeave((_to, _from, next) => {
    if (!dirty.value && !mutationPending.value) {
      next();
      return;
    }
    const ok = window.confirm(
      '未保存の変更があります。この画面を離れますか？',
    );
    next(ok);
  });

  return {
    editingEnabled,
    snapshot,
    treeResponse: snapshot,
    treeStatus,
    treeError,
    loadedDocument: draftDocument,
    draftDocument,
    revision,
    collectedItemIds,
    status,
    statusMessage,
    conflictError,
    dirty,
    screenDirty,
    itemDirty,
    itemDraftItemId,
    itemDraft,
    saving,
    mutationPending,
    reloadFailed,
    reloadRequired,
    loadDescription,
    reloadLatest,
    reloadTree: reloadLatest,
    save,
    saveScreenMetadata,
    saveItemMetadata,
    cancel,
    cancelItemEdit,
    updateScreenField,
    updateItemField,
    beginItemEdit,
    addItem,
    createItem,
    duplicateItem,
    deleteItem,
    removeItem,
    excludeItem,
    restoreItem,
    isCollectedItem,
    moveItemUp,
    moveItemDown,
    reorderItem,
    copyDraftJson,
    flattenActiveItemIds: () =>
      snapshot.value ? flattenActiveItemIds(snapshot.value) : [],
  };
}
