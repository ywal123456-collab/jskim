<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue';
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
import ItemTreePanel from '../components/ItemTreePanel.vue';
import GroupInfoPanel from '../components/GroupInfoPanel.vue';
import GroupEditDialog from '../components/GroupEditDialog.vue';
import GroupCreateDialog from '../components/GroupCreateDialog.vue';
import GroupUngroupDialog from '../components/GroupUngroupDialog.vue';
import DuplicateScreenDialog from '../components/DuplicateScreenDialog.vue';
import DeleteScreenDialog from '../components/DeleteScreenDialog.vue';
import RevisionHistoryDialog from '../components/RevisionHistoryDialog.vue';
import {
  useDescriptionEditor,
  type DescriptionMutationOutcome,
  type GroupCreateResult,
  type GroupUngroupResult,
  type GroupUpdateResult,
  type LoadDescriptionReason,
} from '../editing/useDescriptionEditor';
import { useDescriptionTreePanel } from '../editing/use-description-tree-panel';
import {
  buildGroupMap,
  collectActiveDescriptionTreeNodeIds,
  collectActiveGroupAncestorChain,
  collectTakenDescriptionNodeIds,
  computeActiveGroupDepth,
  createDefaultExpandedGroupIds,
  findActiveDescriptionGroup,
  nodeExistsInTree,
  reconcileExpandedGroupIds,
  VIEWER_MAX_GROUP_DEPTH,
} from '../editing/description-tree-helpers';
import {
  captureActiveGroupUngroupContext,
  matchesUngroupCapture,
  type UngroupCaptureSnapshot,
} from '../editing/group-ungroup-helpers';
import type { GroupEditPayload } from '../editing/group-edit-validation';
import type { GroupCreatePayload } from '../editing/group-create-validation';
import { useVersionHistory } from '../version-history/use-version-history';
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
import {
  fetchScreenModelJson,
  fetchStateResourcesFromScreen,
  resolveSelectedStateId,
  type ScreenDataReloadOutcome,
  type ScreenViewBundle,
} from '../screen-view-bundle';

const props = defineProps<{
  screenId: string;
}>();

const manifest = inject<ComputedRef<ViewerManifest>>('manifest');
const editingEnabled = inject<boolean>('editingEnabled', false);
const openCreateScreen = inject<() => void>('openCreateScreen', () => {});

const screenIdRef = computed(() => props.screenId);
const versionHistory = useVersionHistory({ screenId: screenIdRef });
const revisionHistoryTriggerRef = ref<HTMLButtonElement | null>(null);

async function openRevisionHistory(): Promise<void> {
  await versionHistory.openDialog();
}

function closeRevisionHistory(): void {
  versionHistory.closeDialog();
  void nextTick(() => {
    revisionHistoryTriggerRef.value?.focus();
  });
}

const screen = ref<ScreenData | null>(null);
const isEmptyState = ref(false);
const selectedStateId = ref('');
const selectedItemId = ref<string | null>(null);
const snapshotHtml = ref('');
const previewCss = ref('');
const stylesheets = ref<PreviewStylesheet[]>([]);
const loadError = ref<string | null>(null);
/** route load / state 切替中の snapshot・stylesheet 読込 */
const pageResourcePending = ref(false);
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
const duplicateDialogPending = ref(false);
const deleteDialogPending = ref(false);
const excludeDialogPending = ref(false);
const createDialogPending = ref(false);
const groupEditDialogOpen = ref(false);
const groupEditDialogPending = ref(false);
const groupEditErrorMessage = ref('');
const groupEditTarget = ref<{
  screenId: string;
  groupId: string;
  expectedRevision: string;
  name: string;
  kind: string;
  description: string;
  generation: number;
} | null>(null);
const groupCreateDialogOpen = ref(false);
const groupCreateDialogPending = ref(false);
const groupCreateErrorMessage = ref('');
const groupCreateTarget = ref<{
  screenId: string;
  mode: 'root' | 'child';
  parentGroupId: string | null;
  parentGroupName: string | null;
  expectedRevision: string;
  parentDepth: number | null;
  parentActive: boolean;
  generation: number;
  selectionGeneration: number;
} | null>(null);
const groupUngroupDialogOpen = ref(false);
const groupUngroupDialogPending = ref(false);
const groupUngroupErrorMessage = ref('');
const groupUngroupTarget = ref<{
  screenId: string;
  capture: UngroupCaptureSnapshot;
  expectedRevision: string;
  generation: number;
  selectionGeneration: number;
} | null>(null);

type UncertainItemMutationPayload = {
  itemId: string;
  name: string;
  type: string;
  description: string;
  note: string;
};

type UncertainItemMutation =
  | {
      kind: 'create';
      screenId: string;
      submittedPayload: UncertainItemMutationPayload;
    }
  | {
      kind: 'duplicate';
      screenId: string;
      sourceItemId: string;
      submittedPayload: UncertainItemMutationPayload;
    };

const uncertainItemMutation = ref<UncertainItemMutation | null>(null);

type ItemDialogOperation = {
  seq: number;
  screenId: string;
  itemId: string;
};

type PageLoadIdentity = {
  seq: number;
  screenId: string;
};

type ResourceLoadIdentity = {
  seq: number;
  screenId: string;
  stateId: string;
  pageLoadSeq: number;
  screenModelSeq: number;
  tracksPagePending: boolean;
};

type ScreenModelLoadIdentity = {
  seq: number;
  screenId: string;
  pageLoadSeq: number;
};

type FetchScreenViewBundleResult =
  | { kind: 'ok'; bundle: ScreenViewBundle }
  | { kind: 'failed' }
  | { kind: 'stale-or-aborted' };

let pageMounted = true;
let pageLoadSeq = 0;
let activePageLoad: PageLoadIdentity | null = null;
let pageLoadAbort: AbortController | null = null;
let resourceLoadSeq = 0;
let activeResourceLoad: ResourceLoadIdentity | null = null;
let resourceLoadAbort: AbortController | null = null;
let screenModelLoadSeq = 0;
let activeScreenModelLoad: ScreenModelLoadIdentity | null = null;
let screenModelAbort: AbortController | null = null;
let appliedScreenModelSeq = 0;
let duplicateOpSeq = 0;
let deleteOpSeq = 0;
let excludeOpSeq = 0;
let createOpSeq = 0;
let groupEditOpSeq = 0;
let groupEditDialogGeneration = 0;
let groupCreateOpSeq = 0;
let groupCreateDialogGeneration = 0;
let groupUngroupOpSeq = 0;
let groupUngroupDialogGeneration = 0;
let treeSelectionGeneration = 0;
const activeDuplicateOp = ref<ItemDialogOperation | null>(null);
const activeDeleteOp = ref<ItemDialogOperation | null>(null);
const activeExcludeOp = ref<ItemDialogOperation | null>(null);
const activeCreateOp = ref<ItemDialogOperation | null>(null);
type GroupEditOperation = {
  seq: number;
  screenId: string;
  groupId: string;
  generation: number;
};

const activeGroupEditOp = ref<GroupEditOperation | null>(null);

type GroupCreateOperation = {
  seq: number;
  screenId: string;
  groupId: string;
  generation: number;
  selectionGeneration: number;
  parentGroupId: string | null;
};

const activeGroupCreateOp = ref<GroupCreateOperation | null>(null);

type GroupUngroupOperation = {
  seq: number;
  screenId: string;
  groupId: string;
  generation: number;
  selectionGeneration: number;
};

const activeGroupUngroupOp = ref<GroupUngroupOperation | null>(null);

function invalidateItemDialogOperations(): void {
  duplicateOpSeq += 1;
  deleteOpSeq += 1;
  excludeOpSeq += 1;
  createOpSeq += 1;
  groupEditOpSeq += 1;
  groupEditDialogGeneration += 1;
  groupCreateOpSeq += 1;
  groupCreateDialogGeneration += 1;
  groupUngroupOpSeq += 1;
  groupUngroupDialogGeneration += 1;
  activeDuplicateOp.value = null;
  activeDeleteOp.value = null;
  activeExcludeOp.value = null;
  activeCreateOp.value = null;
  activeGroupEditOp.value = null;
  activeGroupCreateOp.value = null;
  activeGroupUngroupOp.value = null;
  duplicateDialogPending.value = false;
  deleteDialogPending.value = false;
  excludeDialogPending.value = false;
  createDialogPending.value = false;
  groupEditDialogPending.value = false;
  groupEditErrorMessage.value = '';
  groupCreateDialogPending.value = false;
  groupCreateErrorMessage.value = '';
  groupUngroupDialogPending.value = false;
  groupUngroupErrorMessage.value = '';
  duplicateSourceItemId.value = null;
  deleteTargetItemId.value = null;
  excludeTargetItemId.value = null;
  createItemDialogOpen.value = false;
  groupEditDialogOpen.value = false;
  groupEditTarget.value = null;
  groupCreateDialogOpen.value = false;
  groupCreateTarget.value = null;
  groupUngroupDialogOpen.value = false;
  groupUngroupTarget.value = null;
  uncertainItemMutation.value = null;
}

