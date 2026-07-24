import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { useDescriptionEditor } from '../../src/viewer/editing/useDescriptionEditor';
import type { DescriptionTreeNodeRef } from '../../src/viewer/editing/description-tree-types';
import {
  mockDescriptionRevision,
  stubDescriptionTreeFetch,
  type MockTreeDoc,
} from '../helpers/description-tree-fetch-mock';

function createNestedDoc(overrides?: Partial<MockTreeDoc>): MockTreeDoc {
  return {
    screen: { id: 'demo', name: 'Demo', description: '' },
    itemOrder: ['a', 'b', 'c', 'nested'],
    items: {
      a: { name: 'A', type: 'text', description: '', note: '' },
      b: { name: 'B', type: 'text', description: '', note: '' },
      c: { name: 'C', type: 'text', description: '', note: '' },
      nested: { name: 'N', type: 'text', description: '', note: '' },
      collected: { name: 'Col', type: 'text', description: '', note: '' },
    },
    collectedItemIds: ['collected'],
    rootNodes: [
      { type: 'item', id: 'a' },
      { type: 'group', id: 'g1' },
      { type: 'item', id: 'c' },
    ],
    groups: [
      {
        groupId: 'g1',
        name: 'G1',
        kind: 'SECTION',
        children: [
          { type: 'item', id: 'b' },
          { type: 'group', id: 'g2' },
          { type: 'item', id: 'collected' },
        ],
      },
      {
        groupId: 'g2',
        name: 'G2',
        kind: 'CARD',
        children: [{ type: 'item', id: 'nested' }],
      },
    ],
    ...overrides,
  };
}

function countPosts(
  fetchMock: ReturnType<typeof vi.fn>,
  predicate: (url: string) => boolean,
): number {
  return fetchMock.mock.calls.filter(([url, init]) => {
    const method = ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase();
    return method === 'POST' && predicate(String(url));
  }).length;
}

function wrapFetch(
  base: ReturnType<typeof vi.fn>,
  handler: (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    baseFetch: typeof base,
  ) => Promise<Response>,
): ReturnType<typeof vi.fn> {
  const wrapped = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(input, init, base),
  );
  vi.stubGlobal('fetch', wrapped);
  return wrapped;
}

