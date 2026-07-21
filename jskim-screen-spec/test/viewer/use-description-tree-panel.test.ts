import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { useDescriptionTreePanel } from '../../src/viewer/editing/use-description-tree-panel.js';
import type { DescriptionTreeGetResponse } from '../../src/viewer/editing/description-tree-types.js';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const treeA: DescriptionTreeGetResponse = {
  revision: 'sha256:' + 'a'.repeat(64),
  sourceSchemaVersion: '1.2',
  description: {
    schemaVersion: '1.3',
    screen: { id: 'screen-a', name: 'A', description: '' },
    rootNodes: [
      { type: 'group', id: 'section' },
      { type: 'item', id: 'item-a' },
    ],
    groups: [
      {
        groupId: 'section',
        name: 'Section',
        kind: 'SECTION',
        children: [{ type: 'item', id: 'item-b' }],
      },
    ],
    items: {
      'item-a': { name: 'A', type: 'text', description: '', note: '' },
      'item-b': { name: 'B', type: 'text', description: '', note: '' },
    },
    excludedItems: { excluded: { name: 'X', type: '', description: '', note: '' } },
  },
};

const treeB: DescriptionTreeGetResponse = {
  revision: 'sha256:' + 'b'.repeat(64),
  sourceSchemaVersion: '1.3',
  description: {
    schemaVersion: '1.3',
    screen: { id: 'screen-b', name: 'B', description: '' },
    rootNodes: [{ type: 'item', id: 'only-b' }],
    groups: [],
    items: {
      'only-b': { name: 'Only B', type: 'text', description: '', note: '' },
    },
    excludedItems: {},
  },
};

function mountPanel(options: {
  fetchFn: typeof fetch;
  screenId?: ReturnType<typeof ref<string>>;
  hasDescription?: () => boolean;
}) {
  const screenId = options.screenId ?? ref('screen-a');
  const selectedItemId = ref<string | null>(null);
  let api: ReturnType<typeof useDescriptionTreePanel> | null = null;
  const Comp = defineComponent({
    setup() {
      api = useDescriptionTreePanel({
        screenId: () => screenId.value ?? '',
        hasDescription: options.hasDescription ?? (() => true),
        onSelectItem: (itemId) => {
          selectedItemId.value = itemId;
        },
        onClearItemSelection: () => {
          selectedItemId.value = null;
        },
        fetchFn: options.fetchFn,
      });
      return () => null;
    },
  });
  const wrapper = mount(Comp);
  return { wrapper, api: api!, screenId, selectedItemId };
}

describe('useDescriptionTreePanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Screen B 응답이 늦게 도착해도 A를 덮어쓰지 않는다', async () => {
    const delays = new Map<string, number>([
      ['screen-a', 30],
      ['screen-b', 0],
    ]);
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const id = decodeURIComponent(url.split('/').pop() || 'missing');
      await new Promise((resolve) => {
        setTimeout(resolve, delays.get(id) ?? 0);
      });
      if (id === 'screen-a') {
        return jsonResponse(treeA);
      }
      return jsonResponse(treeB);
    });
    const { api, screenId } = mountPanel({ fetchFn });
    await flushPromises();
    screenId.value = 'screen-b';
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await flushPromises();
    expect(api.treeResponse.value?.description.items).toHaveProperty('only-b');
  });

  it('reload で expanded と selection を維持する', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(treeA));
    const { api } = mountPanel({ fetchFn });
    await flushPromises();
    api.toggleGroupExpanded('section');
    api.selectTreeItem('item-a');
    await api.reloadTree();
    await flushPromises();
    expect(api.expandedGroupIds.value.has('section')).toBe(true);
    expect(api.selectedTreeNode.value).toEqual({ type: 'item', id: 'item-a' });
  });

  it('GET 실패 시 error 상태', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ code: 'SPEC_DESCRIPTION_NOT_FOUND', message: '見つかりません。' }, 404),
    );
    const { api } = mountPanel({ fetchFn });
    await flushPromises();
    expect(api.treeStatus.value).toBe('error');
    expect(api.treeError.value).toContain('見つかりません');
  });

  it('Group 선택 시 Item selection을 해제한다', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(treeA));
    const { api, selectedItemId } = mountPanel({ fetchFn });
    await flushPromises();
    api.selectTreeItem('item-a');
    expect(selectedItemId.value).toBe('item-a');
    api.selectTreeGroup('section');
    expect(selectedItemId.value).toBeNull();
    expect(api.selectedTreeNode.value).toEqual({ type: 'group', id: 'section' });
  });
});