function isActivePageLoad(identity: PageLoadIdentity): boolean {
  return (
    pageMounted &&
    activePageLoad !== null &&
    activePageLoad.seq === identity.seq &&
    activePageLoad.screenId === identity.screenId &&
    identity.screenId === props.screenId
  );
}

function invalidateResourceLoad(): void {
  if (activeResourceLoad?.tracksPagePending) {
    pageResourcePending.value = false;
  }
  resourceLoadSeq += 1;
  resourceLoadAbort?.abort();
  activeResourceLoad = null;
}

function beginResourceLoad(
  screenId: string,
  stateId: string,
  tracksPagePending = false,
): ResourceLoadIdentity {
  if (activeResourceLoad?.tracksPagePending) {
    pageResourcePending.value = false;
  }
  resourceLoadAbort?.abort();
  resourceLoadAbort = new AbortController();
  const identity: ResourceLoadIdentity = {
    seq: ++resourceLoadSeq,
    screenId,
    stateId,
    pageLoadSeq,
    screenModelSeq: activeScreenModelLoad?.seq ?? appliedScreenModelSeq,
    tracksPagePending,
  };
  activeResourceLoad = identity;
  if (tracksPagePending) {
    pageResourcePending.value = true;
  }
  return identity;
}

function expectedScreenModelSeq(): number {
  return activeScreenModelLoad?.seq ?? appliedScreenModelSeq;
}

function isActiveResourceLoad(identity: ResourceLoadIdentity): boolean {
  return (
    pageMounted &&
    activeResourceLoad !== null &&
    activeResourceLoad.seq === identity.seq &&
    activeResourceLoad.screenId === identity.screenId &&
    activeResourceLoad.stateId === identity.stateId &&
    activeResourceLoad.pageLoadSeq === pageLoadSeq &&
    activeResourceLoad.screenModelSeq === identity.screenModelSeq &&
    identity.screenModelSeq === expectedScreenModelSeq() &&
    identity.screenId === props.screenId &&
    identity.stateId === selectedStateId.value &&
    resourceLoadAbort !== null &&
    !resourceLoadAbort.signal.aborted
  );
}

function isActiveBundleResourceLoad(
  identity: ResourceLoadIdentity,
  modelIdentity: ScreenModelLoadIdentity,
  bundleStateId: string,
): boolean {
  return (
    pageMounted &&
    activeResourceLoad !== null &&
    activeResourceLoad.seq === identity.seq &&
    activeResourceLoad.screenId === identity.screenId &&
    activeResourceLoad.stateId === identity.stateId &&
    activeResourceLoad.pageLoadSeq === pageLoadSeq &&
    activeResourceLoad.screenModelSeq === identity.screenModelSeq &&
    identity.screenModelSeq === modelIdentity.seq &&
    identity.screenId === props.screenId &&
    identity.stateId === bundleStateId &&
    isActiveScreenModelLoad(modelIdentity) &&
    resourceLoadAbort !== null &&
    !resourceLoadAbort.signal.aborted
  );
}

function invalidateScreenModelLoad(): void {
  screenModelLoadSeq += 1;
  screenModelAbort?.abort();
  activeScreenModelLoad = null;
}

function beginScreenModelLoad(screenId: string): ScreenModelLoadIdentity {
  screenModelAbort?.abort();
  invalidateResourceLoad();
  screenModelAbort = new AbortController();
  const identity: ScreenModelLoadIdentity = {
    seq: ++screenModelLoadSeq,
    screenId,
    pageLoadSeq,
  };
  activeScreenModelLoad = identity;
  return identity;
}

function isActiveScreenModelLoad(identity: ScreenModelLoadIdentity): boolean {
  return (
    pageMounted &&
    activeScreenModelLoad !== null &&
    activeScreenModelLoad.seq === identity.seq &&
    activeScreenModelLoad.screenId === identity.screenId &&
    activeScreenModelLoad.pageLoadSeq === pageLoadSeq &&
    identity.screenId === props.screenId &&
    screenModelAbort !== null &&
    !screenModelAbort.signal.aborted
  );
}

function invalidatePageLoad(): void {
  pageLoadSeq += 1;
  pageLoadAbort?.abort();
  activePageLoad = null;
  appliedScreenModelSeq = 0;
  pageResourcePending.value = false;
  invalidateResourceLoad();
  invalidateScreenModelLoad();
}

function applyScreenViewBundle(
  bundle: ScreenViewBundle,
  modelIdentity: ScreenModelLoadIdentity,
): void {
  screen.value = bundle.screen;
  selectedStateId.value = bundle.selectedStateId;
  snapshotHtml.value = bundle.snapshotHtml;
  stylesheets.value = bundle.stylesheets;
  appliedScreenModelSeq = modelIdentity.seq;
  if (activeScreenModelLoad?.seq === modelIdentity.seq) {
    activeScreenModelLoad = null;
  }
}

function resolveBundleStateId(
  nextScreen: ScreenData,
  preferredStateId: string | null,
): string {
  const currentSelection = selectedStateId.value;
  if (currentSelection && nextScreen.states.some((state) => state.id === currentSelection)) {
    return currentSelection;
  }
  return resolveSelectedStateId(nextScreen, preferredStateId);
}

async function fetchScreenViewBundle(
  screenId: string,
  modelIdentity: ScreenModelLoadIdentity,
  modelSignal: AbortSignal,
  preferredStateId: string | null,
): Promise<FetchScreenViewBundleResult> {
  const entry = manifest?.value.screens.find((s) => s.id === screenId);
  if (!entry) {
    return { kind: 'stale-or-aborted' };
  }
  const base = import.meta.env.BASE_URL;
  const modelResult = await fetchScreenModelJson(entry.dataFile, base, modelSignal);
  if (!isActiveScreenModelLoad(modelIdentity) || modelSignal.aborted) {
    return { kind: 'stale-or-aborted' };
  }
  if (modelResult.kind === 'aborted') {
    return { kind: 'stale-or-aborted' };
  }
  if (modelResult.kind === 'http-error') {
    return { kind: 'failed' };
  }
  const nextScreen = modelResult.data;
  const resolvedStateId = resolveBundleStateId(nextScreen, preferredStateId);
  if (!resolvedStateId) {
    return {
      kind: 'ok',
      bundle: {
        screen: nextScreen,
        selectedStateId: '',
        snapshotHtml: '',
        stylesheets: [],
      },
    };
  }
  const resourceIdentity = beginResourceLoad(screenId, resolvedStateId);
  const resourceSignal = resourceLoadAbort!.signal;
  const resourceResult = await fetchStateResourcesFromScreen(
    nextScreen,
    resolvedStateId,
    resourceSignal,
    () => isActiveBundleResourceLoad(resourceIdentity, modelIdentity, resolvedStateId),
    base,
  );
  if (resourceResult.kind === 'stale-or-aborted') {
    return { kind: 'stale-or-aborted' };
  }
  if (resourceResult.kind === 'failed') {
    return { kind: 'failed' };
  }
  if (!isActiveScreenModelLoad(modelIdentity) || modelSignal.aborted) {
    return { kind: 'stale-or-aborted' };
  }
  return {
    kind: 'ok',
    bundle: {
      screen: nextScreen,
      selectedStateId: resolvedStateId,
      snapshotHtml: resourceResult.snapshotHtml,
      stylesheets: resourceResult.stylesheets,
    },
  };
}

function beginPageLoad(screenId: string): PageLoadIdentity {
  pageLoadAbort?.abort();
  pageLoadAbort = new AbortController();
  invalidateResourceLoad();
  invalidateScreenModelLoad();
  const identity: PageLoadIdentity = {
    seq: ++pageLoadSeq,
    screenId,
  };
  activePageLoad = identity;
  return identity;
}

function isActiveItemDialogOperation(
  op: ItemDialogOperation,
  active: ItemDialogOperation | null,
  currentTargetId: string | null,
): boolean {
  if (!pageMounted) {
    return false;
  }
  if (!active || active.seq !== op.seq) {
    return false;
  }
  if (active.screenId !== props.screenId) {
    return false;
  }
  if (active.itemId !== op.itemId) {
    return false;
  }
  if (currentTargetId !== op.itemId) {
    return false;
  }
  return true;
}

function beginDuplicateOperation(sourceItemId: string): ItemDialogOperation | null {
  if (duplicateDialogPending.value) {
    return null;
  }
  const op: ItemDialogOperation = {
    seq: ++duplicateOpSeq,
    screenId: props.screenId,
    itemId: sourceItemId,
  };
  activeDuplicateOp.value = op;
  duplicateDialogPending.value = true;
  return op;
}

function shouldClearDestructiveDialogTarget(
  outcome: DescriptionMutationOutcome,
): boolean {
  return (
    outcome.status === 'committed-refreshed' ||
    outcome.status === 'committed-refresh-failed' ||
    outcome.status === 'commit-unknown'
  );
}

function beginCreateOperation(itemId: string): ItemDialogOperation | null {
  if (createDialogPending.value) {
    return null;
  }
  const op: ItemDialogOperation = {
    seq: ++createOpSeq,
    screenId: props.screenId,
    itemId,
  };
  activeCreateOp.value = op;
  createDialogPending.value = true;
  return op;
}

