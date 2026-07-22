import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteDescriptionGroup,
  isDefiniteMutationRejection,
} from '../../src/viewer/editing/description-mutation-client';
import { fetchDescriptionTree } from '../../src/viewer/editing/description-tree-client';

const SAME_INVALID = 'same-invalid-revision';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const exactLookingTree = {
  revision: SAME_INVALID,
  sourceSchemaVersion: '1.3',
  collectedItemIds: ['leaf-item'],
  description: {
    schemaVersion: '1.3',
    screen: { id: 'grouped', name: 'Grouped', description: '' },
    rootNodes: [
      { type: 'group', id: 'parent-section' },
      { type: 'item', id: 'root-item' },
    ],
    groups: [
      {
        groupId: 'parent-section',
        name: '親グループ',
        kind: 'SECTION',
        description: '親の説明',
        children: [{ type: 'item', id: 'leaf-item' }],
      },
    ],
    items: {
      'leaf-item': {
        name: '末端項目',
        type: 'text',
        description: '',
        note: '',
      },
      'root-item': {
        name: 'ルート項目',
        type: 'text',
        description: '',
        note: '',
      },
    },
    excludedItems: {},
  },
};

describe('Description revision P1 blockers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('A: mutation client は同一 invalid revision を success にしない', async () => {
    const result = await deleteDescriptionGroup(
      'grouped',
      'child-card',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      vi.fn(async () =>
        jsonResponse({ status: 'updated', revision: SAME_INVALID }),
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.httpStatus).toBe(200);
      expect(isDefiniteMutationRejection(result.error)).toBe(false);
    }
  });

  it('B: Tree client は同一 invalid revision を authoritative にしない', async () => {
    const result = await fetchDescriptionTree(
      'grouped',
      undefined,
      vi.fn(async () => jsonResponse(exactLookingTree)),
    );
    expect(result.ok).toBe(false);
  });

  it('C: 同一 invalid revision は client 層で成功 envelope にならない', async () => {
    const mutation = await deleteDescriptionGroup(
      'grouped',
      'child-card',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      vi.fn(async () =>
        jsonResponse({ status: 'updated', revision: SAME_INVALID }),
      ),
    );
    const tree = await fetchDescriptionTree(
      'grouped',
      undefined,
      vi.fn(async () => jsonResponse(exactLookingTree)),
    );
    expect(mutation.ok).toBe(false);
    expect(tree.ok).toBe(false);
    // 両方が失敗するため match-exact に到達できない
  });
});
