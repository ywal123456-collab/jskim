import { describe, expect, it } from 'vitest';
import {
  captureActiveGroupSubtree,
  classifyGroupSubtreeDeletion,
  matchesGroupSubtreeDeleteCapture,
} from '../../src/viewer/editing/group-subtree-delete-helpers';
import type { DescriptionTreeGetResponse } from '../../src/viewer/editing/description-tree-types';

function makeResponse(
  overrides?: Partial<DescriptionTreeGetResponse['description']> & {
    revision?: string;
    collectedItemIds?: string[];
  },
): DescriptionTreeGetResponse {
  const { revision, collectedItemIds, ...descriptionOverrides } = overrides ?? {};
  return {
    revision: revision ?? 'sha256:r1',
    sourceSchemaVersion: '1.3',
    collectedItemIds: collectedItemIds ?? [],
    description: {
      schemaVersion: '1.3',
      screen: { id: 'demo', name: 'Demo', description: '' },
      rootNodes: [
        { type: 'item', id: 'before' },
        { type: 'group', id: 'target' },
        { type: 'item', id: 'after' },
      ],
      groups: [
        {
          groupId: 'target',
          name: '対象',
          kind: 'SECTION',
          description: '対象説明',
          children: [
            { type: 'item', id: 'leaf-item' },
            { type: 'group', id: 'nested' },
          ],
        },
        {
          groupId: 'nested',
          name: 'ネスト',
          kind: 'CARD',
          description: 'ネスト説明',
          children: [{ type: 'item', id: 'deep-item' }],
        },
        {
          groupId: 'other',
          name: '別枝',
          kind: 'SECTION',
          description: '',
          children: [{ type: 'item', id: 'other-item' }],
        },
      ],
      items: {
        before: { name: '前', type: 'text', description: '', note: '' },
        after: { name: '後', type: 'text', description: '', note: '' },
        'leaf-item': {
          name: '葉',
          type: 'text',
          description: '葉説明',
          note: '葉備考',
        },
        'deep-item': {
          name: '深層',
          type: 'number',
          description: '深層説明',
          note: '深層備考',
        },
        'other-item': {
          name: '別',
          type: 'text',
          description: '',
          note: '',
        },
      },
      excludedItems: {},
      ...descriptionOverrides,
    },
  };
}

function deletedTree(revision: string): DescriptionTreeGetResponse {
  return makeResponse({
    revision,
    rootNodes: [
      { type: 'item', id: 'before' },
      { type: 'item', id: 'after' },
    ],
    groups: [
      {
        groupId: 'other',
        name: '別枝',
        kind: 'SECTION',
        description: '',
        children: [{ type: 'item', id: 'other-item' }],
      },
    ],
    items: {
      before: { name: '前', type: 'text', description: '', note: '' },
      after: { name: '後', type: 'text', description: '', note: '' },
      'other-item': {
        name: '別',
        type: 'text',
        description: '',
        note: '',
      },
    },
  });
}