function isActiveCreateOperation(
  op: ItemDialogOperation,
  itemId: string,
): boolean {
  if (!pageMounted) {
    return false;
  }
  if (!createItemDialogOpen.value) {
    return false;
  }
  if (!activeCreateOp.value || activeCreateOp.value.seq !== op.seq) {
    return false;
  }
  if (activeCreateOp.value.screenId !== props.screenId) {
    return false;
  }
  if (activeCreateOp.value.itemId !== op.itemId) {
    return false;
  }
  if (itemId !== op.itemId) {
    return false;
  }
  return true;
}

function finishCreateOperation(
  op: ItemDialogOperation,
  outcome: DescriptionMutationOutcome,
  payload: UncertainItemMutationPayload,
): void {
  if (!isActiveCreateOperation(op, payload.itemId)) {
    return;
  }
  if (outcome.status === 'stale-or-aborted') {
    return;
  }
  createDialogPending.value = false;
  activeCreateOp.value = null;
  if (outcome.status === 'committed-refreshed') {
    uncertainItemMutation.value = null;
    closeCreateItemForced();
    return;
  }
  if (outcome.status === 'mutation-rejected') {
    return;
  }
  if (
    outcome.status === 'commit-unknown' ||
    outcome.status === 'committed-refresh-failed'
  ) {
    uncertainItemMutation.value = {
      kind: 'create',
      screenId: props.screenId,
      submittedPayload: payload,
    };
  }
}

function finishDuplicateOperation(
  op: ItemDialogOperation,
  outcome: DescriptionMutationOutcome,
  payload: UncertainItemMutationPayload,
): void {
  if (!isActiveItemDialogOperation(op, activeDuplicateOp.value, duplicateSourceItemId.value)) {
    return;
  }
  if (outcome.status === 'stale-or-aborted') {
    return;
  }
  duplicateDialogPending.value = false;
  activeDuplicateOp.value = null;
  if (outcome.status === 'committed-refreshed') {
    uncertainItemMutation.value = null;
    duplicateSourceItemId.value = null;
    return;
  }
  if (outcome.status === 'mutation-rejected') {
    return;
  }
  if (
    outcome.status === 'commit-unknown' ||
    outcome.status === 'committed-refresh-failed'
  ) {
    uncertainItemMutation.value = {
      kind: 'duplicate',
      screenId: props.screenId,
      sourceItemId: op.itemId,
      submittedPayload: payload,
    };
  }
}

function beginDeleteOperation(itemId: string): ItemDialogOperation | null {
  if (deleteDialogPending.value) {
    return null;
  }
  const op: ItemDialogOperation = {
    seq: ++deleteOpSeq,
    screenId: props.screenId,
    itemId,
  };
  activeDeleteOp.value = op;
  deleteDialogPending.value = true;
  return op;
}

function finishDeleteOperation(
  op: ItemDialogOperation,
  outcome: DescriptionMutationOutcome,
): void {
  if (!isActiveItemDialogOperation(op, activeDeleteOp.value, deleteTargetItemId.value)) {
    return;
  }
  if (outcome.status === 'stale-or-aborted') {
    return;
  }
  deleteDialogPending.value = false;
  activeDeleteOp.value = null;
  if (shouldClearDestructiveDialogTarget(outcome)) {
    deleteTargetItemId.value = null;
  }
}

function beginExcludeOperation(itemId: string): ItemDialogOperation | null {
  if (excludeDialogPending.value) {
    return null;
  }
  const op: ItemDialogOperation = {
    seq: ++excludeOpSeq,
    screenId: props.screenId,
    itemId,
  };
  activeExcludeOp.value = op;
  excludeDialogPending.value = true;
  return op;
}

function finishExcludeOperation(
  op: ItemDialogOperation,
  outcome: DescriptionMutationOutcome,
): void {
  if (!isActiveItemDialogOperation(op, activeExcludeOp.value, excludeTargetItemId.value)) {
    return;
  }
  if (outcome.status === 'stale-or-aborted') {
    return;
  }
  excludeDialogPending.value = false;
  activeExcludeOp.value = null;
  if (shouldClearDestructiveDialogTarget(outcome)) {
    excludeTargetItemId.value = null;
  }
}

const duplicateScreenDialogOpen = ref(false);
const deleteScreenDialogOpen = ref(false);
const deleteSuccessMessage = ref('');

const editor = useDescriptionEditor(() => props.screenId);

const manifestEntry = computed(
  () => manifest?.value.screens.find((s) => s.id === props.screenId) ?? null,
);

const screenHasDescription = computed(() => {
  if (props.screenId === '_empty') {
    return false;
  }
  if (manifestEntry.value?.hasDescription != null) {
    return manifestEntry.value.hasDescription;
  }
  return Boolean(screen.value?.hasDescription);
});

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
  if (pageResourcePending.value) {
    return 'プレビューリソースを読み込み中です。';
  }
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
  () =>
    pageResourcePending.value ||
    duplicateScreenDialogOpen.value ||
    deleteScreenDialogOpen.value,
);

function screenDataUrl(screenId: string): string {
  const base = import.meta.env.BASE_URL;
  const entry = manifest?.value.screens.find((s) => s.id === screenId);
  if (!entry) {
    return `${base}data/screens/${screenId}.json`;
  }
  return `${base}data/${entry.dataFile}`;
}

async function reloadScreenData(): Promise<ScreenDataReloadOutcome> {
  if (!screen.value || props.screenId === '_empty') {
    return { status: 'stale-or-aborted' };
  }
  const preferredStateId = selectedStateId.value;
  const modelIdentity = beginScreenModelLoad(props.screenId);
  const modelSignal = screenModelAbort!.signal;
  const result = await fetchScreenViewBundle(
    props.screenId,
    modelIdentity,
    modelSignal,
    preferredStateId,
  );
  if (result.kind === 'stale-or-aborted') {
    return { status: 'stale-or-aborted' };
  }
  if (result.kind === 'failed') {
    return { status: 'failed' };
  }
  if (!isActiveScreenModelLoad(modelIdentity)) {
    return { status: 'stale-or-aborted' };
  }
  applyScreenViewBundle(result.bundle, modelIdentity);
  initReferenceViewport();
  return { status: 'applied' };
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
  if (editor.mutationPending.value) {
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
  if (editor.editingEnabled) {
    return editor.flattenActiveItemIds();
  }
  return screen.value?.itemOrder ?? [];
});

const editingExpandedGroupIds = ref<Set<string>>(new Set());
const editingExpandedInit = ref<{
  screenId: string;
  lifecycleGeneration: number;
  initialized: boolean;
} | null>(null);
let editingExpandedLifecycleGeneration = 0;

function reconcileSelectedTreeNodeWithResponse(): void {
  const response = treeResponse.value;
  const selected = selectedTreeNodeRef.value;
  if (!response || !selected) {
    return;
  }
  if (nodeExistsInTree(response, selected)) {
    return;
  }
  selectedTreeNodeRef.value = null;
  if (selected.type === 'item') {
    selectedItemId.value = null;
    if (editor.itemDraftItemId.value === selected.id) {
      editor.clearItemEditDraft();
    }
  }
}

watch(
  () => props.screenId,
  (screenId) => {
    editingExpandedLifecycleGeneration += 1;
    editingExpandedGroupIds.value = new Set();
    editingExpandedInit.value = {
      screenId,
      lifecycleGeneration: editingExpandedLifecycleGeneration,
      initialized: false,
    };
  },
  { immediate: true },
);

watch(
  () => editor.treeResponse.value,
  (response) => {
    if (!editor.editingEnabled || !response) {
      // transient null / loading では expanded・initialized を触らない
      return;
    }
    const active = collectActiveDescriptionTreeNodeIds(response);
    const defaults = createDefaultExpandedGroupIds(
      response.description.rootNodes,
    );
    const init = editingExpandedInit.value;
    const initialized =
      init?.screenId === props.screenId &&
      init.lifecycleGeneration === editingExpandedLifecycleGeneration &&
      init.initialized;
    editingExpandedGroupIds.value = reconcileExpandedGroupIds({
      activeGroupIds: active.groups,
      previousExpandedGroupIds: editingExpandedGroupIds.value,
      defaultExpandedGroupIds: defaults,
      initialized,
    });
    editingExpandedInit.value = {
      screenId: props.screenId,
      lifecycleGeneration: editingExpandedLifecycleGeneration,
      initialized: true,
    };
    reconcileSelectedTreeNodeWithResponse();
  },
);

function toggleEditingGroupExpanded(groupId: string): void {
  const next = new Set(editingExpandedGroupIds.value);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  editingExpandedGroupIds.value = next;
}

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
    case 'reload-failed':
      return '再読み込み失敗';
    case 'clean':
      return '保存済み';
    default:
      return '';
  }
});

/** Item conflict recovery 用。statusMessage が空でも案内を欠かさない。 */
const ITEM_CONFLICT_RECOVERY_FALLBACK_MESSAGE =
  '他の操作によって画面設計書が更新されました。最新内容を再読み込みしてください。';

const visibleStatusMessage = computed(() => {
  if (editor.statusMessage.value) {
    return editor.statusMessage.value;
  }
  if (editor.unresolvedItemConflict.value) {
    return ITEM_CONFLICT_RECOVERY_FALLBACK_MESSAGE;
  }
  return '';
});

