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
import {
  computeActiveGroupDepth,
  findActiveDescriptionGroup,
  findActiveGroupParentId,
  nodeExistsInTree,
  VIEWER_MAX_GROUP_DEPTH,
} from './description-tree-helpers.js';
import {
  classifyGroupUngroupAuthoritative,
  matchesUngroupCapture,
  type UngroupCaptureSnapshot,
  type UngroupChildRef,
} from './group-ungroup-helpers.js';
import type { DescriptionTreeGetResponse } from './description-tree-types.js';
import type { GroupEditKind, GroupEditPayload } from './group-edit-validation.js';
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

/**
 * same-screen reload の呼び出し意図。
 * caller が明示し、global conflict 状態から推論しない。
 */
export type DescriptionReloadIntent =
  | { type: 'generic-preserve' }
  | { type: 'recover-reload-failed' }
  | {
      type: 'recover-item-conflict';
      target: {
        screenId: string;
        itemId: string;
        generation: number;
        expectedRevision?: string;
      };
    };

export type ConflictItemRecoveryTarget = {
  screenId: string;
  itemId: string;
  generation: number;
  expectedRevision?: string;
};

/** mutation 後 snapshot 適用時の draft 整理範囲。 */
export type SnapshotDraftScope = 'full' | 'none' | 'screen' | 'item';

/** Description mutation の結果（サーバー commit と Tree refresh を区別）。 */
export type DescriptionMutationOutcome =
  | { status: 'committed-refreshed' }
  | { status: 'committed-refresh-failed' }
  | { status: 'mutation-rejected' }
  | { status: 'commit-unknown' }
  | { status: 'stale-or-aborted' };

/** Item Group metadata update 専用結果（authoritative 検証を含む）。 */
export type GroupUpdateResult =
  | { status: 'committed-refreshed' }
  | {
      status: 'authoritative-mismatch';
      commitState: 'committed' | 'unknown' | 'rejected-not-found';
      revision: string;
      baseline: {
        name: string;
        kind: string;
        description: string | null;
      };
    }
  | {
      status: 'target-absent';
      commitState: 'committed' | 'unknown' | 'rejected-not-found';
      revision: string;
    }
  | { status: 'committed-refresh-failed' }
  | { status: 'mutation-rejected' }
  | { status: 'stale-or-aborted' };

/** Item Group create 専用結果（active parent / metadata 検証を含む）。 */
export type GroupCreateResult =
  | {
      status: 'committed-refreshed';
      groupId: string;
      parentGroupId: string | null;
    }
  | {
      status: 'authoritative-mismatch';
      commitState: 'committed' | 'unknown' | 'rejected-not-found';
      revision: string;
      reason: 'metadata' | 'parent';
      groupId: string;
      parentGroupId: string | null;
      baseline?: {
        name: string;
        kind: string;
        description: string | null;
      };
    }
  | {
      status: 'target-absent';
      commitState: 'committed' | 'unknown' | 'rejected-not-found';
      revision: string;
      groupId: string;
    }
  | { status: 'committed-refresh-failed' }
  | { status: 'mutation-rejected' }
  | { status: 'stale-or-aborted' };

/** Item Group ungroup（deleteGroup）専用結果。 */
export type GroupUngroupResult =
  | {
      status: 'committed-refreshed';
      groupId: string;
      parentGroupId: string | null;
      promotedChildren: Array<{ type: 'group' | 'item'; id: string }>;
    }
  | {
      status: 'revision-diverged';
      revision: string;
      groupId: string;
    }
  | {
      status: 'authoritative-mismatch';
      commitState: 'committed' | 'unknown';
      revision: string;
      reason: string;
      groupId: string;
    }
  | {
      status: 'target-still-present';
      commitState: 'committed' | 'unknown';
      revision: string;
      groupId: string;
    }
  | { status: 'committed-refresh-failed' }
  | { status: 'mutation-rejected' }
  | { status: 'stale-or-aborted' };

type GroupAuthoritativeBaseline = {
  name: string;
  kind: string;
  description: string | null;
};

type GroupAuthoritativeClass =
  | { kind: 'match'; baseline: GroupAuthoritativeBaseline }
  | { kind: 'mismatch'; baseline: GroupAuthoritativeBaseline }
  | { kind: 'absent' };