describe('group-subtree-delete-helpers', () => {
  it('空 Group をキャプチャする', () => {
    const response = makeResponse({
      rootNodes: [{ type: 'group', id: 'empty' }],
      groups: [
        {
          groupId: 'empty',
          name: '空',
          kind: 'SECTION',
          children: [],
        },
      ],
      items: {},
    });
    const capture = captureActiveGroupSubtree(response, 'empty');
    expect(capture).toMatchObject({
      groupId: 'empty',
      parentGroupId: null,
      targetIndex: 0,
      descendantGroupCount: 0,
      itemCount: 0,
      containsCollectedItem: false,
      previousSibling: null,
      nextSibling: null,
    });
    expect(capture?.subtreeGroupIds).toEqual(['empty']);
    expect(capture?.subtreeItemIds).toEqual([]);
  });

  it('nested subtree の件数・sibling・parent を取る', () => {
    const response = makeResponse({
      rootNodes: [
        { type: 'item', id: 'before' },
        { type: 'group', id: 'target' },
        { type: 'item', id: 'after' },
        { type: 'group', id: 'other' },
      ],
    });
    const capture = captureActiveGroupSubtree(response, 'target');
    expect(capture).toMatchObject({
      groupId: 'target',
      parentGroupId: null,
      targetIndex: 1,
      previousSibling: { type: 'item', id: 'before' },
      nextSibling: { type: 'item', id: 'after' },
      descendantGroupCount: 1,
      itemCount: 2,
      containsCollectedItem: false,
    });
    expect(capture?.subtreeGroupIds).toEqual(['target', 'nested']);
    expect(capture?.subtreeItemIds).toEqual(['leaf-item', 'deep-item']);
  });

  it('collected Item を含むと containsCollectedItem が true', () => {
    const response = makeResponse({ collectedItemIds: ['deep-item'] });
    const capture = captureActiveGroupSubtree(response, 'target');
    expect(capture?.containsCollectedItem).toBe(true);
  });

  it('他 subtree の node を含めない', () => {
    const response = makeResponse({
      rootNodes: [
        { type: 'group', id: 'target' },
        { type: 'group', id: 'other' },
      ],
    });
    const capture = captureActiveGroupSubtree(response, 'target');
    expect(capture?.subtreeGroupIds).not.toContain('other');
    expect(capture?.subtreeItemIds).not.toContain('other-item');
  });

  it('入力 response を変更しない', () => {
    const response = makeResponse();
    const before = JSON.stringify(response);
    captureActiveGroupSubtree(response, 'target');
    expect(JSON.stringify(response)).toBe(before);
  });

  it('matchesGroupSubtreeDeleteCapture は同一構造で true', () => {
    const response = makeResponse();
    const capture = captureActiveGroupSubtree(response, 'target')!;
    expect(matchesGroupSubtreeDeleteCapture(response, capture)).toBe(true);
  });

  it('classify: exact committed success', () => {
    const capture = captureActiveGroupSubtree(makeResponse(), 'target')!;
    const result = classifyGroupSubtreeDeletion(
      deletedTree('sha256:r2'),
      capture,
      { mutationRevision: 'sha256:r2', captureRevision: 'sha256:r1' },
    );
    expect(result).toEqual({ kind: 'match-exact' });
  });

  it('classify: target still present + same capture revision', () => {
    const capture = captureActiveGroupSubtree(makeResponse(), 'target')!;
    const result = classifyGroupSubtreeDeletion(makeResponse(), capture, {
      mutationRevision: null,
      captureRevision: 'sha256:r1',
    });
    expect(result).toEqual({ kind: 'target-still-present' });
  });

  it('classify: revision divergence', () => {
    const capture = captureActiveGroupSubtree(makeResponse(), 'target')!;
    const result = classifyGroupSubtreeDeletion(
      deletedTree('sha256:r9'),
      capture,
      { mutationRevision: 'sha256:r2', captureRevision: 'sha256:r1' },
    );
    expect(result).toEqual({ kind: 'revision-diverged' });
  });

  it('classify: partial delete', () => {
    const capture = captureActiveGroupSubtree(makeResponse(), 'target')!;
    // target は消えたが nested/deep-item が active tree に残る異常状態
    const partial = makeResponse({
      revision: 'sha256:r2',
      rootNodes: [
        { type: 'item', id: 'before' },
        { type: 'group', id: 'nested' },
        { type: 'item', id: 'after' },
        { type: 'group', id: 'other' },
      ],
      groups: [
        {
          groupId: 'nested',
          name: 'ネスト',
          kind: 'CARD',
          description: 'ネスト説明',
          children: [{ type: 'item', id: 'deep-item' }],
        },
        {
          groupId: 'other',
          name: '別枝',
          kind: 'SECTION',
          description: '',
          children: [{ type: 'item', id: 'other-item' }],
        },
      ],
      items: {
        before: { name: '前', type: 'text', description: '', note: '' },
        after: { name: '後', type: 'text', description: '', note: '' },
        'deep-item': {
          name: '深層',
          type: 'number',
          description: '深層説明',
          note: '深層備考',
        },
        'other-item': {
          name: '別',
          type: 'text',
          description: '',
          note: '',
        },
      },
    });
    const result = classifyGroupSubtreeDeletion(partial, capture, {
      mutationRevision: 'sha256:r2',
      captureRevision: 'sha256:r1',
    });
    expect(result).toEqual({ kind: 'partial-delete' });
  });

  it('classify: incomplete authoritative response', () => {
    const capture = captureActiveGroupSubtree(makeResponse(), 'target')!;
    const incomplete = {
      revision: 'sha256:r2',
      sourceSchemaVersion: '1.3',
      collectedItemIds: [],
      description: null,
    } as unknown as DescriptionTreeGetResponse;
    expect(
      classifyGroupSubtreeDeletion(incomplete, capture, {
        mutationRevision: 'sha256:r2',
      }),
    ).toEqual({ kind: 'incomplete-response' });
  });
});