const shouldShowStatusBanner = computed(
  () =>
    Boolean(visibleStatusMessage.value) ||
    editor.unresolvedItemConflict.value ||
    editor.status.value === 'reload-failed' ||
    editor.reloadRequired.value,
);

const statusBannerDataStatus = computed(() =>
  editor.unresolvedItemConflict.value ? 'conflict' : editor.status.value,
);

async function loadScreen(
  screenId: string,
  reason: LoadDescriptionReason,
): Promise<void> {
  const loadIdentity = beginPageLoad(screenId);
  const signal = pageLoadAbort!.signal;

  loadError.value = null;
  isEmptyState.value = false;
  pageResourcePending.value = false;
  screen.value = null;
  selectedItemId.value = null;
  selectedStateId.value = '';
  snapshotHtml.value = '';
  stylesheets.value = [];

  if (screenId === '_empty') {
    if (isActivePageLoad(loadIdentity)) {
      isEmptyState.value = true;
    }
    return;
  }

  const base = import.meta.env.BASE_URL;
  const entry = manifest?.value.screens.find((s) => s.id === screenId);
  if (!entry) {
    if (isActivePageLoad(loadIdentity)) {
      loadError.value = `画面「${screenId}」は登録されていません。`;
    }
    return;
  }

  try {
    const modelIdentity = beginScreenModelLoad(screenId);
    const modelSignal = screenModelAbort!.signal;
    const modelResult = await fetchScreenModelJson(entry.dataFile, base, modelSignal);
    if (!isActivePageLoad(loadIdentity) || signal.aborted) {
      return;
    }
    if (modelResult.kind === 'aborted') {
      return;
    }
    if (modelResult.kind === 'http-error') {
      if (isActivePageLoad(loadIdentity) && isActiveScreenModelLoad(modelIdentity)) {
        loadError.value = `画面データの読み込みに失敗しました: ${entry.dataFile}`;
      }
      return;
    }
    const nextScreen = modelResult.data;

    if (editor.editingEnabled) {
      await editor.loadDescription(screenId, { reason });
    }
    if (!isActivePageLoad(loadIdentity) || signal.aborted) {
      return;
    }

    const resolvedStateId = resolveBundleStateId(nextScreen, null);
    screen.value = nextScreen;
    selectedStateId.value = resolvedStateId;
    appliedScreenModelSeq = modelIdentity.seq;
    initReferenceViewport();

    if (!previewCss.value) {
      const cssRes = await fetch(`${base}data/theme/preview.css`, { signal });
      if (!isActivePageLoad(loadIdentity) || signal.aborted) {
        return;
      }
      const nextPreviewCss = cssRes.ok ? await cssRes.text() : '';
      if (!isActivePageLoad(loadIdentity) || signal.aborted) {
        return;
      }
      previewCss.value = nextPreviewCss;
    }
    if (!isActivePageLoad(loadIdentity) || signal.aborted) {
      return;
    }

    if (resolvedStateId && isActiveScreenModelLoad(modelIdentity)) {
      // route load: model を先に適用し、snapshot/stylesheet は pageResourcePending で待つ。
      // same-screen reload は fetchScreenViewBundle で旧 bundle を維持したまま atomic 置換する。
      const resourceIdentity = beginResourceLoad(screenId, resolvedStateId, true);
      await loadPageResources(resourceIdentity, resourceLoadAbort!.signal);
    }
    if (activeScreenModelLoad?.seq === modelIdentity.seq) {
      activeScreenModelLoad = null;
    }
  } catch {
    if (signal.aborted || !isActivePageLoad(loadIdentity)) {
      return;
    }
    loadError.value = '画面データの読み込みに失敗しました。';
  }
}

async function loadPageResources(
  identity: ResourceLoadIdentity,
  signal: AbortSignal,
): Promise<void> {
  if (!isActiveResourceLoad(identity) || signal.aborted || !screen.value) {
    return;
  }
  const state = screen.value.states.find((s) => s.id === identity.stateId);
  if (!state) {
    if (isActiveResourceLoad(identity)) {
      snapshotHtml.value = '';
      stylesheets.value = [];
    }
    return;
  }
  const base = import.meta.env.BASE_URL;
  const result = await fetchStateResourcesFromScreen(
    screen.value,
    identity.stateId,
    signal,
    () => isActiveResourceLoad(identity),
    base,
  );
  if (result.kind === 'ok') {
    if (!isActiveResourceLoad(identity) || signal.aborted) {
      return;
    }
    snapshotHtml.value = result.snapshotHtml;
    stylesheets.value = result.stylesheets;
    if (identity.tracksPagePending) {
      pageResourcePending.value = false;
    }
    return;
  }
  if (result.kind === 'stale-or-aborted') {
    return;
  }
  if (isActiveResourceLoad(identity)) {
    if (identity.tracksPagePending) {
      pageResourcePending.value = false;
    }
    loadError.value = 'プレビューリソースの読み込みに失敗しました。';
  }
}

