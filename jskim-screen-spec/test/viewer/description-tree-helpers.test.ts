import { describe, expect, it } from 'vitest';
import {
  collectActiveDescriptionTreeNodeIds,
  findActiveDescriptionGroup,
  nodeExistsInTree,
  reconcileExpandedGroupIds,
} from '../../src/viewer/editing/description-tree-helpers';
import type { DescriptionTreeGetResponse } from '../../src/viewer/editing/description-tree-types';

function tree(overrides?: {
  rootNodes?: DescriptionTreeGetResponse['description']['rootNodes'];
  groups?: DescriptionTreeGetResponse['description']['groups'];
  items?: DescriptionTreeGetResponse['description']['items'];
  excludedItems?: DescriptionTreeGetResponse['description']['excludedItems'];
}): DescriptionTreeGetResponse {
  return {
    revision: 'sha256:r1',
    sourceSchemaVersion: '1.3',
    collectedItemIds: ['leaf-item'],
    description: {
      schemaVersion: '1.3',
      screen: { id: 's', name: 'S', description: '' },
      rootNodes: overrides?.rootNodes ?? [{ type: 'group', id: 'parent' }],
      groups: overrides?.groups ?? [
        {
          groupId: 'parent',
          name: '親',
          kind: 'SECTION',
          children: [{ type: 'group', id: 'child' }],
        },
        {
          groupId: 'child',
          name: '子',
          kind: 'CARD',
          children: [{ type: 'item', id: 'leaf-item' }],
        },
      ],
      items: overrides?.items ?? {
        'leaf-item': {
          name: '末端',
          type: 'text',
          description: '',
          note: '',
        },
      },
      excludedItems: overrides?.excludedItems ?? {},
    },
  };
}

describe('description-tree-helpers active tree', () => {
  it('nested Group / Item を active と判定する', () => {
    const response = tree();
    const active = collectActiveDescriptionTreeNodeIds(response);
    expect([...active.groups].sort()).toEqual(['child', 'parent']);
    expect([...active.items]).toEqual(['leaf-item']);
    expect(findActiveDescriptionGroup(response, 'child')?.name).toBe('子');
    expect(nodeExistsInTree(response, { type: 'group', id: 'child' })).toBe(true);
    expect(nodeExistsInTree(response, { type: 'item', id: 'leaf-item' })).toBe(
      true,
    );
  });

  it('groups[] だけの orphan Group は inactive', () => {
    const response = tree({
      rootNodes: [{ type: 'group', id: 'parent' }],
      groups: [
        {
          groupId: 'parent',
          name: '親',
          kind: 'SECTION',
          children: [{ type: 'item', id: 'leaf-item' }],
        },
        {
          groupId: 'orphan-group',
          name: '孤児',
          kind: 'CARD',
          children: [],
        },
      ],
    });
    expect(
      nodeExistsInTree(response, { type: 'group', id: 'orphan-group' }),
    ).toBe(false);
    expect(findActiveDescriptionGroup(response, 'orphan-group')).toBeNull();
  });

  it('items 定義だけの orphan Item は inactive', () => {
    const response = tree({
      items: {
        'leaf-item': {
          name: '末端',
          type: 'text',
          description: '',
          note: '',
        },
        'orphan-item': {
          name: '孤児項目',
          type: 'text',
          description: '',
          note: '',
        },
      },
    });
    expect(
      nodeExistsInTree(response, { type: 'item', id: 'orphan-item' }),
    ).toBe(false);
  });

  it('excludedItems だけの Item は active ではない', () => {
    const response = tree({
      items: {
        'leaf-item': {
          name: '末端',
          type: 'text',
          description: '',
          note: '',
        },
      },
      excludedItems: {
        'excluded-item': {
          name: '除外',
          type: 'text',
          description: '',
          note: '',
        },
      },
    });
    expect(
      nodeExistsInTree(response, { type: 'item', id: 'excluded-item' }),
    ).toBe(false);
  });

  it('cycle でも無限ループせず deterministic', () => {
    const response = tree({
      rootNodes: [{ type: 'group', id: 'a' }],
      groups: [
        {
          groupId: 'a',
          name: 'A',
          kind: 'SECTION',
          children: [{ type: 'group', id: 'b' }],
        },
        {
          groupId: 'b',
          name: 'B',
          kind: 'CARD',
          children: [{ type: 'group', id: 'a' }],
        },
      ],
      items: {},
    });
    const active = collectActiveDescriptionTreeNodeIds(response);
    expect([...active.groups].sort()).toEqual(['a', 'b']);
    expect(active.items.size).toBe(0);
  });
});

describe('reconcileExpandedGroupIds', () => {
  it('未初期化なら defaults ∩ active を適用する', () => {
    const result = reconcileExpandedGroupIds({
      activeGroupIds: new Set(['root-a', 'child']),
      previousExpandedGroupIds: new Set(),
      defaultExpandedGroupIds: new Set(['root-a']),
      initialized: false,
    });
    expect([...result]).toEqual(['root-a']);
  });

  it('初期化済みの空 Set は空のまま（defaults を再適用しない）', () => {
    const result = reconcileExpandedGroupIds({
      activeGroupIds: new Set(['root-a', 'child']),
      previousExpandedGroupIds: new Set(),
      defaultExpandedGroupIds: new Set(['root-a']),
      initialized: true,
    });
    expect(result.size).toBe(0);
  });

  it('初期化済みなら previous ∩ active のみ', () => {
    const result = reconcileExpandedGroupIds({
      activeGroupIds: new Set(['root-a', 'child']),
      previousExpandedGroupIds: new Set(['root-a', 'orphan']),
      defaultExpandedGroupIds: new Set(['root-a']),
      initialized: true,
    });
    expect([...result]).toEqual(['root-a']);
  });
});
