import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import {
  excludeDescriptionItem,
  restoreDescriptionItem,
} from '../../editing/exclude-description-item';
import {
  cloneEditableDocument,
  documentsEqual,
  getSpecEditBootstrap,
  type DescriptionApiError,
  type DescriptionApiGetResponse,
  type DescriptionApiPutResponse,
  type EditableDocument,
} from './types';

export type SaveStatus =
  | 'idle'
  | 'clean'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'error'
  | 'conflict';

/**
 * Description 編集 state と local API 通信。
 */
export function useDescriptionEditor(screenIdRef: () => string) {
  const bootstrap = getSpecEditBootstrap();
  const editingEnabled = Boolean(bootstrap);

  const loadedDocument = ref<EditableDocument | null>(null);
  const draftDocument = ref<EditableDocument | null>(null);
  const revision = ref<string | null>(null);
  /** GET 時点の collected item ID（UI の削除可否。PUT ではサーバーが再検証する） */
  const collectedItemIds = ref<string[]>([]);
  const status = ref<SaveStatus>('idle');
  const statusMessage = ref('');
  const conflictError = ref<DescriptionApiError | null>(null);
  const saving = ref(false);

  const dirty = computed(() => {
    if (!editingEnabled) {
      return false;
    }
    return !documentsEqual(loadedDocument.value, draftDocument.value);
  });

  watch(dirty, (isDirty) => {
    if (saving.value) {
      return;
    }
    if (status.value === 'conflict' || status.value === 'error') {
      return;
    }
    status.value = isDirty ? 'dirty' : 'clean';
  });

  async function loadDescription(screenId: string): Promise<void> {
    if (!bootstrap) {
      return;
    }
    conflictError.value = null;
    statusMessage.value = '';
    const url = `${bootstrap.apiBase}/${encodeURIComponent(screenId)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as DescriptionApiError | null;
      status.value = 'error';
      statusMessage.value =
        err?.message || '画面設計書の読み込みに失敗しました。';
      return;
    }
    const data = (await res.json()) as DescriptionApiGetResponse;
    revision.value = data.revision;
    loadedDocument.value = cloneEditableDocument(data.document);
    draftDocument.value = cloneEditableDocument(data.document);
    collectedItemIds.value = [...(data.collectedItemIds || [])];
    status.value = 'clean';
  }

  function isCollectedItem(itemId: string): boolean {
    return collectedItemIds.value.includes(itemId);
  }

  async function save(): Promise<boolean> {
    if (!bootstrap || !draftDocument.value || !revision.value || saving.value) {
      return false;
    }
    saving.value = true;
    status.value = 'saving';
    statusMessage.value = '';
    conflictError.value = null;

    try {
      const url = `${bootstrap.apiBase}/${encodeURIComponent(screenIdRef())}`;
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expectedRevision: revision.value,
          document: draftDocument.value,
        }),
      });

      if (res.status === 409) {
        const err = (await res.json()) as DescriptionApiError;
        conflictError.value = err;
        status.value = 'conflict';
        statusMessage.value =
          err.message || '画面設計書が別の場所で変更されています。';
        return false;
      }

      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as DescriptionApiError | null;
        status.value = 'error';
        if (err?.code === 'SPEC_DESCRIPTION_MANUAL_ITEM_EXCLUDE_NOT_ALLOWED') {
          statusMessage.value =
            '実装画面と連携していない項目は設計対象から除外できません。\n最新の画面設計書を再読み込みしてください。';
        } else {
          statusMessage.value = err?.message || '保存に失敗しました。';
        }
        return false;
      }

      const data = (await res.json()) as DescriptionApiPutResponse;
      revision.value = data.revision;
      loadedDocument.value = cloneEditableDocument(draftDocument.value);
      status.value = 'saved';
      statusMessage.value = '保存しました。';
      return true;
    } catch (err) {
      status.value = 'error';
      statusMessage.value =
        err instanceof Error ? err.message : '保存に失敗しました。';
      return false;
    } finally {
      saving.value = false;
    }
  }

  function cancel(): void {
    if (!loadedDocument.value) {
      return;
    }
    draftDocument.value = cloneEditableDocument(loadedDocument.value);
    conflictError.value = null;
    status.value = 'clean';
    statusMessage.value = '';
  }

  async function reloadLatest(): Promise<void> {
    await loadDescription(screenIdRef());
  }

  function updateScreenField(
    field: 'name' | 'description',
    value: string,
  ): void {
    if (!draftDocument.value) {
      return;
    }
    draftDocument.value = {
      ...draftDocument.value,
      screen: {
        ...draftDocument.value.screen,
        [field]: value,
      },
    };
  }

  function updateItemField(
    itemId: string,
    field: 'name' | 'type' | 'description' | 'note',
    value: string,
  ): void {
    if (!draftDocument.value) {
      return;
    }
    const current = draftDocument.value.items[itemId] || {
      name: '',
      type: '',
      description: '',
      note: '',
    };
    draftDocument.value = {
      ...draftDocument.value,
      items: {
        ...draftDocument.value.items,
        [itemId]: {
          ...current,
          [field]: value,
        },
      },
    };
  }

  /**
   * 手動で新しい項目を追加する（itemOrder の末尾に追加）。
   * 重複 ID の場合は何もせず false を返す。
   */
  function addItem(item: {
    itemId: string;
    name: string;
    type: string;
    description: string;
    note: string;
  }): boolean {
    if (!draftDocument.value) {
      return false;
    }
    const id = item.itemId.trim();
    if (!id || draftDocument.value.items[id]) {
      return false;
    }
    draftDocument.value = {
      ...draftDocument.value,
      itemOrder: [...draftDocument.value.itemOrder, id],
      items: {
        ...draftDocument.value.items,
        [id]: {
          name: item.name,
          type: item.type,
          description: item.description,
          note: item.note,
        },
      },
    };
    return true;
  }

  function swapItemOrder(itemId: string, direction: -1 | 1): void {
    if (!draftDocument.value) {
      return;
    }
    const order = draftDocument.value.itemOrder;
    const index = order.indexOf(itemId);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= order.length) {
      return;
    }
    const nextOrder = [...order];
    [nextOrder[index], nextOrder[targetIndex]] = [
      nextOrder[targetIndex],
      nextOrder[index],
    ];
    draftDocument.value = {
      ...draftDocument.value,
      itemOrder: nextOrder,
    };
  }

  function moveItemUp(itemId: string): void {
    swapItemOrder(itemId, -1);
  }

  function moveItemDown(itemId: string): void {
    swapItemOrder(itemId, 1);
  }

  /**
   * 項目を複製する。新 ID を原項目の直後に挿入する。
   * 重複 ID / 原項目不在の場合は false。
   */
  function duplicateItem(
    sourceItemId: string,
    item: {
      itemId: string;
      name: string;
      type: string;
      description: string;
      note: string;
    },
  ): boolean {
    if (!draftDocument.value) {
      return false;
    }
    const sourceId = sourceItemId.trim();
    const newId = item.itemId.trim();
    if (!sourceId || !newId || draftDocument.value.items[newId]) {
      return false;
    }
    if (!draftDocument.value.items[sourceId]) {
      return false;
    }
    const order = [...draftDocument.value.itemOrder];
    const sourceIndex = order.indexOf(sourceId);
    if (sourceIndex === -1) {
      return false;
    }
    order.splice(sourceIndex + 1, 0, newId);
    draftDocument.value = {
      ...draftDocument.value,
      itemOrder: order,
      items: {
        ...draftDocument.value.items,
        [newId]: {
          name: item.name,
          type: item.type,
          description: item.description,
          note: item.note,
        },
      },
    };
    return true;
  }

  /**
   * 手動項目を draft から削除する。
   * collected 項目はクライアント側でも拒否する（サーバーでも再検証）。
   */
  function removeItem(itemId: string): boolean {
    if (!draftDocument.value) {
      return false;
    }
    const id = itemId.trim();
    if (!id || !draftDocument.value.items[id]) {
      return false;
    }
    if (isCollectedItem(id)) {
      return false;
    }
    const { [id]: _removed, ...restItems } = draftDocument.value.items;
    draftDocument.value = {
      ...draftDocument.value,
      itemOrder: draftDocument.value.itemOrder.filter((entry) => entry !== id),
      items: restItems,
    };
    return true;
  }

  /**
   * collected 項目を設計対象から除外する（draft のみ。保存は別途）。
   */
  function excludeItem(itemId: string): boolean {
    if (!draftDocument.value) {
      return false;
    }
    const id = itemId.trim();
    if (!id || !isCollectedItem(id)) {
      return false;
    }
    try {
      draftDocument.value = excludeDescriptionItem(
        draftDocument.value,
        id,
      ) as EditableDocument;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 除外項目を設計対象へ戻す（draft のみ。itemOrder 末尾へ追加）。
   */
  function restoreItem(itemId: string): boolean {
    if (!draftDocument.value) {
      return false;
    }
    const id = itemId.trim();
    if (!id || !draftDocument.value.excludedItems?.[id]) {
      return false;
    }
    try {
      draftDocument.value = restoreDescriptionItem(
        draftDocument.value,
        id,
      ) as EditableDocument;
      return true;
    } catch {
      return false;
    }
  }

  function onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!dirty.value) {
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
    window.removeEventListener('beforeunload', onBeforeUnload);
  });

  onBeforeRouteLeave((_to, _from, next) => {
    if (!dirty.value) {
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
    loadedDocument,
    draftDocument,
    revision,
    collectedItemIds,
    status,
    statusMessage,
    conflictError,
    dirty,
    saving,
    loadDescription,
    save,
    cancel,
    reloadLatest,
    updateScreenField,
    updateItemField,
    addItem,
    duplicateItem,
    removeItem,
    excludeItem,
    restoreItem,
    isCollectedItem,
    moveItemUp,
    moveItemDown,
  };
}