function onSelectState(stateId: string): void {
  selectedStateId.value = stateId;
  if (!screen.value) {
    return;
  }
  snapshotHtml.value = '';
  stylesheets.value = [];
  const resourceIdentity = beginResourceLoad(props.screenId, stateId, true);
  void loadPageResources(resourceIdentity, resourceLoadAbort!.signal);
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
  if (
    editor.editingEnabled &&
    selectedItemId.value &&
    selectedItemId.value !== itemId &&
    editor.itemDirty.value
  ) {
    const ok = window.confirm(
      '未保存の項目変更があります。選択を切り替えますか？',
    );
    if (!ok) {
      return;
    }
    editor.cancelItemEdit();
  }
  selectedItemId.value = itemId;
  if (editor.editingEnabled) {
    editor.beginItemEdit(itemId);
  }
  const row = document.getElementById(`item-row-${itemId}`);
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

const descriptionTree = useDescriptionTreePanel({
  screenId: () => props.screenId,
  hasDescription: () => screenHasDescription.value && !editor.editingEnabled,
  onSelectItem,
  onClearItemSelection: () => {
    selectedItemId.value = null;
    if (editor.editingEnabled && editor.itemDraftItemId.value) {
      // Group 選択は draft のみ整理。reload-failed 等の global recovery は維持する
      editor.clearItemEditDraft();
    }
  },
});

const {
  treeStatus: readOnlyTreeStatus,
  treeResponse: readOnlyTreeResponse,
  treeError: readOnlyTreeError,
  expandedGroupIds: readOnlyExpandedGroupIds,
  selectedTreeNode: selectedTreeNodeRef,
  reloadTree: reloadReadOnlyTree,
  toggleGroupExpanded: toggleReadOnlyGroupExpanded,
  selectTreeGroup: selectTreeGroupRaw,
  selectTreeItem: selectTreeItemRaw,
} = descriptionTree;

function selectTreeGroup(groupId: string): void {
  treeSelectionGeneration += 1;
  selectTreeGroupRaw(groupId);
}

function selectTreeItem(itemId: string): void {
  treeSelectionGeneration += 1;
  selectTreeItemRaw(itemId);
}

watch(
  () => readOnlyTreeResponse.value,
  () => {
    if (editor.editingEnabled) {
      return;
    }
    reconcileSelectedTreeNodeWithResponse();
  },
);

const treeStatus = computed(() =>
  editor.editingEnabled ? editor.treeStatus.value : readOnlyTreeStatus.value,
);
const treeResponse = computed(() =>
  editor.editingEnabled ? editor.treeResponse.value : readOnlyTreeResponse.value,
);
const treeError = computed(() =>
  editor.editingEnabled ? editor.treeError.value : readOnlyTreeError.value,
);
const expandedGroupIds = computed(() =>
  editor.editingEnabled
    ? editingExpandedGroupIds.value
    : readOnlyExpandedGroupIds.value,
);

function reloadTree(): void {
  if (editor.editingEnabled) {
    // editing Tree reload は常に generic-preserve（conflict recovery と混同しない）
    void editor.reloadLatest();
    return;
  }
  void reloadReadOnlyTree();
}

function toggleGroupExpanded(groupId: string): void {
  if (editor.editingEnabled) {
    toggleEditingGroupExpanded(groupId);
    return;
  }
  toggleReadOnlyGroupExpanded(groupId);
}

watch(selectedItemId, (itemId) => {
  if (itemId) {
    selectedTreeNodeRef.value = { type: 'item', id: itemId };
  } else if (selectedTreeNodeRef.value?.type === 'item') {
    selectedTreeNodeRef.value = null;
  }
});

function syncSelectionAfterOrderChange(
  previousOrder: string[],
  removedId: string,
  wasSelected: boolean,
): void {
  if (!wasSelected) {
    return;
  }
  const index = previousOrder.indexOf(removedId);
  const nextOrder = displayItemOrder.value;
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
  const order = displayItemOrder.value;
  if (selectedItemId.value && !order.includes(selectedItemId.value)) {
    selectedItemId.value = order[0] ?? null;
  }
}

function openCreateItem(): void {
  createItemDialogOpen.value = true;
}

function openGroupEdit(): void {
  if (
    !editor.editingEnabled ||
    editor.mutationPending.value ||
    editor.reloadRequired.value ||
    groupEditDialogPending.value
  ) {
    return;
  }
  const selected = selectedTreeNodeRef.value;
  if (!selected || selected.type !== 'group' || !treeResponse.value) {
    return;
  }
  const group = buildGroupMap(treeResponse.value).get(selected.id);
  if (!group || !editor.revision.value) {
    return;
  }
  groupEditDialogGeneration += 1;
  groupEditErrorMessage.value = '';
  groupEditTarget.value = {
    screenId: props.screenId,
    groupId: group.groupId,
    expectedRevision: editor.revision.value,
    name: group.name,
    kind: group.kind,
    description: group.description ?? '',
    generation: groupEditDialogGeneration,
  };
  groupEditDialogOpen.value = true;
}

function closeGroupEditForced(): void {
  groupEditDialogOpen.value = false;
  groupEditTarget.value = null;
  groupEditErrorMessage.value = '';
  groupEditDialogPending.value = false;
  activeGroupEditOp.value = null;
  void nextTick(() => {
    const button = document.querySelector(
      '[data-testid="group-edit-open"]',
    ) as HTMLButtonElement | null;
    button?.focus();
  });
}

function closeGroupEdit(): void {
  if (groupEditDialogPending.value) {
    return;
  }
  closeGroupEditForced();
}

function beginGroupEditOperation(groupId: string): GroupEditOperation | null {
  if (groupEditDialogPending.value || editor.reloadRequired.value) {
    return null;
  }
  const target = groupEditTarget.value;
  if (!target || target.groupId !== groupId) {
    return null;
  }
  const op: GroupEditOperation = {
    seq: ++groupEditOpSeq,
    screenId: props.screenId,
    groupId,
    generation: target.generation,
  };
  activeGroupEditOp.value = op;
  groupEditDialogPending.value = true;
  groupEditErrorMessage.value = '';
  return op;
}

function isActiveGroupEditOperation(
  op: GroupEditOperation,
  groupId: string,
): boolean {
  if (!pageMounted) {
    return false;
  }
  if (!groupEditDialogOpen.value || !groupEditTarget.value) {
    return false;
  }
  if (!activeGroupEditOp.value || activeGroupEditOp.value.seq !== op.seq) {
    return false;
  }
  if (activeGroupEditOp.value.screenId !== props.screenId) {
    return false;
  }
  if (activeGroupEditOp.value.groupId !== op.groupId) {
    return false;
  }
  if (activeGroupEditOp.value.generation !== op.generation) {
    return false;
  }
  if (groupEditTarget.value.groupId !== groupId || groupId !== op.groupId) {
    return false;
  }
  if (groupEditTarget.value.generation !== op.generation) {
    return false;
  }
  if (groupEditTarget.value.screenId !== props.screenId) {
    return false;
  }
  return true;
}

function finishGroupEditOperation(
  op: GroupEditOperation,
  outcome: GroupUpdateResult,
  groupId: string,
): void {
  if (!isActiveGroupEditOperation(op, groupId)) {
    return;
  }
  if (outcome.status === 'stale-or-aborted') {
    return;
  }
  groupEditDialogPending.value = false;
  activeGroupEditOp.value = null;

  if (outcome.status === 'committed-refreshed') {
    closeGroupEditForced();
    return;
  }

  if (outcome.status === 'target-absent') {
    if (
      selectedTreeNodeRef.value?.type === 'group' &&
      selectedTreeNodeRef.value.id === groupId
    ) {
      selectedTreeNodeRef.value = null;
    }
    groupEditErrorMessage.value = '';
    closeGroupEditForced();
    return;
  }

  if (outcome.status === 'authoritative-mismatch') {
    if (groupEditTarget.value) {
      groupEditTarget.value = {
        ...groupEditTarget.value,
        expectedRevision: outcome.revision,
        name: outcome.baseline.name,
        kind: outcome.baseline.kind,
        description: outcome.baseline.description ?? '',
      };
    }
    groupEditErrorMessage.value = editor.statusMessage.value;
    return;
  }

  if (outcome.status === 'mutation-rejected') {
    groupEditErrorMessage.value = editor.statusMessage.value;
    return;
  }

  if (outcome.status === 'committed-refresh-failed') {
    groupEditErrorMessage.value = editor.statusMessage.value;
  }
}

function onSaveGroupEdit(payload: GroupEditPayload): void {
  const target = groupEditTarget.value;
  if (
    !target ||
    groupEditDialogPending.value ||
    editor.reloadRequired.value ||
    target.screenId !== props.screenId
  ) {
    return;
  }
  const op = beginGroupEditOperation(target.groupId);
  if (!op) {
    return;
  }
  const capturedRevision = target.expectedRevision;
  void editor
    .updateGroupMetadata({
      groupId: target.groupId,
      expectedRevision: capturedRevision,
      name: payload.name,
      kind: payload.kind,
      description: payload.description,
    })
    .then((outcome) => {
      if (!isActiveGroupEditOperation(op, target.groupId)) {
        return;
      }
      finishGroupEditOperation(op, outcome, target.groupId);
    });
}

const canOpenGroupCreate = computed(
  () =>
    Boolean(editor.editingEnabled) &&
    !editor.mutationPending.value &&
    !editor.reloadRequired.value &&
    !editor.unresolvedItemConflict.value &&
    !groupCreateDialogPending.value &&
    !groupEditDialogPending.value &&
    Boolean(editor.revision.value) &&
    Boolean(treeResponse.value),
);

const selectedGroupDepth = computed(() => {
  const selected = selectedTreeNodeRef.value;
  const response = treeResponse.value;
  if (!selected || selected.type !== 'group' || !response) {
    return null;
  }
  return computeActiveGroupDepth(response, selected.id);
});

const selectedGroupDepthLimitReached = computed(() => {
  const depth = selectedGroupDepth.value;
  return depth != null && depth >= VIEWER_MAX_GROUP_DEPTH;
});

const groupCreateExistingNodeIds = computed(() => {
  const response = treeResponse.value;
  if (!response) {
    return [];
  }
  return collectTakenDescriptionNodeIds(response);
});

function openRootGroupCreate(): void {
  if (!canOpenGroupCreate.value || editor.unresolvedItemConflict.value) {
    return;
  }
  if (!editor.revision.value || !treeResponse.value) {
    return;
  }
  groupCreateDialogGeneration += 1;
  groupCreateErrorMessage.value = '';
  groupCreateTarget.value = {
    screenId: props.screenId,
    mode: 'root',
    parentGroupId: null,
    parentGroupName: null,
    expectedRevision: editor.revision.value,
    parentDepth: null,
    parentActive: true,
    generation: groupCreateDialogGeneration,
    selectionGeneration: treeSelectionGeneration,
  };
  groupCreateDialogOpen.value = true;
}

function openChildGroupCreate(): void {
  if (!canOpenGroupCreate.value || editor.unresolvedItemConflict.value) {
    return;
  }
  const selected = selectedTreeNodeRef.value;
  if (!selected || selected.type !== 'group' || !treeResponse.value) {
    return;
  }
  if (!editor.revision.value) {
    return;
  }
  const parent = findActiveDescriptionGroup(treeResponse.value, selected.id);
  const parentDepth = computeActiveGroupDepth(treeResponse.value, selected.id);
  if (!parent || parentDepth == null) {
    return;
  }
  if (parentDepth >= VIEWER_MAX_GROUP_DEPTH) {
    return;
  }
  groupCreateDialogGeneration += 1;
  groupCreateErrorMessage.value = '';
  groupCreateTarget.value = {
    screenId: props.screenId,
    mode: 'child',
    parentGroupId: parent.groupId,
    parentGroupName: parent.name,
    expectedRevision: editor.revision.value,
    parentDepth,
    parentActive: true,
    generation: groupCreateDialogGeneration,
    selectionGeneration: treeSelectionGeneration,
  };
  groupCreateDialogOpen.value = true;
}

function closeGroupCreateForced(): void {
  groupCreateDialogOpen.value = false;
  groupCreateTarget.value = null;
  groupCreateErrorMessage.value = '';
  groupCreateDialogPending.value = false;
  activeGroupCreateOp.value = null;
}

function closeGroupCreate(): void {
  if (groupCreateDialogPending.value) {
    return;
  }
  closeGroupCreateForced();
}

function beginGroupCreateOperation(groupId: string): GroupCreateOperation | null {
  if (groupCreateDialogPending.value || editor.reloadRequired.value) {
    return null;
  }
  if (editor.unresolvedItemConflict.value) {
    return null;
  }
  const target = groupCreateTarget.value;
  if (!target) {
    return null;
  }
  const op: GroupCreateOperation = {
    seq: ++groupCreateOpSeq,
    screenId: props.screenId,
    groupId,
    generation: target.generation,
    selectionGeneration: target.selectionGeneration,
    parentGroupId: target.parentGroupId,
  };
  activeGroupCreateOp.value = op;
  groupCreateDialogPending.value = true;
  groupCreateErrorMessage.value = '';
  return op;
}

function isActiveGroupCreateOperation(
  op: GroupCreateOperation,
  groupId: string,
): boolean {
  if (!pageMounted) {
    return false;
  }
  if (!groupCreateDialogOpen.value || !groupCreateTarget.value) {
    return false;
  }
  if (!activeGroupCreateOp.value || activeGroupCreateOp.value.seq !== op.seq) {
    return false;
  }
  if (activeGroupCreateOp.value.screenId !== props.screenId) {
    return false;
  }
  if (activeGroupCreateOp.value.groupId !== op.groupId) {
    return false;
  }
  if (activeGroupCreateOp.value.generation !== op.generation) {
    return false;
  }
  if (groupCreateTarget.value.generation !== op.generation) {
    return false;
  }
  if (groupCreateTarget.value.screenId !== props.screenId) {
    return false;
  }
  if (groupId !== op.groupId) {
    return false;
  }
  return true;
}

function expandAncestorsForCreatedGroup(parentGroupId: string | null): void {
  const response = treeResponse.value;
  if (!response || parentGroupId == null) {
    return;
  }
  const chain = collectActiveGroupAncestorChain(response, parentGroupId);
  if (chain.length === 0) {
    return;
  }
  const next = new Set(editingExpandedGroupIds.value);
  for (const id of chain) {
    next.add(id);
  }
  editingExpandedGroupIds.value = next;
}

function finishGroupCreateOperation(
  op: GroupCreateOperation,
  outcome: GroupCreateResult,
  groupId: string,
): void {
  if (!isActiveGroupCreateOperation(op, groupId)) {
    return;
  }
  if (outcome.status === 'stale-or-aborted') {
    return;
  }
  groupCreateDialogPending.value = false;
  activeGroupCreateOp.value = null;

  if (outcome.status === 'committed-refreshed') {
    const selectionUnchanged =
      treeSelectionGeneration === op.selectionGeneration;
    closeGroupCreateForced();
    expandAncestorsForCreatedGroup(outcome.parentGroupId);
    if (selectionUnchanged) {
      void nextTick(() => {
        if (treeSelectionGeneration === op.selectionGeneration) {
          selectTreeGroup(outcome.groupId);
        }
      });
    }
    return;
  }

  if (outcome.status === 'target-absent') {
    closeGroupCreateForced();
    return;
  }

  if (outcome.status === 'authoritative-mismatch') {
    closeGroupCreateForced();
    return;
  }

  if (outcome.status === 'mutation-rejected') {
    groupCreateErrorMessage.value = editor.statusMessage.value;
    return;
  }

  if (outcome.status === 'committed-refresh-failed') {
    groupCreateErrorMessage.value = editor.statusMessage.value;
    closeGroupCreateForced();
  }
}

function onCreateGroup(payload: GroupCreatePayload): void {
  const target = groupCreateTarget.value;
  if (
    !target ||
    groupCreateDialogPending.value ||
    editor.reloadRequired.value ||
    editor.unresolvedItemConflict.value ||
    target.screenId !== props.screenId
  ) {
    return;
  }
  if (target.mode === 'child') {
    const response = treeResponse.value;
    if (!response || target.parentGroupId == null) {
      return;
    }
    const parent = findActiveDescriptionGroup(response, target.parentGroupId);
    const parentDepth = computeActiveGroupDepth(response, target.parentGroupId);
    if (!parent || parentDepth == null || parentDepth >= VIEWER_MAX_GROUP_DEPTH) {
      return;
    }
  }
  const op = beginGroupCreateOperation(payload.groupId);
  if (!op) {
    return;
  }
  const capturedRevision = target.expectedRevision;
  void editor
    .createGroup({
      groupId: payload.groupId,
      expectedRevision: capturedRevision,
      name: payload.name,
      kind: payload.kind,
      description: payload.description,
      parentGroupId: target.parentGroupId,
    })
    .then((outcome) => {
      if (!isActiveGroupCreateOperation(op, payload.groupId)) {
        return;
      }
      finishGroupCreateOperation(op, outcome, payload.groupId);
    });
}

const canOpenGroupUngroup = computed(
  () =>
    Boolean(editor.editingEnabled) &&
    !editor.mutationPending.value &&
    !editor.reloadRequired.value &&
    !editor.unresolvedItemConflict.value &&
    !groupUngroupDialogPending.value &&
    !groupEditDialogPending.value &&
    !groupCreateDialogPending.value &&
    Boolean(editor.revision.value) &&
    Boolean(treeResponse.value),
);

function openGroupUngroup(): void {
  if (!canOpenGroupUngroup.value || editor.unresolvedItemConflict.value) {
    return;
  }
  const selected = selectedTreeNodeRef.value;
  if (!selected || selected.type !== 'group' || !treeResponse.value) {
    return;
  }
  if (!editor.revision.value) {
    return;
  }
  const capture = captureActiveGroupUngroupContext(
    treeResponse.value,
    selected.id,
  );
  if (!capture) {
    return;
  }
  groupUngroupDialogGeneration += 1;
  groupUngroupErrorMessage.value = '';
  groupUngroupTarget.value = {
    screenId: props.screenId,
    capture,
    expectedRevision: editor.revision.value,
    generation: groupUngroupDialogGeneration,
    selectionGeneration: treeSelectionGeneration,
  };
  groupUngroupDialogOpen.value = true;
}

function closeGroupUngroupForced(): void {
  groupUngroupDialogOpen.value = false;
  groupUngroupTarget.value = null;
  groupUngroupErrorMessage.value = '';
  groupUngroupDialogPending.value = false;
  activeGroupUngroupOp.value = null;
}

function closeGroupUngroup(): void {
  if (groupUngroupDialogPending.value) {
    return;
  }
  closeGroupUngroupForced();
}

function beginGroupUngroupOperation(groupId: string): GroupUngroupOperation | null {
  if (
    groupUngroupDialogPending.value ||
    editor.reloadRequired.value ||
    editor.unresolvedItemConflict.value
  ) {
    return null;
  }
  const target = groupUngroupTarget.value;
  if (!target || target.capture.groupId !== groupId) {
    return null;
  }
  const op: GroupUngroupOperation = {
    seq: ++groupUngroupOpSeq,
    screenId: props.screenId,
    groupId,
    generation: target.generation,
    selectionGeneration: target.selectionGeneration,
  };
  activeGroupUngroupOp.value = op;
  groupUngroupDialogPending.value = true;
  groupUngroupErrorMessage.value = '';
  return op;
}

function isActiveGroupUngroupOperation(
  op: GroupUngroupOperation,
  groupId: string,
): boolean {
  if (!pageMounted) {
    return false;
  }
  if (!groupUngroupDialogOpen.value || !groupUngroupTarget.value) {
    return false;
  }
  if (!activeGroupUngroupOp.value || activeGroupUngroupOp.value.seq !== op.seq) {
    return false;
  }
  if (activeGroupUngroupOp.value.screenId !== props.screenId) {
    return false;
  }
  if (activeGroupUngroupOp.value.groupId !== op.groupId) {
    return false;
  }
  if (activeGroupUngroupOp.value.generation !== op.generation) {
    return false;
  }
  if (groupUngroupTarget.value.generation !== op.generation) {
    return false;
  }
  if (groupUngroupTarget.value.screenId !== props.screenId) {
    return false;
  }
  if (groupId !== op.groupId) {
    return false;
  }
  return true;
}

function applyUngroupSelection(
  outcome: Extract<GroupUngroupResult, { status: 'committed-refreshed' }>,
): void {
  if (outcome.parentGroupId != null) {
    const response = treeResponse.value;
    if (
      response &&
      findActiveDescriptionGroup(response, outcome.parentGroupId)
    ) {
      selectTreeGroup(outcome.parentGroupId);
      return;
    }
  }
  const first = outcome.promotedChildren[0];
  if (!first) {
    selectedTreeNodeRef.value = null;
    selectedItemId.value = null;
    return;
  }
  if (first.type === 'group') {
    selectTreeGroup(first.id);
    return;
  }
  selectTreeItem(first.id);
}

function pruneExpandedAfterUngroup(removedGroupId: string): void {
  if (!editingExpandedGroupIds.value.has(removedGroupId)) {
    return;
  }
  const next = new Set(editingExpandedGroupIds.value);
  next.delete(removedGroupId);
  editingExpandedGroupIds.value = next;
}

function expandAncestorsForSelection(nodeId: string, type: 'group' | 'item'): void {
  const response = treeResponse.value;
  if (!response) {
    return;
  }
  if (type === 'group') {
    const chain = collectActiveGroupAncestorChain(response, nodeId);
    if (chain.length <= 1) {
      return;
    }
    const next = new Set(editingExpandedGroupIds.value);
    for (const id of chain.slice(0, -1)) {
      next.add(id);
    }
    editingExpandedGroupIds.value = next;
    return;
  }
  // item: expand parent group chain
  for (const group of buildGroupMap(response).values()) {
    if (group.children.some((child) => child.type === 'item' && child.id === nodeId)) {
      const chain = collectActiveGroupAncestorChain(response, group.groupId);
      const next = new Set(editingExpandedGroupIds.value);
      for (const id of chain) {
        next.add(id);
      }
      editingExpandedGroupIds.value = next;
      return;
    }
  }
}

function finishGroupUngroupOperation(
  op: GroupUngroupOperation,
  outcome: GroupUngroupResult,
  groupId: string,
): void {
  if (!isActiveGroupUngroupOperation(op, groupId)) {
    return;
  }
  if (outcome.status === 'stale-or-aborted') {
    return;
  }
  groupUngroupDialogPending.value = false;
  activeGroupUngroupOp.value = null;

  if (outcome.status === 'committed-refreshed') {
    const selectionUnchanged =
      treeSelectionGeneration === op.selectionGeneration;
    closeGroupUngroupForced();
    pruneExpandedAfterUngroup(outcome.groupId);
    if (selectionUnchanged) {
      void nextTick(() => {
        if (treeSelectionGeneration !== op.selectionGeneration) {
          return;
        }
        applyUngroupSelection(outcome);
        const selected = selectedTreeNodeRef.value;
        if (selected) {
          expandAncestorsForSelection(selected.id, selected.type);
        }
      });
    } else if (
      selectedTreeNodeRef.value?.type === 'group' &&
      selectedTreeNodeRef.value.id === groupId
    ) {
      selectedTreeNodeRef.value = null;
    }
    return;
  }

  if (
    outcome.status === 'authoritative-mismatch' ||
    outcome.status === 'target-still-present' ||
    outcome.status === 'revision-diverged' ||
    outcome.status === 'committed-refresh-failed'
  ) {
    closeGroupUngroupForced();
    return;
  }

  if (outcome.status === 'mutation-rejected') {
    groupUngroupErrorMessage.value = editor.statusMessage.value;
  }
}

function onConfirmGroupUngroup(): void {
  const target = groupUngroupTarget.value;
  if (
    !target ||
    groupUngroupDialogPending.value ||
    editor.reloadRequired.value ||
    editor.unresolvedItemConflict.value ||
    target.screenId !== props.screenId
  ) {
    return;
  }
  const response = treeResponse.value;
  if (!response || !matchesUngroupCapture(response, target.capture)) {
    groupUngroupErrorMessage.value =
      'グループの配置が変わったため解除できません。キャンセルして最新内容を確認してください。';
    return;
  }
  const op = beginGroupUngroupOperation(target.capture.groupId);
  if (!op) {
    return;
  }
  const capturedRevision = target.expectedRevision;
  void editor
    .ungroupGroup({
      expectedRevision: capturedRevision,
      capture: target.capture,
    })
    .then((outcome) => {
      if (!isActiveGroupUngroupOperation(op, target.capture.groupId)) {
        return;
      }
      finishGroupUngroupOperation(op, outcome, target.capture.groupId);
    });
}

function closeCreateItemForced(): void {
  createItemDialogOpen.value = false;
  uncertainItemMutation.value = null;
}

function closeCreateItem(): void {
  if (createDialogPending.value) {
    return;
  }
  closeCreateItemForced();
}

function findTargetItemLocation(
  targetId: string,
): 'active' | 'excluded' | 'missing' {
  const snapshot = editor.snapshot.value;
  if (!snapshot) {
    return 'missing';
  }
  if (snapshot.description.items[targetId]) {
    return 'active';
  }
  if (snapshot.description.excludedItems?.[targetId]) {
    return 'excluded';
  }
  return 'missing';
}

function reconcileUncertainItemMutations(): void {
  const uncertain = uncertainItemMutation.value;
  if (!uncertain || uncertain.screenId !== props.screenId) {
    return;
  }
  if (editor.reloadRequired.value) {
    return;
  }

  const targetId = uncertain.submittedPayload.itemId;
  const location = findTargetItemLocation(targetId);
  uncertainItemMutation.value = null;

  if (location === 'excluded') {
    return;
  }

  if (location === 'active') {
    if (uncertain.kind === 'create') {
      closeCreateItemForced();
      void nextTick(() => {
        onSelectItem(targetId);
      });
      return;
    }
    duplicateSourceItemId.value = null;
    void nextTick(() => {
      onSelectItem(targetId);
    });
    return;
  }
}

async function reloadDescriptionAfterFailure(): Promise<void> {
  await editor.reloadAfterFailure();
  reconcileUncertainItemMutations();
}

async function reloadConflictedItemDescription(): Promise<void> {
  const target = editor.captureConflictItemRecoveryTarget();
  if (!target) {
    return;
  }
  await editor.reloadConflictedItemLatest(target);
  reconcileUncertainItemMutations();
}

async function onSaveItemMetadata(): Promise<void> {
  if (
    !selectedItemId.value ||
    editor.unresolvedItemConflict.value ||
    editor.mutationPending.value ||
    deleteScreenDialogOpen.value
  ) {
    return;
  }
  await editor.saveItemMetadata(selectedItemId.value);
}

function onCreateItem(payload: UncertainItemMutationPayload): void {
  if (createDialogPending.value || editor.reloadRequired.value) {
    return;
  }
  const op = beginCreateOperation(payload.itemId);
  if (!op) {
    return;
  }
  void editor.createItem(payload).then((outcome) => {
    if (!isActiveCreateOperation(op, payload.itemId)) {
      return;
    }
    if (outcome.status === 'committed-refreshed') {
      void nextTick(() => {
        onSelectItem(payload.itemId);
      });
    }
    finishCreateOperation(op, outcome, payload);
  });
}

function openDuplicateItem(itemId: string): void {
  duplicateSourceItemId.value = itemId;
}

function closeDuplicateItem(): void {
  if (duplicateDialogPending.value) {
    return;
  }
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
  sourceItemId: string;
  itemId: string;
  name: string;
  type: string;
  description: string;
  note: string;
}): void {
  const sourceId = payload.sourceItemId || duplicateSourceItemId.value;
  if (!sourceId) {
    return;
  }
  const op = beginDuplicateOperation(sourceId);
  if (!op) {
    return;
  }
  const { sourceItemId: _sourceItemId, ...itemPayload } = payload;
  void editor.duplicateItem(sourceId, itemPayload).then((outcome) => {
    if (!isActiveItemDialogOperation(op, activeDuplicateOp.value, duplicateSourceItemId.value)) {
      return;
    }
    if (outcome.status === 'committed-refreshed') {
      void nextTick(() => {
        onSelectItem(payload.itemId);
      });
    }
    finishDuplicateOperation(op, outcome, itemPayload);
  });
}

