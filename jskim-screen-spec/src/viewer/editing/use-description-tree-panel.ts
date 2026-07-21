import { getCurrentInstance, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { fetchDescriptionTree } from './description-tree-client.js';
import {
  buildGroupMap,
  createDefaultExpandedGroupIds,
  mergeExpandedGroupIds,
  nodeExistsInTree,
  pruneExpandedGroupIds,
} from './description-tree-helpers.js';
import type {
  DescriptionTreeGetResponse,
  SelectedTreeNode,
} from './description-tree-types.js';

export type DescriptionTreePanelStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

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

  const expandedByScreen = new Map<string, Set<string>>();
  let requestSeq = 0;
  let abort: AbortController | null = null;
  let activeScreenId = '';

  function abortInflight(): void {
    abort?.abort();
    abort = null;
  }

  function resetForScreen(screenId: string): void {
    selectedTreeNode.value = null;
    treeResponse.value = null;
    treeError.value = '';
    treeStatus.value = options.hasDescription() ? 'loading' : 'idle';
    const saved = expandedByScreen.get(screenId);
    expandedGroupIds.value = saved ? new Set(saved) : new Set();
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
    treeStatus.value = 'loading';
    treeError.value = '';
    treeResponse.value = null;

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
      treeStatus.value = 'error';
      treeError.value = result.error.message || 'Item Tree を取得できませんでした。';
      return false;
    }

    const data = result.data;
    treeResponse.value = data;
    const groupMap = buildGroupMap(data);
    const defaults = createDefaultExpandedGroupIds(data.description.rootNodes);
    const previous = expandedByScreen.get(screenId) ?? expandedGroupIds.value;
    const merged = mergeExpandedGroupIds(previous, defaults, groupMap);
    const pruned = pruneExpandedGroupIds(merged, groupMap);
    expandedGroupIds.value = pruned;
    expandedByScreen.set(screenId, new Set(pruned));

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
    expandedByScreen.set(options.screenId(), new Set(next));
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