describe('node move editor state', () => {
  beforeEach(() => {
    window.__JSKIM_SPEC_EDIT__ = {
      enabled: true,
      apiBase: '/_jskim/spec/descriptions',
    };
  });

  afterEach(() => {
    delete window.__JSKIM_SPEC_EDIT__;
    vi.unstubAllGlobals();
  });

  async function mountEditor(initialScreenId = 'demo') {
    const EditorHarness = defineComponent({
      setup() {
        const screenId = ref(initialScreenId);
        const editor = useDescriptionEditor(() => screenId.value);
        return { editor, screenId };
      },
      template: '<span />',
    });
    const router = createRouter({
      history: createMemoryHistory('/spec/'),
      routes: [
        { path: '/screens/:screenId', component: EditorHarness },
        { path: '/', redirect: `/screens/${initialScreenId}` },
      ],
    });
    await router.push(`/screens/${initialScreenId}`);
    await router.isReady();
    const root = mount(
      defineComponent({
        setup() {
          return () => h(RouterView);
        },
      }),
      { global: { plugins: [router] } },
    );
    await flushPromises();
    return {
      root,
      harness: root.findComponent(EditorHarness),
    };
  }

  it('Item reorder success（authoritative）', async () => {
    stubDescriptionTreeFetch({ demo: createNestedDoc() });
    const { harness, root } = await mountEditor();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('demo');
    await flushPromises();
    const result = await editor.moveSelectedNodeDown({ type: 'item', id: 'a' });
    expect(result.status).toBe('committed-refreshed');
    expect(editor.flattenActiveItemIds()).toEqual([
      'b',
      'nested',
      'collected',
      'a',
      'c',
    ]);
    root.unmount();
  });

  it('Group reorder success', async () => {
    stubDescriptionTreeFetch({ demo: createNestedDoc() });
    const { harness, root } = await mountEditor();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('demo');
    await flushPromises();
    const result = await editor.moveSelectedNodeUp({ type: 'group', id: 'g1' });
    expect(result.status).toBe('committed-refreshed');
    expect(editor.snapshot.value?.description.rootNodes.map((n) => n.id)).toEqual(
      ['g1', 'a', 'c'],
    );
    root.unmount();
  });

  it('Item indent / outdent success と expandGroupIds', async () => {
    stubDescriptionTreeFetch({
      demo: createNestedDoc({
        rootNodes: [
          { type: 'group', id: 'g1' },
          { type: 'item', id: 'c' },
        ],
      }),
    });
    const { harness, root } = await mountEditor();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('demo');
    await flushPromises();
    const indent = await editor.indentSelectedNode({ type: 'item', id: 'c' });
    expect(indent.status).toBe('committed-refreshed');
    if (indent.status === 'committed-refreshed') {
      expect(indent.expandGroupIds).toContain('g1');
    }
    const outdent = await editor.outdentSelectedNode({ type: 'item', id: 'c' });
    expect(outdent.status).toBe('committed-refreshed');
    expect(
      editor.snapshot.value?.description.rootNodes.some((n) => n.id === 'c'),
    ).toBe(true);
    root.unmount();
  });

  it('Group subtree indent success', async () => {
    stubDescriptionTreeFetch({
      demo: createNestedDoc({
        rootNodes: [
          { type: 'group', id: 'g1' },
          { type: 'group', id: 'g2' },
        ],
        groups: [
          {
            groupId: 'g1',
            name: 'G1',
            kind: 'SECTION',
            children: [{ type: 'item', id: 'b' }],
          },
          {
            groupId: 'g2',
            name: 'G2',
            kind: 'CARD',
            children: [{ type: 'item', id: 'nested' }],
          },
        ],
      }),
    });
    const { harness, root } = await mountEditor();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('demo');
    await flushPromises();
    const result = await editor.indentSelectedNode({ type: 'group', id: 'g2' });
    expect(result.status).toBe('committed-refreshed');
    const g1 = editor.snapshot.value?.description.groups.find(
      (g) => g.groupId === 'g1',
    );
    expect(
      (g1?.children as DescriptionTreeNodeRef[]).map((c) => c.id),
    ).toEqual(['b', 'g2']);
    root.unmount();
  });

  it('collected Item は移動可能', async () => {
    stubDescriptionTreeFetch({ demo: createNestedDoc() });
    const { harness, root } = await mountEditor();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('demo');
    await flushPromises();
    expect(editor.isCollectedItem('collected')).toBe(true);
    expect(editor.canMoveUp({ type: 'item', id: 'collected' })).toBe(true);
    const result = await editor.moveSelectedNodeUp({
      type: 'item',
      id: 'collected',
    });
    expect(result.status).toBe('committed-refreshed');
    root.unmount();
  });

  it('boundary は POST 0・unavailable', async () => {
    const { getFetchMock } = stubDescriptionTreeFetch({
      demo: createNestedDoc(),
    });
    const { harness, root } = await mountEditor();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('demo');
    await flushPromises();
    const before = countPosts(getFetchMock(), () => true);
    expect(await editor.moveSelectedNodeUp({ type: 'item', id: 'a' })).toEqual({
      status: 'unavailable',
    });
    expect(countPosts(getFetchMock(), () => true)).toBe(before);
    root.unmount();
  });

  it('double command は POST 1', async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const stubbed = stubDescriptionTreeFetch({ demo: createNestedDoc() });
    const base = stubbed.getFetchMock();
    const wrapped = wrapFetch(base, async (input, init, baseFetch) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url.includes('/children/reorder')) {
        await gate;
        return baseFetch(input, init);
      }
      return baseFetch(input, init);
    });

    const { harness, root } = await mountEditor();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('demo');
    await flushPromises();
    const p1 = editor.moveSelectedNodeDown({ type: 'item', id: 'a' });
    await flushPromises();
    const p2 = editor.moveSelectedNodeDown({ type: 'item', id: 'a' });
    expect(await p2).toEqual({ status: 'mutation-rejected' });
    releaseGate();
    const r1 = await p1;
    expect(r1.status).toBe('committed-refreshed');
    expect(
      countPosts(wrapped, (url) => url.includes('/children/reorder')),
    ).toBe(1);
    root.unmount();
  });

  it('revision conflict は tree 不変', async () => {
    stubDescriptionTreeFetch(
      { demo: createNestedDoc() },
      {
        onFetch: (url, method) => {
          if (url.includes('/children/reorder') && method === 'POST') {
            return new Response(
              JSON.stringify({
                code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
                message: '衝突',
                expectedRevision: mockDescriptionRevision(1),
                currentRevision: mockDescriptionRevision(9),
              }),
              { status: 409, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return null;
        },
      },
    );
    const { harness, root } = await mountEditor();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('demo');
    await flushPromises();
    const before = editor.snapshot.value?.description.rootNodes.map((n) => n.id);
    const result = await editor.moveSelectedNodeDown({ type: 'item', id: 'a' });
    expect(result.status).toBe('mutation-rejected');
    expect(editor.snapshot.value?.description.rootNodes.map((n) => n.id)).toEqual(
      before,
    );
    expect(editor.reloadRequired.value).toBe(false);
    root.unmount();
  });

  it('commit-unknown exact recovery', async () => {
    const stubbed = stubDescriptionTreeFetch({ demo: createNestedDoc() });
    const base = stubbed.getFetchMock();
    wrapFetch(base, async (input, init, baseFetch) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url.includes('/children/reorder')) {
        await baseFetch(input, init);
        return new Response('gateway', { status: 502 });
      }
      return baseFetch(input, init);
    });

    const { harness, root } = await mountEditor();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('demo');
    await flushPromises();
    const result = await editor.moveSelectedNodeDown({ type: 'item', id: 'a' });
    expect(result.status).toBe('committed-refreshed');
    expect(editor.snapshot.value?.description.rootNodes.map((n) => n.id)).toEqual(
      ['g1', 'a', 'c'],
    );
    expect(editor.reloadRequired.value).toBe(false);
    root.unmount();
  });

  it('not committed（capture revision 同一）はエラー', async () => {
    const stubbed = stubDescriptionTreeFetch({ demo: createNestedDoc() });
    const base = stubbed.getFetchMock();
    wrapFetch(base, async (input, init, baseFetch) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url.includes('/children/reorder')) {
        return new Response('gateway', { status: 502 });
      }
      return baseFetch(input, init);
    });

    const { harness, root } = await mountEditor();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('demo');
    await flushPromises();
    const before = editor.snapshot.value?.description.rootNodes.map((n) => n.id);
    const result = await editor.moveSelectedNodeDown({ type: 'item', id: 'a' });
    expect(result.status).toBe('not-committed');
    expect(editor.snapshot.value?.description.rootNodes.map((n) => n.id)).toEqual(
      before,
    );
    expect(editor.reloadRequired.value).toBe(false);
    root.unmount();
  });

  it('GET 失敗 → reloadRequired・後続 command 遮断', async () => {
    let postDone = false;
    const stubbed = stubDescriptionTreeFetch({ demo: createNestedDoc() });
    const base = stubbed.getFetchMock();
    wrapFetch(base, async (input, init, baseFetch) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url.includes('/children/reorder')) {
        postDone = true;
        return baseFetch(input, init);
      }
      if (postDone && method === 'GET' && url.includes('/description-tree/')) {
        return new Response('fail', { status: 500 });
      }
      return baseFetch(input, init);
    });

    const { harness, root } = await mountEditor();
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('demo');
    await flushPromises();
    const result = await editor.moveSelectedNodeDown({ type: 'item', id: 'a' });
    expect(result.status).toBe('committed-refresh-failed');
    expect(editor.reloadRequired.value).toBe(true);
    expect(editor.canMoveDown({ type: 'item', id: 'a' })).toBe(false);
    expect(await editor.moveSelectedNodeDown({ type: 'item', id: 'a' })).toEqual(
      { status: 'mutation-rejected' },
    );
    root.unmount();
  });

  it('Screen A late response → B 不変', async () => {
    let release!: (value: Response) => void;
    const hold = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const stubbed = stubDescriptionTreeFetch({
      demo: createNestedDoc(),
      other: {
        screen: { id: 'other', name: 'Other', description: '' },
        itemOrder: ['x'],
        items: {
          x: { name: 'X', type: 'text', description: '', note: '' },
        },
        collectedItemIds: [],
      },
    });
    const base = stubbed.getFetchMock();
    wrapFetch(base, async (input, init, baseFetch) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (
        method === 'POST' &&
        url.includes('demo') &&
        url.includes('/children/reorder')
      ) {
        return hold;
      }
      return baseFetch(input, init);
    });

    const { harness, root } = await mountEditor('demo');
    const editor = harness.vm.editor as ReturnType<typeof useDescriptionEditor>;
    await editor.loadDescription('demo');
    await flushPromises();
    const pending = editor.moveSelectedNodeDown({ type: 'item', id: 'a' });
    await flushPromises();
    harness.vm.screenId = 'other';
    await editor.loadDescription('other', { reason: 'screen-change' });
    await flushPromises();
    const otherRev = editor.revision.value;
    release(
      new Response(
        JSON.stringify({
          status: 'updated',
          revision: mockDescriptionRevision(2),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const outcome = await pending;
    await nextTick();
    expect(outcome.status).toBe('stale-or-aborted');
    expect(editor.revision.value).toBe(otherRev);
    expect(editor.snapshot.value?.description.screen.id).toBe('other');
    root.unmount();
  });
});