function openDeleteItem(itemId: string): void {
  if (editor.isCollectedItem(itemId)) {
    return;
  }
  deleteTargetItemId.value = itemId;
}

function closeDeleteItem(): void {
  if (deleteDialogPending.value) {
    return;
  }
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

function onConfirmDeleteItem(payload: { itemId: string }): void {
  const itemId = payload.itemId || deleteTargetItemId.value;
  if (!itemId) {
    return;
  }
  const op = beginDeleteOperation(itemId);
  if (!op) {
    return;
  }
  const wasSelected = selectedItemId.value === itemId;
  const order = [...displayItemOrder.value];
  void editor.deleteItem(itemId).then((outcome) => {
    if (!isActiveItemDialogOperation(op, activeDeleteOp.value, deleteTargetItemId.value)) {
      return;
    }
    if (outcome.status === 'committed-refreshed') {
      syncSelectionAfterOrderChange(order, itemId, wasSelected);
    }
    finishDeleteOperation(op, outcome);
  });
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
  if (excludeDialogPending.value) {
    return;
  }
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

function onConfirmExcludeItem(payload: { itemId: string }): void {
  const itemId = payload.itemId || excludeTargetItemId.value;
  if (!itemId) {
    return;
  }
  const op = beginExcludeOperation(itemId);
  if (!op) {
    return;
  }
  const order = [...displayItemOrder.value];
  const wasSelected = selectedItemId.value === itemId;
  void editor.excludeItem(itemId).then((outcome) => {
    if (!isActiveItemDialogOperation(op, activeExcludeOp.value, excludeTargetItemId.value)) {
      return;
    }
    if (outcome.status === 'committed-refreshed') {
      syncSelectionAfterOrderChange(order, itemId, wasSelected);
    }
    finishExcludeOperation(op, outcome);
  });
}

function onRestoreExcludedItem(itemId: string): void {
  void editor.restoreItem(itemId).then((outcome) => {
    if (outcome.status !== 'committed-refreshed') {
      return;
    }
    void nextTick(() => {
      onSelectItem(itemId);
    });
  });
}

function copyDraftJson(): void {
  void editor.copyDraftJson();
}

function onMoveItemUp(itemId: string): void {
  void editor.moveItemUp(itemId);
}

function onMoveItemDown(itemId: string): void {
  void editor.moveItemDown(itemId);
}

function openDuplicateScreen(): void {
  if (
    editor.dirty.value ||
    editor.mutationPending.value ||
    deleteScreenDialogOpen.value
  ) {
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
    await loadScreen(props.screenId, 'same-screen-reload');
    return;
  }
  deleteSuccessMessage.value = '画面設計を削除しました。';
}

function onDeleteReloadLatest(): void {
  deleteScreenDialogOpen.value = false;
  void editor.reloadLatest().then(() => {
    reconcileUncertainItemMutations();
  });
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
  (id, prev) => {
    deleteSuccessMessage.value = '';
    if (prev !== undefined && prev !== id) {
      invalidateItemDialogOperations();
    }
    const reason: LoadDescriptionReason =
      prev === undefined ? 'initial-load' : 'screen-change';
    void loadScreen(id, reason);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  pageMounted = false;
  invalidatePageLoad();
  invalidateItemDialogOperations();
});
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
  <div v-else class="spec-page" :class="{ 'spec-page--editing': editor.editingEnabled }" :aria-busy="pageResourcePending ? 'true' : undefined">
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

      <div class="spec-page__header-actions">
        <button
          v-if="versionHistory.available"
          ref="revisionHistoryTriggerRef"
          type="button"
          class="spec-page__btn spec-page__btn--secondary"
          data-testid="revision-history-open"
          data-action="revision-history"
          @click="openRevisionHistory"
        >
          改訂履歴
        </button>
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
            editor.mutationPending.value ||
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
            !editor.screenDirty.value ||
            editor.mutationPending.value ||
            editor.unresolvedItemConflict.value ||
            deleteScreenDialogOpen
          "
          @click="editor.saveScreenMetadata()"
        >
          基本情報を保存
        </button>
        <button
          v-if="selectedItemId"
          type="button"
          class="spec-page__btn"
          data-action="save-item"
          :disabled="
            !editor.itemDirty.value ||
            editor.mutationPending.value ||
            editor.unresolvedItemConflict.value ||
            deleteScreenDialogOpen
          "
          @click="onSaveItemMetadata()"
        >
          項目を保存
        </button>
        <button
          type="button"
          class="spec-page__btn spec-page__btn--secondary"
          :disabled="
            !editor.dirty.value ||
            editor.mutationPending.value ||
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
      v-if="shouldShowStatusBanner"
      class="spec-page__banner"
      :data-status="statusBannerDataStatus"
    >
      <p v-if="visibleStatusMessage">{{ visibleStatusMessage }}</p>
      <!-- Item 409 専用。Group/Screen 等の generic conflict では表示しない -->
      <div
        v-if="editor.unresolvedItemConflict.value"
        class="spec-page__banner-actions"
      >
        <button
          type="button"
          class="spec-page__btn"
          data-action="recover-item-conflict"
          @click="reloadConflictedItemDescription()"
        >
          最新内容を再読み込み
        </button>
        <button
          type="button"
          class="spec-page__btn spec-page__btn--secondary"
          @click="copyDraftJson()"
        >
          編集中の内容をコピー
        </button>
      </div>
      <div
        v-else-if="editor.status.value === 'reload-failed'"
        class="spec-page__banner-actions"
      >
        <button
          type="button"
          class="spec-page__btn"
          data-action="recover-reload-failed"
          @click="reloadDescriptionAfterFailure()"
        >
          再読み込み
        </button>
      </div>
    </div>

    <StateSelector
      v-if="screen.states.length > 0 && effectiveProvider !== 'reference'"
      :states="screen.states"
      :selected-state-id="selectedStateId"
      :disabled="pageResourcePending"
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
          <p
            v-if="pageResourcePending"
            class="spec-page__resource-loading"
            data-testid="page-resource-loading"
            role="status"
          >
            プレビューリソースを読み込み中…
          </p>
          <div
            v-show="effectiveProvider === 'live' && canShowDeviceTabs && !pageResourcePending"
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
            v-if="captureViewport && !pageResourcePending"
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
            v-if="effectiveProvider === 'reference' && !pageResourcePending"
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

          <div
            v-if="screenHasDescription"
            class="spec-page__items-workspace"
          >
            <ItemTreePanel
              :status="treeStatus"
              :response="treeResponse"
              :error-message="treeError"
              :expanded-group-ids="expandedGroupIds"
              :selected-tree-node="selectedTreeNodeRef"
              :editing-enabled="editor.editingEnabled"
              :can-add-root-group="canOpenGroupCreate"
              @reload="reloadTree()"
              @toggle-group="toggleGroupExpanded"
              @select-group="selectTreeGroup"
              @select-item="selectTreeItem"
              @add-root-group="openRootGroupCreate"
            />

            <div class="spec-page__items-detail">
              <GroupInfoPanel
                v-if="
                  selectedTreeNodeRef?.type === 'group' &&
                  treeResponse
                "
                :group-id="selectedTreeNodeRef.id"
                :response="treeResponse"
                :editing-enabled="editor.editingEnabled"
                :mutation-pending="editor.mutationPending.value"
                :reload-required="editor.reloadRequired.value"
                :unresolved-item-conflict="editor.unresolvedItemConflict.value"
                :can-add-child-group="canOpenGroupCreate"
                :depth-limit-reached="selectedGroupDepthLimitReached"
                @edit="openGroupEdit"
                @add-child-group="openChildGroupCreate"
                @ungroup="openGroupUngroup"
              />
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
                @move-up="onMoveItemUp"
                @move-down="onMoveItemDown"
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
            </div>
          </div>

          <template v-else>
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
          </template>
        </section>
      </div>
    </div>

    <CreateItemDialog
      v-if="createItemDialogOpen"
      :existing-item-ids="existingItemIdsForCreate"
      :pending="createDialogPending"
      :submit-disabled="editor.reloadRequired.value"
      @close="closeCreateItem"
      @create="onCreateItem"
    />

    <GroupEditDialog
      v-if="groupEditDialogOpen && groupEditTarget"
      :group-id="groupEditTarget.groupId"
      :generation="groupEditTarget.generation"
      :initial-name="groupEditTarget.name"
      :initial-kind="groupEditTarget.kind"
      :initial-description="groupEditTarget.description"
      :pending="groupEditDialogPending"
      :submit-disabled="editor.reloadRequired.value"
      :error-message="groupEditErrorMessage"
      @close="closeGroupEdit"
      @save="onSaveGroupEdit"
    />

    <GroupCreateDialog
      v-if="groupCreateDialogOpen && groupCreateTarget"
      :mode="groupCreateTarget.mode"
      :generation="groupCreateTarget.generation"
      :parent-group-id="groupCreateTarget.parentGroupId"
      :parent-group-name="groupCreateTarget.parentGroupName"
      :existing-node-ids="groupCreateExistingNodeIds"
      :parent-depth="groupCreateTarget.parentDepth"
      :parent-active="groupCreateTarget.parentActive"
      :pending="groupCreateDialogPending"
      :submit-disabled="editor.reloadRequired.value"
      :error-message="groupCreateErrorMessage"
      @close="closeGroupCreate"
      @create="onCreateGroup"
    />

    <GroupUngroupDialog
      v-if="groupUngroupDialogOpen && groupUngroupTarget"
      :group-id="groupUngroupTarget.capture.groupId"
      :group-name="groupUngroupTarget.capture.name"
      :parent-group-id="groupUngroupTarget.capture.parentGroupId"
      :parent-group-name="groupUngroupTarget.capture.parentName"
      :direct-children="groupUngroupTarget.capture.directChildren"
      :pending="groupUngroupDialogPending"
      :submit-disabled="editor.reloadRequired.value"
      :error-message="groupUngroupErrorMessage"
      @close="closeGroupUngroup"
      @confirm="onConfirmGroupUngroup"
    />

    <DuplicateItemDialog
      v-if="duplicateSourceItem"
      :existing-item-ids="existingItemIdsForCreate"
      :source-item-id="duplicateSourceItem.itemId"
      :initial-name="duplicateSourceItem.name"
      :initial-type="duplicateSourceItem.type"
      :initial-description="duplicateSourceItem.description"
      :initial-note="duplicateSourceItem.note"
      :pending="duplicateDialogPending"
      :submit-disabled="editor.reloadRequired.value"
      @close="closeDuplicateItem"
      @create="onDuplicateItem"
    />

    <DeleteItemDialog
      v-if="deleteTargetItem"
      :item-id="deleteTargetItem.itemId"
      :item-name="deleteTargetItem.name"
      :pending="deleteDialogPending"
      @close="closeDeleteItem"
      @confirm="onConfirmDeleteItem"
    />

    <ExcludeItemDialog
      v-if="excludeTargetItem"
      :item-id="excludeTargetItem.itemId"
      :item-name="excludeTargetItem.name"
      :pending="excludeDialogPending"
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

    <RevisionHistoryDialog
      v-if="versionHistory.open.value"
      :status="versionHistory.status.value"
      :scope="versionHistory.scope.value"
      :feature-id="versionHistory.featureIdForScope.value"
      :feature-name="versionHistory.featureNameForScope.value"
      :project-name="projectName"
      :screen-id="props.screenId"
      :revisions="versionHistory.revisions.value"
      :selected-hash="versionHistory.selectedHash.value"
      :detail="versionHistory.detail.value"
      :loading="versionHistory.loading.value"
      :loading-more="versionHistory.loadingMore.value"
      :loading-detail="versionHistory.loadingDetail.value"
      :has-more="versionHistory.hasMore.value"
      :error-message="versionHistory.errorMessage.value"
      @close="closeRevisionHistory"
      @set-scope="(s) => versionHistory.setScope(s)"
      @load-more="() => versionHistory.requestLoadMore()"
      @select="(hash) => versionHistory.requestSelect(hash)"
    />
  </div>
</template>
