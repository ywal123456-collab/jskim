import { getCurrentInstance, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { fetchDescriptionTree } from './description-tree-client.js';
import {
  collectActiveDescriptionTreeNodeIds,
  createDefaultExpandedGroupIds,
  nodeExistsInTree,
  reconcileExpandedGroupIds,
} from './description-tree-helpers.js';
import type {
  DescriptionTreeGetResponse,
  SelectedTreeNode,
} from './description-tree-types.js';

export type DescriptionTreePanelStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

type ExpandedInitialization = {
  screenId: string;
  lifecycleGeneration: number;
  initialized: boolean;
};

export function useDescriptionTreePanel(options: {
  screenId: () => string;
  hasDescription: () => boolean;
  onSelectItem: (itemId: string) => void;
  onClearItemSelection: () => void;
  fetchFn?: typeof fetch;
}) {
  const treeStatus = ref<DescriptionTreePanelStatus>('idle');
  const treeResponse = shallowRef<DescriptionTreeGetResponse | null>(null);
  const treeError = ref('');
  const selectedTreeNode = ref<SelectedTreeNode | null>(null);
  const expandedGroupIds = ref<Set<string>>(new Set());

  let requestSeq = 0;
  let abort: AbortController | null = null;
  let activeScreenId = '';
  let screenLifecycleGeneration = 0;
  let expandedInit: ExpandedInitialization | null = null;

  function abortInflight(): void {
    abort?.abort();
    abort = null;
  }

  function resetForScreen(screenId: string): void {
    selectedTreeNode.value = null;
    treeResponse.value = null;
    treeError.value = '';
    treeStatus.value = options.hasDescription() ? 'loading' : 'idle';
    screenLifecycleGeneration += 1;
    expandedGroupIds.value = new Set();
    expandedInit = {
      screenId,
      lifecycleGeneration: screenLifecycleGeneration,
      initialized: false,
    };
  }

  function syncSelectionWithTree(): void {
    const response = treeResponse.value;
    const selected = selectedTreeNode.value;
    if (!response || !selected) {
      return;
    }
    if (!nodeExistsInTree(response, selected)) {
      selectedTreeNode.value = null;
      if (selected.type === 'item') {
        options.onClearItemSelection();
      }
    }
  }

  function applyAuthoritativeExpanded(data: DescriptionTreeGetResponse, screenId: string): void {
    const active = collectActiveDescriptionTreeNodeIds(data);
    const defaults = createDefaultExpandedGroupIds(data.description.rootNodes);
    const initialized =
      expandedInit?.screenId === screenId &&
      expandedInit.lifecycleGeneration === screenLifecycleGeneration &&
      expandedInit.initialized;
    expandedGroupIds.value = reconcileExpandedGroupIds({
      activeGroupIds: active.groups,
      previousExpandedGroupIds: expandedGroupIds.value,
      defaultExpandedGroupIds: defaults,
      initialized,
    });
    expandedInit = {
      screenId,
      lifecycleGeneration: screenLifecycleGeneration,
      initialized: true,
    };
  }

  async function loadTree(optionsReload: { refresh?: boolean } = {}): Promise<boolean> {
    const screenId = options.screenId();
    activeScreenId = screenId;

    if (!options.hasDescription()) {
      abortInflight();
      treeStatus.value = 'idle';
      treeResponse.value = null;
      treeError.value = '';
      selectedTreeNode.value = null;
      return false;
    }

    abortInflight();
    abort = new AbortController();
    const seq = ++requestSeq;
    const previousTree = treeResponse.value;
    treeStatus.value = 'loading';
    treeError.value = '';
    // same-screen reload では transient null にせず、失敗時も previous を維持する
    if (!optionsReload.refresh) {
      treeResponse.value = null;
    }

    const result = await fetchDescriptionTree(
      screenId,
      abort.signal,
      options.fetchFn,
    );
    if (seq !== requestSeq || activeScreenId !== options.screenId()) {
      return false;
    }
    if (!result.ok) {
      if (result.aborted) {
        return false;
      }
      if (optionsReload.refresh && previousTree && !treeResponse.value) {
        treeResponse.value = previousTree;
      }
      treeStatus.value = 'error';
      treeError.value = result.error.message || 'Item Tree を取得できませんでした。';
      return false;
    }

    const data = result.data;
    treeResponse.value = data;
    applyAuthoritativeExpanded(data, screenId);

    if (data.description.rootNodes.length === 0) {
      treeStatus.value = 'empty';
    } else {
      treeStatus.value = 'ready';
    }

    syncSelectionWithTree();
    return true;
  }

  async function reloadTree(): Promise<boolean> {
    return loadTree({ refresh: true });
  }

  function toggleGroupExpanded(groupId: string): void {
    const next = new Set(expandedGroupIds.value);
    if (next.has(groupId)) {
      next.delete(groupId);
    } else {
      next.add(groupId);
    }
    expandedGroupIds.value = next;
  }

  function selectTreeItem(itemId: string): void {
    selectedTreeNode.value = { type: 'item', id: itemId };
    options.onSelectItem(itemId);
  }

  function selectTreeGroup(groupId: string): void {
    selectedTreeNode.value = { type: 'group', id: groupId };
    options.onClearItemSelection();
  }

  watch(
    () => options.screenId(),
    (screenId) => {
      resetForScreen(screenId);
      void loadTree();
    },
    { immediate: true },
  );

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      abortInflight();
    });
  }

  return {
    treeStatus,
    treeResponse,
    treeError,
    selectedTreeNode,
    expandedGroupIds,
    loadTree,
    reloadTree,
    toggleGroupExpanded,
    selectTreeItem,
    selectTreeGroup,
  };
}