type MutationIdentity = {
  seq: number;
  screenId: string;
  /** Item mutation の 409 recovery 対象 */
  conflictItemId?: string;
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
  let conflictItemRecoveryGeneration = 0;
  const conflictItemRecoveryTarget = ref<ConflictItemRecoveryTarget | null>(null);

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
    conflictItemRecoveryTarget.value = null;
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

  function clearItemEditDraft(): void {
    itemDraftItemId.value = null;
    itemDraft.value = null;
  }

  function clearItemDraft(): void {
    clearItemEditDraft();
  }

  function reconcileItemDraftWithSnapshot(): void {
    const draftId = itemDraftItemId.value;
    if (!draftId || !snapshot.value) {
      return;
    }
    // definition 存在だけでは不十分。active tree 上の Item のみ draft を維持する。
    if (
      !nodeExistsInTree(snapshot.value, { type: 'item', id: draftId })
    ) {
      clearItemEditDraft();
    }
  }

  function syncStatusAfterSnapshotApply(
    draftScope: SnapshotDraftScope,
    options?: { keepRecoveryStatus?: boolean },
  ): void {
    // generic-preserve: conflict / reload-failed を暗黙解消しない
    if (
      options?.keepRecoveryStatus &&
      (status.value === 'conflict' || status.value === 'reload-failed')
    ) {
      return;
    }
    // recover-item-conflict 中の conflict は後続 applyConflictItemRecovery が処理する
    if (status.value === 'conflict' && draftScope !== 'full') {
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
    options?: {
      draftScope?: SnapshotDraftScope;
      keepRecoveryStatus?: boolean;
    },
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
    syncStatusAfterSnapshotApply(draftScope, {
      keepRecoveryStatus: options?.keepRecoveryStatus,
    });
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
      if (identity.conflictItemId) {
        conflictItemRecoveryGeneration += 1;
        conflictItemRecoveryTarget.value = {
          screenId: identity.screenId,
          itemId: identity.conflictItemId,
          generation: conflictItemRecoveryGeneration,
          expectedRevision: error.expectedRevision,
        };
      } else {
        conflictItemRecoveryTarget.value = null;
      }
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

  /**
   * unresolved Item conflict capability。
   * display status（status==='conflict'）には依存しない。
   * 有効な recovery target が残っている限り保護を維持する。
   */
  function isActiveConflictItemRecoveryTarget(
    target: ConflictItemRecoveryTarget | null,
  ): boolean {
    return (
      componentMounted &&
      target !== null &&
      target.screenId === screenIdRef()
    );
  }

  function hasUnresolvedItemConflict(): boolean {
    return isActiveConflictItemRecoveryTarget(conflictItemRecoveryTarget.value);
  }

  /**
   * validation / status write より前に呼ぶ side-effect-free guard。
   * true = 続行可。false = 遮断（state を一切変更しない）。
   */
  function guardUnresolvedItemConflict(): boolean {
    return !hasUnresolvedItemConflict();
  }

  function rejectIfUnresolvedItemConflict(): DescriptionMutationOutcome | null {
    if (!guardUnresolvedItemConflict()) {
      return { status: 'mutation-rejected' };
    }
    return null;
  }

  function tryBeginMutation(
    screenId: string,
    options?: { conflictItemId?: string },
  ): MutationIdentity | null {
    // HTTP 直前の二重防衛。pending / status を変える前に capability を再確認する。
    if (
      !editingEnabled ||
      mutationPending.value ||
      reloadRequired.value ||
      !revision.value ||
      hasUnresolvedItemConflict()
    ) {
      return null;
    }
    mutationAbort?.abort();
    mutationAbort = new AbortController();
    const identity: MutationIdentity = {
      seq: ++mutationSeq,
      screenId,
      conflictItemId: options?.conflictItemId,
    };
    activeMutation = identity;
    mutationPending.value = true;
    statusMessage.value = '';
    conflictError.value = null;
    conflictItemRecoveryTarget.value = null;
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
    options?: { conflictItemId?: string },
  ): Promise<DescriptionMutationOutcome> {
    const identity = tryBeginMutation(screenId, options);
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

  function applyConflictItemRecovery(
    data: DescriptionTreeGetResponse,
    target: ConflictItemRecoveryTarget,
  ): void {
    conflictItemRecoveryTarget.value = null;
    conflictError.value = null;
    reloadRequired.value = false;
    reloadFailed.value = false;

    if (!nodeExistsInTree(data, { type: 'item', id: target.itemId })) {
      clearItemEditDraft();
      status.value = 'error';
      statusMessage.value =
        '対象の項目が見つからないため、編集を終了しました。最新の項目情報に更新しました。';
      return;
    }
    const fields = data.description.items[target.itemId];
    if (!fields) {
      clearItemEditDraft();
      status.value = 'error';
      statusMessage.value =
        '対象の項目が見つからないため、編集を終了しました。最新の項目情報に更新しました。';
      return;
    }

    itemDraftItemId.value = target.itemId;
    itemDraft.value = cloneItemFields(fields);
    statusMessage.value = '';
    status.value = dirty.value ? 'dirty' : 'clean';
  }

  async function loadDescription(
    screenId: string,
    options?: {
      reason?: LoadDescriptionReason;
      /** same-screen-reload では必須。省略時は generic-preserve。 */
      intent?: DescriptionReloadIntent;
    },
  ): Promise<void> {
    if (!editingEnabled) {
      return;
    }

    const reason = options?.reason ?? 'initial-load';
    const intent: DescriptionReloadIntent | null =
      reason === 'same-screen-reload'
        ? (options?.intent ?? { type: 'generic-preserve' })
        : null;
    const preserveDraftsOnReload = reason === 'same-screen-reload';
    const conflictRecoveryAtStart =
      intent?.type === 'recover-item-conflict'
        ? { ...intent.target }
        : null;

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
    // same-screen reload: transient null でも draft を消さない。authoritative 到着後に active-tree reconcile。
    if (!preserveDraftsOnReload) {
      snapshot.value = null;
      clearDrafts();
      conflictError.value = null;
      conflictItemRecoveryTarget.value = null;
      statusMessage.value = '';
      // Screen 切替 / 初期 load では前 Screen の conflict / reload-failed を持ち越さない
      if (
        status.value === 'conflict' ||
        status.value === 'reload-failed' ||
        status.value === 'saving' ||
        status.value === 'error'
      ) {
        status.value = 'idle';
      }
    }

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
      if (conflictRecoveryAtStart || intent?.type === 'recover-reload-failed') {
        // recovery GET 失敗: stale draft / recovery UI / gate を維持
        if (snapshot.value) {
          treeStatus.value =
            snapshot.value.description.rootNodes.length === 0 ? 'empty' : 'ready';
        } else {
          treeStatus.value = 'error';
        }
        treeError.value = result.error.message || '画面設計書の読み込みに失敗しました。';
        return;
      }
      if (intent?.type === 'generic-preserve') {
        // generic reload 失敗でも unresolved conflict / reload-failed を壊さない
        if (snapshot.value) {
          treeStatus.value =
            snapshot.value.description.rootNodes.length === 0 ? 'empty' : 'ready';
        } else {
          treeStatus.value = 'error';
        }
        treeError.value = result.error.message || '画面設計書の読み込みに失敗しました。';
        return;
      }
      treeStatus.value = 'error';
      treeError.value = result.error.message || '画面設計書の読み込みに失敗しました。';
      status.value = 'error';
      statusMessage.value = treeError.value;
      return;
    }

    if (conflictRecoveryAtStart) {
      applySnapshot(result.data, { draftScope: 'none' });
      // クリック時に capture した target のみ置換。global 状態の再読取で target を決めない。
      if (
        conflictItemRecoveryTarget.value?.generation ===
          conflictRecoveryAtStart.generation &&
        conflictItemRecoveryTarget.value.itemId === conflictRecoveryAtStart.itemId &&
        conflictItemRecoveryTarget.value.screenId === screenIdRef() &&
        conflictRecoveryAtStart.screenId === screenIdRef()
      ) {
        applyConflictItemRecovery(result.data, conflictRecoveryAtStart);
      }
      return;
    }

    if (intent?.type === 'recover-reload-failed') {
      applySnapshot(result.data, { draftScope: 'none' });
      reloadRequired.value = false;
      reloadFailed.value = false;
      conflictError.value = null;
      statusMessage.value = '';
      status.value = dirty.value ? 'dirty' : 'clean';
      return;
    }

    if (intent?.type === 'generic-preserve') {
      // authoritative snapshot は更新し得るが、conflict / reload-failed は暗黙解消しない
      applySnapshot(result.data, {
        draftScope: 'none',
        keepRecoveryStatus: true,
      });
      return;
    }

    // initial-load / screen-change
    applySnapshot(result.data, { draftScope: 'full' });
    reloadRequired.value = false;
    reloadFailed.value = false;
  }

  function isCollectedItem(itemId: string): boolean {
    return collectedItemIds.value.includes(itemId);
  }

  async function saveScreenMetadata(): Promise<DescriptionMutationOutcome> {
    const blocked = rejectIfUnresolvedItemConflict();
    if (blocked) {
      return blocked;
    }
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
    const blocked = rejectIfUnresolvedItemConflict();
    if (blocked) {
      return blocked;
    }
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
      { conflictItemId: itemId },
    );
  }

  /** @deprecated 互換のため残す。screen + 選択 Item を順に保存。 */
  async function save(): Promise<DescriptionMutationOutcome> {
    const blocked = rejectIfUnresolvedItemConflict();
    if (blocked) {
      return blocked;
    }
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
    conflictItemRecoveryTarget.value = null;
    if (!reloadRequired.value) {
      reloadFailed.value = false;
      status.value = snapshot.value ? 'clean' : 'idle';
    }
    statusMessage.value = '';
  }

  function cancelItemEdit(): void {
    clearItemEditDraft();
    // Item draft 取消でも mutation/reload recovery 状態は維持する
    if (
      reloadRequired.value ||
      mutationPending.value ||
      status.value === 'reload-failed' ||
      status.value === 'saving' ||
      status.value === 'conflict' ||
      hasUnresolvedItemConflict()
    ) {
      return;
    }
    if (!screenDirty.value) {
      status.value = 'clean';
    }
  }

  /** generic same-screen reload。conflict recovery には使わない。 */
  async function reloadLatest(): Promise<void> {
    await loadDescription(screenIdRef(), {
      reason: 'same-screen-reload',
      intent: { type: 'generic-preserve' },
    });
  }

  /** reload-failed recovery action 専用。 */
  async function reloadAfterFailure(): Promise<void> {
    await loadDescription(screenIdRef(), {
      reason: 'same-screen-reload',
      intent: { type: 'recover-reload-failed' },
    });
  }

  /**
   * Item 409 conflict recovery action 専用。
   * target はクリック時点で capture した identity を渡す。
   */
  async function reloadConflictedItemLatest(
    target: ConflictItemRecoveryTarget,
  ): Promise<void> {
    await loadDescription(screenIdRef(), {
      reason: 'same-screen-reload',
      intent: {
        type: 'recover-item-conflict',
        target: { ...target },
      },
    });
  }

  function captureConflictItemRecoveryTarget(): ConflictItemRecoveryTarget | null {
    if (!conflictItemRecoveryTarget.value) {
      return null;
    }
    return { ...conflictItemRecoveryTarget.value };
  }

  const unresolvedItemConflict = computed(() => hasUnresolvedItemConflict());

  function canMarkDirtyStatus(): boolean {
    return (
      !reloadRequired.value &&
      !mutationPending.value &&
      !hasUnresolvedItemConflict() &&
      status.value !== 'conflict' &&
      status.value !== 'reload-failed' &&
      status.value !== 'saving'
    );
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
    if (canMarkDirtyStatus()) {
      status.value = 'dirty';
    }
  }

  function beginItemEdit(itemId: string): void {
    if (
      !snapshot.value ||
      !nodeExistsInTree(snapshot.value, { type: 'item', id: itemId })
    ) {
      return;
    }
    const fields = snapshot.value.description.items[itemId];
    if (!fields) {
      return;
    }
    itemDraftItemId.value = itemId;
    itemDraft.value = cloneItemFields(fields);
  }

  function updateItemField(
    itemId: string,
    field: 'name' | 'type' | 'description' | 'note',
    value: string,
  ): void {
    if (
      !snapshot.value ||
      !nodeExistsInTree(snapshot.value, { type: 'item', id: itemId })
    ) {
      return;
    }
    if (itemDraftItemId.value !== itemId || !itemDraft.value) {
      beginItemEdit(itemId);
    }
    if (!itemDraft.value) {
      return;
    }
    itemDraft.value = { ...itemDraft.value, [field]: value };
    if (canMarkDirtyStatus()) {
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
    const blocked = rejectIfUnresolvedItemConflict();
    if (blocked) {
      return blocked;
    }
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

  function normalizeGroupDescription(
    value: string | undefined | null,
  ): string | null {
    if (value == null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }

  function classifyGroupAuthoritative(
    groupId: string,
    submitted: GroupEditPayload,
  ): GroupAuthoritativeClass {
    const current = snapshot.value;
    if (!current) {
      return { kind: 'absent' };
    }
    const group = findActiveDescriptionGroup(current, groupId);
    if (!group) {
      return { kind: 'absent' };
    }
    const baseline: GroupAuthoritativeBaseline = {
      name: group.name,
      kind: group.kind,
      description: normalizeGroupDescription(group.description),
    };
    const matches =
      baseline.name.trim() === submitted.name &&
      baseline.kind === submitted.kind &&
      baseline.description === submitted.description;
    return matches
      ? { kind: 'match', baseline }
      : { kind: 'mismatch', baseline };
  }

  function applyGroupAuthoritativeClass(
    classification: GroupAuthoritativeClass,
    commitState: 'committed' | 'unknown' | 'rejected-not-found',
  ): GroupUpdateResult {
    const currentRevision = snapshot.value?.revision ?? '';
    if (classification.kind === 'absent') {
      reloadFailed.value = false;
      reloadRequired.value = false;
      status.value = 'error';
      statusMessage.value =
        '対象のグループが見つからないため、編集を終了しました。最新の項目情報に更新しました。';
      return {
        status: 'target-absent',
        commitState,
        revision: currentRevision,
      };
    }
    if (commitState === 'rejected-not-found') {
      reloadFailed.value = false;
      reloadRequired.value = false;
      status.value = 'error';
      statusMessage.value =
        '対象のグループを更新できませんでした。最新内容を確認して再度保存してください。';
      return {
        status: 'authoritative-mismatch',
        commitState,
        revision: currentRevision,
        baseline: classification.baseline,
      };
    }
    if (classification.kind === 'match') {
      reloadFailed.value = false;
      reloadRequired.value = false;
      statusMessage.value = '保存しました。';
      status.value = dirty.value ? 'dirty' : 'saved';
      return { status: 'committed-refreshed' };
    }
    reloadFailed.value = false;
    reloadRequired.value = false;
    status.value = 'error';
    statusMessage.value =
      '保存後に別の変更が反映されました。最新内容を確認し、必要な場合はもう一度保存してください。';
    return {
      status: 'authoritative-mismatch',
      commitState,
      revision: currentRevision,
      baseline: classification.baseline,
    };
  }

  async function fetchAndClassifyGroupUpdate(
    screenId: string,
    identity: MutationIdentity,
    groupId: string,
    submitted: GroupEditPayload,
    commitState: 'committed' | 'unknown' | 'rejected-not-found',
    reloadFailedStatus: 'committed-refresh-failed' | 'mutation-rejected',
  ): Promise<GroupUpdateResult> {
    mutationRefreshAbort?.abort();
    mutationRefreshAbort = new AbortController();
    const refreshSignal = mutationRefreshAbort.signal;
    const refreshGeneration = lifecycleGeneration;
    const refreshLoadSeq = loadSeq;

    const result = await fetchDescriptionTree(screenId, refreshSignal, fetch);

    if (!isActiveMutationIdentity(identity)) {
      return { status: 'stale-or-aborted' };
    }
    if (!isEditorLifecycleActive(refreshGeneration)) {
      return { status: 'stale-or-aborted' };
    }
    if (refreshLoadSeq !== loadSeq) {
      return { status: 'stale-or-aborted' };
    }
    if (result.aborted) {
      return { status: 'stale-or-aborted' };
    }
    if (!result.ok) {
      reloadFailed.value = true;
      reloadRequired.value = true;
      status.value = 'reload-failed';
      if (reloadFailedStatus === 'committed-refresh-failed') {
        statusMessage.value =
          '保存されましたが、最新内容を再読み込みできませんでした。';
        return { status: 'committed-refresh-failed' };
      }
      statusMessage.value =
        '保存結果を確認できませんでした。最新内容を再読み込みしてください。';
      return { status: 'mutation-rejected' };
    }

    applySnapshot(result.data, { draftScope: 'none' });
    return applyGroupAuthoritativeClass(
      classifyGroupAuthoritative(groupId, submitted),
      commitState,
    );
  }

  async function updateGroupMetadata(input: {
    groupId: string;
    expectedRevision: string;
    name: string;
    kind: GroupEditKind;
    description: string | null;
  }): Promise<GroupUpdateResult> {
    if (!guardUnresolvedItemConflict()) {
      return { status: 'mutation-rejected' };
    }
    const screenId = screenIdRef();
    const identity = tryBeginMutation(screenId);
    if (!identity) {
      return { status: 'mutation-rejected' };
    }

    const submitted: GroupEditPayload = {
      name: input.name,
      kind: input.kind,
      description: input.description,
    };

    try {
      const result = await mutationClient.updateDescriptionGroup(
        screenId,
        input.groupId,
        {
          expectedRevision: input.expectedRevision,
          name: submitted.name,
          kind: submitted.kind,
          description: submitted.description,
        },
        fetch,
        mutationAbort!.signal,
      );

      if (!isActiveMutationIdentity(identity)) {
        return { status: 'stale-or-aborted' };
      }
      if (!result.ok) {
        if (result.aborted) {
          return { status: 'stale-or-aborted' };
        }
        if (result.error.httpStatus === 404) {
          return await fetchAndClassifyGroupUpdate(
            screenId,
            identity,
            input.groupId,
            submitted,
            'rejected-not-found',
            'mutation-rejected',
          );
        }
        if (mutationClient.isDefiniteMutationRejection(result.error)) {
          const rejected = handleMutationError(result.error, identity);
          return rejected.status === 'stale-or-aborted'
            ? rejected
            : { status: 'mutation-rejected' };
        }
        return await fetchAndClassifyGroupUpdate(
          screenId,
          identity,
          input.groupId,
          submitted,
          'unknown',
          'mutation-rejected',
        );
      }
      return await fetchAndClassifyGroupUpdate(
        screenId,
        identity,
        input.groupId,
        submitted,
        'committed',
        'committed-refresh-failed',
      );
    } finally {
      finishMutation(identity);
    }
  }

  type GroupCreateSubmitted = GroupEditPayload & {
    groupId: string;
    parentGroupId: string | null;
  };

  type GroupCreateAuthoritativeClass =
    | { kind: 'match'; baseline: GroupAuthoritativeBaseline }
    | {
        kind: 'mismatch';
        reason: 'metadata' | 'parent';
        baseline?: GroupAuthoritativeBaseline;
      }
    | { kind: 'absent' };

  function classifyGroupCreateAuthoritative(
    submitted: GroupCreateSubmitted,
  ): GroupCreateAuthoritativeClass {
    const current = snapshot.value;
    if (!current) {
      return { kind: 'absent' };
    }
    const group = findActiveDescriptionGroup(current, submitted.groupId);
    if (!group) {
      return { kind: 'absent' };
    }
    const actualParent = findActiveGroupParentId(current, submitted.groupId);
    if (actualParent === undefined || actualParent !== submitted.parentGroupId) {
      return { kind: 'mismatch', reason: 'parent' };
    }
    const baseline: GroupAuthoritativeBaseline = {
      name: group.name,
      kind: group.kind,
      description: normalizeGroupDescription(group.description),
    };
    const matches =
      baseline.name.trim() === submitted.name &&
      baseline.kind === submitted.kind &&
      baseline.description === submitted.description;
    return matches
      ? { kind: 'match', baseline }
      : { kind: 'mismatch', reason: 'metadata', baseline };
  }

  function applyGroupCreateAuthoritativeClass(
    classification: GroupCreateAuthoritativeClass,
    submitted: GroupCreateSubmitted,
    commitState: 'committed' | 'unknown' | 'rejected-not-found',
  ): GroupCreateResult {
    const currentRevision = snapshot.value?.revision ?? '';
    if (classification.kind === 'absent') {
      if (commitState === 'committed' || commitState === 'unknown') {
        reloadFailed.value = true;
        reloadRequired.value = true;
        status.value = 'reload-failed';
        statusMessage.value =
          '追加結果を確認できませんでした。最新内容を再読み込みしてください。';
      } else {
        reloadFailed.value = false;
        reloadRequired.value = false;
        status.value = 'error';
        statusMessage.value =
          '追加先のグループが見つかりません。最新内容を確認してください。';
      }
      return {
        status: 'target-absent',
        commitState,
        revision: currentRevision,
        groupId: submitted.groupId,
      };
    }
    if (classification.kind === 'match') {
      reloadFailed.value = false;
      reloadRequired.value = false;
      statusMessage.value = 'グループを追加しました。';
      status.value = dirty.value ? 'dirty' : 'saved';
      return {
        status: 'committed-refreshed',
        groupId: submitted.groupId,
        parentGroupId: submitted.parentGroupId,
      };
    }
    reloadFailed.value = false;
    reloadRequired.value = false;
    status.value = 'error';
    statusMessage.value =
      classification.reason === 'parent'
        ? '追加したグループの配置が想定と異なります。最新内容を確認してください。'
        : '追加後に別の変更が反映されました。最新内容を確認してください。';
    return {
      status: 'authoritative-mismatch',
      commitState,
      revision: currentRevision,
      reason: classification.reason,
      groupId: submitted.groupId,
      parentGroupId: submitted.parentGroupId,
      baseline: classification.baseline,
    };
  }

  async function fetchAndClassifyGroupCreate(
    screenId: string,
    identity: MutationIdentity,
    submitted: GroupCreateSubmitted,
    commitState: 'committed' | 'unknown' | 'rejected-not-found',
    reloadFailedStatus: 'committed-refresh-failed' | 'mutation-rejected',
  ): Promise<GroupCreateResult> {
    mutationRefreshAbort?.abort();
    mutationRefreshAbort = new AbortController();
    const refreshSignal = mutationRefreshAbort.signal;
    const refreshGeneration = lifecycleGeneration;
    const refreshLoadSeq = loadSeq;

    const result = await fetchDescriptionTree(screenId, refreshSignal, fetch);

    if (!isActiveMutationIdentity(identity)) {
      return { status: 'stale-or-aborted' };
    }
    if (!isEditorLifecycleActive(refreshGeneration)) {
      return { status: 'stale-or-aborted' };
    }
    if (refreshLoadSeq !== loadSeq) {
      return { status: 'stale-or-aborted' };
    }
    if (result.aborted) {
      return { status: 'stale-or-aborted' };
    }
    if (!result.ok) {
      reloadFailed.value = true;
      reloadRequired.value = true;
      status.value = 'reload-failed';
      if (reloadFailedStatus === 'committed-refresh-failed') {
        statusMessage.value =
          '追加されましたが、最新内容を再読み込みできませんでした。';
        return { status: 'committed-refresh-failed' };
      }
      statusMessage.value =
        '追加結果を確認できませんでした。最新内容を再読み込みしてください。';
      return { status: 'mutation-rejected' };
    }

    applySnapshot(result.data, { draftScope: 'none' });
    return applyGroupCreateAuthoritativeClass(
      classifyGroupCreateAuthoritative(submitted),
      submitted,
      commitState,
    );
  }

  async function createGroup(input: {
    groupId: string;
    expectedRevision: string;
    name: string;
    kind: GroupEditKind;
    description: string | null;
    parentGroupId?: string | null;
  }): Promise<GroupCreateResult> {
    if (!guardUnresolvedItemConflict()) {
      return { status: 'mutation-rejected' };
    }

    const parentGroupId =
      input.parentGroupId == null || input.parentGroupId === ''
        ? null
        : input.parentGroupId;

    if (parentGroupId != null) {
      const current = snapshot.value;
      if (!current) {
        status.value = 'error';
        statusMessage.value =
          '追加先のグループが見つかりません。最新内容を確認してください。';
        return { status: 'mutation-rejected' };
      }
      const parent = findActiveDescriptionGroup(current, parentGroupId);
      const parentDepth = computeActiveGroupDepth(current, parentGroupId);
      if (!parent || parentDepth == null) {
        status.value = 'error';
        statusMessage.value =
          '追加先のグループが見つかりません。最新内容を確認してください。';
        return { status: 'mutation-rejected' };
      }
      if (parentDepth >= VIEWER_MAX_GROUP_DEPTH) {
        status.value = 'error';
        statusMessage.value =
          '最大階層（8階層）に達しているため、子グループを追加できません。';
        return { status: 'mutation-rejected' };
      }
    }

    const screenId = screenIdRef();
    const identity = tryBeginMutation(screenId);
    if (!identity) {
      return { status: 'mutation-rejected' };
    }

    const submitted: GroupCreateSubmitted = {
      groupId: input.groupId,
      name: input.name,
      kind: input.kind,
      description: input.description,
      parentGroupId,
    };

    try {
      const result = await mutationClient.createDescriptionGroup(
        screenId,
        {
          expectedRevision: input.expectedRevision,
          groupId: submitted.groupId,
          name: submitted.name,
          kind: submitted.kind,
          description: submitted.description,
          parentGroupId: parentGroupId ?? undefined,
        },
        fetch,
        mutationAbort!.signal,
      );

      if (!isActiveMutationIdentity(identity)) {
        return { status: 'stale-or-aborted' };
      }
      if (!result.ok) {
        if (result.aborted) {
          return { status: 'stale-or-aborted' };
        }
        if (mutationClient.isDefiniteMutationRejection(result.error)) {
          const rejected = handleMutationError(result.error, identity);
          return rejected.status === 'stale-or-aborted'
            ? rejected
            : { status: 'mutation-rejected' };
        }
        return await fetchAndClassifyGroupCreate(
          screenId,
          identity,
          submitted,
          'unknown',
          'mutation-rejected',
        );
      }
      return await fetchAndClassifyGroupCreate(
        screenId,
        identity,
        submitted,
        'committed',
        'committed-refresh-failed',
      );
    } finally {
      finishMutation(identity);
    }
  }

  type UngroupSubmitted = {
    capture: UngroupCaptureSnapshot;
    mutationRevision: string | null;
  };

  function applyUngroupClassification(
    classification: ReturnType<typeof classifyGroupUngroupAuthoritative>,
    submitted: UngroupSubmitted,
    commitState: 'committed' | 'unknown',
  ): GroupUngroupResult {
    const currentRevision = snapshot.value?.revision ?? '';
    if (classification.kind === 'match-exact') {
      reloadFailed.value = false;
      reloadRequired.value = false;
      statusMessage.value = 'グループを解除しました。';
      status.value = dirty.value ? 'dirty' : 'saved';
      return {
        status: 'committed-refreshed',
        groupId: submitted.capture.groupId,
        parentGroupId: submitted.capture.parentGroupId,
        promotedChildren: submitted.capture.directChildren,
      };
    }

    // post-commit / commit-unknown の非 success はすべて mutation gate を維持する
    reloadFailed.value = true;
    reloadRequired.value = true;

    if (classification.kind === 'revision-diverged') {
      status.value = 'reload-failed';
      statusMessage.value =
        'グループ解除後に別の更新が確認されました。最新のツリーを再読み込みして内容を確認してください。';
      return {
        status: 'revision-diverged',
        revision: currentRevision,
        groupId: submitted.capture.groupId,
      };
    }

    if (classification.kind === 'target-still-present') {
      status.value = 'reload-failed';
      statusMessage.value =
        commitState === 'unknown'
          ? '解除結果を確認できませんでした。最新内容を再読み込みしてください。'
          : 'グループ解除後の構造が想定と一致しませんでした。最新のツリーを確認してください。';
      return {
        status: 'target-still-present',
        commitState,
        revision: currentRevision,
        groupId: submitted.capture.groupId,
      };
    }

    status.value = 'reload-failed';
    statusMessage.value =
      'グループ解除後の構造が想定と一致しませんでした。最新のツリーを確認してください。';
    return {
      status: 'authoritative-mismatch',
      commitState,
      revision: currentRevision,
      reason: classification.kind,
      groupId: submitted.capture.groupId,
    };
  }

  async function fetchAndClassifyGroupUngroup(
    screenId: string,
    identity: MutationIdentity,
    submitted: UngroupSubmitted,
    commitState: 'committed' | 'unknown',
    reloadFailedStatus: 'committed-refresh-failed' | 'mutation-rejected',
  ): Promise<GroupUngroupResult> {
    mutationRefreshAbort?.abort();
    mutationRefreshAbort = new AbortController();
    const refreshSignal = mutationRefreshAbort.signal;
    const refreshGeneration = lifecycleGeneration;
    const refreshLoadSeq = loadSeq;

    const result = await fetchDescriptionTree(screenId, refreshSignal, fetch);

    if (!isActiveMutationIdentity(identity)) {
      return { status: 'stale-or-aborted' };
    }
    if (!isEditorLifecycleActive(refreshGeneration)) {
      return { status: 'stale-or-aborted' };
    }
    if (refreshLoadSeq !== loadSeq) {
      return { status: 'stale-or-aborted' };
    }
    if (result.aborted) {
      return { status: 'stale-or-aborted' };
    }
    if (!result.ok) {
      reloadFailed.value = true;
      reloadRequired.value = true;
      status.value = 'reload-failed';
      if (reloadFailedStatus === 'committed-refresh-failed') {
        statusMessage.value =
          '解除されましたが、最新内容を再読み込みできませんでした。';
        return { status: 'committed-refresh-failed' };
      }
      statusMessage.value =
        '解除結果を確認できませんでした。最新内容を再読み込みしてください。';
      return { status: 'mutation-rejected' };
    }

    applySnapshot(result.data, { draftScope: 'none' });
    return applyUngroupClassification(
      classifyGroupUngroupAuthoritative(result.data, submitted.capture, {
        mutationRevision: submitted.mutationRevision,
      }),
      submitted,
      commitState,
    );
  }

  async function ungroupGroup(input: {
    expectedRevision: string;
    capture: UngroupCaptureSnapshot;
  }): Promise<GroupUngroupResult> {
    if (!guardUnresolvedItemConflict()) {
      return { status: 'mutation-rejected' };
    }

    const current = snapshot.value;
    if (!current) {
      status.value = 'error';
      statusMessage.value =
        '対象のグループが見つかりません。最新内容を確認してください。';
      return { status: 'mutation-rejected' };
    }
    if (!matchesUngroupCapture(current, input.capture)) {
      status.value = 'error';
      statusMessage.value =
        'グループの配置が変わったため解除できません。最新内容を確認して再度開いてください。';
      return { status: 'mutation-rejected' };
    }

    const screenId = screenIdRef();
    const identity = tryBeginMutation(screenId);
    if (!identity) {
      return { status: 'mutation-rejected' };
    }

    const submitted: UngroupSubmitted = {
      capture: input.capture,
      mutationRevision: null,
    };

    try {
      const result = await mutationClient.deleteDescriptionGroup(
        screenId,
        input.capture.groupId,
        input.expectedRevision,
        fetch,
        mutationAbort!.signal,
      );

      if (!isActiveMutationIdentity(identity)) {
        return { status: 'stale-or-aborted' };
      }
      if (!result.ok) {
        if (result.aborted) {
          return { status: 'stale-or-aborted' };
        }
        if (mutationClient.isDefiniteMutationRejection(result.error)) {
          const rejected = handleMutationError(result.error, identity);
          return rejected.status === 'stale-or-aborted'
            ? rejected
            : { status: 'mutation-rejected' };
        }
        return await fetchAndClassifyGroupUngroup(
          screenId,
          identity,
          submitted,
          'unknown',
          'mutation-rejected',
        );
      }
      submitted.mutationRevision = result.data.revision;
      return await fetchAndClassifyGroupUngroup(
        screenId,
        identity,
        submitted,
        'committed',
        'committed-refresh-failed',
      );
    } finally {
      finishMutation(identity);
    }
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
    const blocked = rejectIfUnresolvedItemConflict();
    if (blocked) {
      return blocked;
    }
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
    const blocked = rejectIfUnresolvedItemConflict();
    if (blocked) {
      return blocked;
    }
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
    const blocked = rejectIfUnresolvedItemConflict();
    if (blocked) {
      return blocked;
    }
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
    const blocked = rejectIfUnresolvedItemConflict();
    if (blocked) {
      return blocked;
    }
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
    const blocked = rejectIfUnresolvedItemConflict();
    if (blocked) {
      return blocked;
    }
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
    if (!guardUnresolvedItemConflict()) {
      return false;
    }
    void createItem(item).then((outcome) => {
      if (outcome.status === 'committed-refreshed') {
        statusMessage.value = '項目を追加しました。';
      }
    });
    return true;
  }

  function removeItem(itemId: string): boolean {
    if (!guardUnresolvedItemConflict()) {
      return false;
    }
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
    unresolvedItemConflict,
    loadDescription,
    reloadLatest,
    reloadTree: reloadLatest,
    reloadAfterFailure,
    reloadConflictedItemLatest,
    captureConflictItemRecoveryTarget,
    save,
    saveScreenMetadata,
    saveItemMetadata,
    cancel,
    cancelItemEdit,
    clearItemEditDraft,
    updateScreenField,
    updateItemField,
    beginItemEdit,
    addItem,
    createItem,
    createGroup,
    ungroupGroup,
    updateGroupMetadata,
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
