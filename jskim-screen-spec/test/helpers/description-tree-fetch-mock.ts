import { vi } from 'vitest';

/** test mock 用の canonical Description revision（sha256: + 64 hex） */
export function mockDescriptionRevision(n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('mockDescriptionRevision requires a non-negative integer');
  }
  return `sha256:${n.toString(16).padStart(64, '0')}`;
}

export type MockItemFields = {
  name: string;
  type: string;
  description: string;
  note: string;
};

export type MockTreeNodeRef = { type: 'group' | 'item'; id: string };

export type MockTreeGroup = {
  groupId: string;
  name: string;
  kind: string;
  description?: string;
  children: MockTreeNodeRef[];
};

export type MockTreeDoc = {
  screen: { id: string; name: string; description: string };
  itemOrder: string[];
  items: Record<string, MockItemFields>;
  excludedItems?: Record<string, MockItemFields>;
  collectedItemIds?: string[];
  /** 指定時は v1.3 tree 表現として優先 */
  rootNodes?: MockTreeNodeRef[];
  groups?: MockTreeGroup[];
};

type TreeEntry = {
  revision: string;
  doc: MockTreeDoc;
};

function parseBody(init?: RequestInit): Record<string, unknown> {
  if (!init?.body || typeof init.body !== 'string') {
    return {};
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

function toTreeJson(entry: TreeEntry) {
  const { doc, revision } = entry;
  const rootNodes =
    doc.rootNodes ?? doc.itemOrder.map((id) => ({ type: 'item' as const, id }));
  return {
    revision,
    sourceSchemaVersion: doc.groups?.length ? '1.3' : '1.2',
    collectedItemIds: doc.collectedItemIds ?? [],
    description: {
      schemaVersion: '1.3',
      screen: doc.screen,
      rootNodes,
      groups: doc.groups ?? [],
      items: doc.items,
      excludedItems: doc.excludedItems ?? {},
    },
  };
}

/**
 * Description Tree GET + mutation API の簡易 mock（component test 用）。
 */
export function stubDescriptionTreeFetch(
  initial: Record<string, MockTreeDoc>,
  options?: {
    onFetch?: (
      url: string,
      method: string,
      body: Record<string, unknown>,
    ) => Response | Promise<Response> | null;
    extraHandler?: (
      url: string,
      init?: RequestInit,
    ) => Response | null | undefined;
  },
): { state: Map<string, TreeEntry>; getFetchMock: () => ReturnType<typeof vi.fn> } {
  const state = new Map<string, TreeEntry>();
  for (const [screenId, doc] of Object.entries(initial)) {
    state.set(screenId, {
      revision: mockDescriptionRevision(1),
      doc: {
        ...doc,
        excludedItems: doc.excludedItems ?? {},
      },
    });
  }
  let revCounter = 1;

  function bumpRevision(entry: TreeEntry): string {
    revCounter += 1;
    entry.revision = mockDescriptionRevision(revCounter);
    return entry.revision;
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const extra = options?.extraHandler?.(url, init);
    if (extra) {
      return extra;
    }

    const treeMatch = url.match(/\/_jskim\/spec\/description-tree\/([^/?#]+)/);
    if (treeMatch) {
      const screenId = decodeURIComponent(treeMatch[1]);
      const entry = state.get(screenId);
      if (!entry) {
        return new Response('not found', { status: 404 });
      }

      if (method === 'GET') {
        return new Response(JSON.stringify(toTreeJson(entry)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const body = parseBody(init);
      const custom = options?.onFetch?.(url, method, body);
      if (custom) {
        return await custom;
      }

      const suffix = url.slice(url.indexOf(treeMatch[1]) + treeMatch[1].length);

      if (suffix === '/screen' && method === 'PATCH') {
        if (typeof body.name === 'string') {
          entry.doc.screen.name = body.name;
        }
        if (typeof body.description === 'string') {
          entry.doc.screen.description = body.description;
        }
        return new Response(
          JSON.stringify({ status: 'updated', revision: bumpRevision(entry) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (suffix === '/items' && method === 'POST') {
        const itemId = String(body.itemId ?? '');
        entry.doc.items[itemId] = {
          name: String(body.name ?? ''),
          type: String(body.type ?? ''),
          description: String(body.description ?? ''),
          note: String(body.note ?? ''),
        };
        const insertIndex =
          typeof body.insertIndex === 'number' ? body.insertIndex : entry.doc.itemOrder.length;
        entry.doc.itemOrder.splice(insertIndex, 0, itemId);
        return new Response(
          JSON.stringify({ status: 'updated', revision: bumpRevision(entry) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const itemPatch = suffix.match(/^\/items\/([^/]+)$/);
      if (itemPatch && method === 'PATCH') {
        const itemId = decodeURIComponent(itemPatch[1]);
        const item = entry.doc.items[itemId];
        if (item) {
          for (const key of ['name', 'type', 'description', 'note'] as const) {
            if (typeof body[key] === 'string') {
              item[key] = body[key];
            }
          }
        }
        return new Response(
          JSON.stringify({ status: 'updated', revision: bumpRevision(entry) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const deleteMatch = suffix.match(/^\/items\/([^/]+)\/delete$/);
      if (deleteMatch && method === 'POST') {
        const itemId = decodeURIComponent(deleteMatch[1]);
        if ((entry.doc.collectedItemIds ?? []).includes(itemId)) {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_COLLECTED_ITEM_DELETE_NOT_ALLOWED',
              message: '収集項目は削除できません。',
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          );
        }
        delete entry.doc.items[itemId];
        entry.doc.itemOrder = entry.doc.itemOrder.filter((id) => id !== itemId);
        return new Response(
          JSON.stringify({ status: 'updated', revision: bumpRevision(entry) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const excludeMatch = suffix.match(/^\/items\/([^/]+)\/exclude$/);
      if (excludeMatch && method === 'POST') {
        const itemId = decodeURIComponent(excludeMatch[1]);
        if (!(entry.doc.collectedItemIds ?? []).includes(itemId)) {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_MANUAL_ITEM_EXCLUDE_NOT_ALLOWED',
              message: '手動項目は除外できません。',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (!entry.doc.excludedItems) {
          entry.doc.excludedItems = {};
        }
        entry.doc.excludedItems[itemId] = entry.doc.items[itemId];
        delete entry.doc.items[itemId];
        entry.doc.itemOrder = entry.doc.itemOrder.filter((id) => id !== itemId);
        return new Response(
          JSON.stringify({ status: 'updated', revision: bumpRevision(entry) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const restoreMatch = suffix.match(/^\/items\/([^/]+)\/restore$/);
      if (restoreMatch && method === 'POST') {
        const itemId = decodeURIComponent(restoreMatch[1]);
        const excluded = entry.doc.excludedItems?.[itemId];
        if (excluded) {
          if (!entry.doc.excludedItems) {
            entry.doc.excludedItems = {};
          }
          entry.doc.items[itemId] = excluded;
          delete entry.doc.excludedItems[itemId];
          entry.doc.itemOrder.push(itemId);
        }
        return new Response(
          JSON.stringify({ status: 'updated', revision: bumpRevision(entry) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (suffix === '/children/reorder' && method === 'POST') {
        const ordered = body.orderedNodes as Array<{ type: string; id: string }>;
        if (Array.isArray(ordered) && body.parentGroupId == null) {
          entry.doc.itemOrder = ordered.filter((node) => node.type === 'item').map((node) => node.id);
        }
        return new Response(
          JSON.stringify({ status: 'updated', revision: bumpRevision(entry) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const groupPatch = suffix.match(/^\/groups\/([^/]+)$/);
      if (groupPatch && method === 'PATCH') {
        const groupId = decodeURIComponent(groupPatch[1]);
        const groups = entry.doc.groups ?? [];
        const group = groups.find((entryGroup) => entryGroup.groupId === groupId);
        if (!group) {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
              message: 'Group が見つかりません。',
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        }
        let changed = false;
        if (typeof body.name === 'string' && body.name !== group.name) {
          group.name = body.name;
          changed = true;
        }
        if (typeof body.kind === 'string' && body.kind !== group.kind) {
          group.kind = body.kind;
          changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'description')) {
          if (body.description === null || body.description === '') {
            if (group.description !== undefined) {
              delete group.description;
              changed = true;
            }
          } else if (
            typeof body.description === 'string' &&
            body.description !== group.description
          ) {
            group.description = body.description;
            changed = true;
          }
        }
        return new Response(
          JSON.stringify({
            status: changed ? 'updated' : 'unchanged',
            revision: changed ? bumpRevision(entry) : entry.revision,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (suffix === '/groups' && method === 'POST') {
        const groupId = String(body.groupId ?? '');
        if (!groupId) {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_INVALID',
              message: 'groupId が必要です。',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (!entry.doc.groups) {
          entry.doc.groups = [];
        }
        if (!entry.doc.rootNodes) {
          entry.doc.rootNodes = entry.doc.itemOrder.map((id) => ({
            type: 'item' as const,
            id,
          }));
        }
        const existingGroupIds = new Set(
          entry.doc.groups.map((group) => group.groupId),
        );
        if (existingGroupIds.has(groupId)) {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_GROUP_ALREADY_EXISTS',
              message: `groupId が既に存在します: ${groupId}`,
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (
          Object.prototype.hasOwnProperty.call(entry.doc.items, groupId) ||
          Object.prototype.hasOwnProperty.call(
            entry.doc.excludedItems ?? {},
            groupId,
          )
        ) {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
              message: `groupId と itemId が衝突しています: ${groupId}`,
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const parentGroupId =
          body.parentGroupId == null || body.parentGroupId === ''
            ? undefined
            : String(body.parentGroupId);
        const newGroup: MockTreeGroup = {
          groupId,
          name: String(body.name ?? ''),
          kind: String(body.kind ?? 'SECTION'),
          children: [],
        };
        if (
          typeof body.description === 'string' &&
          body.description.trim() !== ''
        ) {
          newGroup.description = body.description;
        }
        entry.doc.groups.push(newGroup);
        const ref = { type: 'group' as const, id: groupId };
        if (parentGroupId === undefined) {
          entry.doc.rootNodes.push(ref);
        } else {
          const parent = entry.doc.groups.find(
            (group) => group.groupId === parentGroupId,
          );
          if (!parent) {
            entry.doc.groups = entry.doc.groups.filter(
              (group) => group.groupId !== groupId,
            );
            return new Response(
              JSON.stringify({
                code: 'SPEC_DESCRIPTION_GROUP_PARENT_NOT_FOUND',
                message: `親 Group が見つかりません: ${parentGroupId}`,
              }),
              { status: 404, headers: { 'Content-Type': 'application/json' } },
            );
          }
          parent.children.push(ref);
        }
        return new Response(
          JSON.stringify({ status: 'updated', revision: bumpRevision(entry) }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const groupSubtreeDelete = suffix.match(
        /^\/groups\/([^/]+)\/delete-subtree$/,
      );
      if (groupSubtreeDelete && method === 'POST') {
        const groupId = decodeURIComponent(groupSubtreeDelete[1]);
        if (!entry.doc.groups || !entry.doc.rootNodes) {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
              message: 'Group が見つかりません。',
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        }
        const groupMap = new Map(
          entry.doc.groups.map((group) => [group.groupId, group]),
        );
        if (!groupMap.has(groupId)) {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
              message: `Group が見つかりません: ${groupId}`,
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const subtreeGroupIds: string[] = [];
        const subtreeItemIds: string[] = [];
        const walk = (id: string): void => {
          subtreeGroupIds.push(id);
          const group = groupMap.get(id);
          if (!group) {
            return;
          }
          for (const child of group.children) {
            if (child.type === 'item') {
              subtreeItemIds.push(child.id);
            } else if (child.type === 'group') {
              walk(child.id);
            }
          }
        };
        walk(groupId);

        const collected = new Set(entry.doc.collectedItemIds ?? []);
        if (subtreeItemIds.some((id) => collected.has(id))) {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_GROUP_SUBTREE_CONTAINS_COLLECTED_ITEM',
              message: '配下に collected Item があるため削除できません。',
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const removeFromContainer = (container: MockTreeNodeRef[]): boolean => {
          const index = container.findIndex(
            (ref) => ref.type === 'group' && ref.id === groupId,
          );
          if (index < 0) {
            return false;
          }
          container.splice(index, 1);
          return true;
        };

        let found = removeFromContainer(entry.doc.rootNodes);
        if (!found) {
          for (const group of entry.doc.groups) {
            if (removeFromContainer(group.children)) {
              found = true;
              break;
            }
          }
        }
        if (!found) {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_NODE_NOT_FOUND',
              message: `Group がツリー上に存在しません: ${groupId}`,
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const removeGroupIds = new Set(subtreeGroupIds);
        const removeItemIds = new Set(subtreeItemIds);
        entry.doc.groups = entry.doc.groups.filter(
          (group) => !removeGroupIds.has(group.groupId),
        );
        for (const itemId of removeItemIds) {
          delete entry.doc.items[itemId];
        }
        entry.doc.itemOrder = entry.doc.itemOrder.filter(
          (id) => !removeItemIds.has(id),
        );

        return new Response(
          JSON.stringify({ status: 'updated', revision: bumpRevision(entry) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const groupDelete = suffix.match(/^\/groups\/([^/]+)\/delete$/);
      if (groupDelete && method === 'POST') {
        const groupId = decodeURIComponent(groupDelete[1]);
        if (!entry.doc.groups || !entry.doc.rootNodes) {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
              message: 'Group が見つかりません。',
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        }
        const target = entry.doc.groups.find((group) => group.groupId === groupId);
        if (!target) {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
              message: `Group が見つかりません: ${groupId}`,
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const promoteInto = (
          container: MockTreeNodeRef[],
        ): boolean => {
          const index = container.findIndex(
            (ref) => ref.type === 'group' && ref.id === groupId,
          );
          if (index < 0) {
            return false;
          }
          container.splice(index, 1, ...target.children.map((child) => ({ ...child })));
          return true;
        };

        let found = promoteInto(entry.doc.rootNodes);
        if (!found) {
          for (const group of entry.doc.groups) {
            if (promoteInto(group.children)) {
              found = true;
              break;
            }
          }
        }
        if (!found) {
          return new Response(
            JSON.stringify({
              code: 'SPEC_DESCRIPTION_NODE_NOT_FOUND',
              message: `Group がツリー上に存在しません: ${groupId}`,
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        }
        entry.doc.groups = entry.doc.groups.filter(
          (group) => group.groupId !== groupId,
        );
        return new Response(
          JSON.stringify({ status: 'updated', revision: bumpRevision(entry) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    return new Response('not found', { status: 404 });
  });

  vi.stubGlobal('fetch', fetchMock);
  return { state, getFetchMock: () => fetchMock };
}
