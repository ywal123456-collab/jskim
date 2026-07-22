import { describe, expect, it } from 'vitest';
import {
  buildExpectedContainerAfterUngroup,
  captureActiveGroupUngroupContext,
  classifyGroupUngroupAuthoritative,
  matchesUngroupCapture,
} from '../../src/viewer/editing/group-ungroup-helpers';
import type { DescriptionTreeGetResponse } from '../../src/viewer/editing/description-tree-types';

function makeResponse(
  overrides?: Partial<DescriptionTreeGetResponse['description']> & {
    revision?: string;
  },
): DescriptionTreeGetResponse {
  const { revision, ...descriptionOverrides } = overrides ?? {};
  return {
    revision: revision ?? 'sha256:r1',
    sourceSchemaVersion: '1.3',
    collectedItemIds: ['leaf-item'],
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
      },
      excludedItems: {},
      ...descriptionOverrides,
    },
  };
}

function exactSuccessTree(): DescriptionTreeGetResponse {
  return makeResponse({
    revision: 'sha256:r1',
    rootNodes: [
      { type: 'item', id: 'before' },
      { type: 'item', id: 'leaf-item' },
      { type: 'group', id: 'nested' },
      { type: 'item', id: 'after' },
    ],
    groups: [
      {
        groupId: 'nested',
        name: 'ネスト',
        kind: 'CARD',
        description: 'ネスト説明',
        children: [{ type: 'item', id: 'deep-item' }],
      },
    ],
  });
}

describe('group-ungroup-helpers', () => {
  it('capture は sibling/children/metadata/subtree snapshot を取る', () => {
    const response = makeResponse();
    const capture = captureActiveGroupUngroupContext(response, 'target');
    expect(capture).toMatchObject({
      groupId: 'target',
      parentGroupId: null,
      targetIndex: 1,
      description: '対象説明',
      directChildren: [
        { type: 'item', id: 'leaf-item' },
        { type: 'group', id: 'nested' },
      ],
      siblingOrder: [
        { type: 'item', id: 'before' },
        { type: 'group', id: 'target' },
        { type: 'item', id: 'after' },
      ],
    });
    expect(capture?.itemSnapshots['leaf-item']?.name).toBe('葉');
    expect(capture?.itemSnapshots['deep-item']?.type).toBe('number');
    expect(capture?.groupSnapshots.nested?.children).toEqual([
      { type: 'item', id: 'deep-item' },
    ]);
  });

  it('buildExpectedContainerAfterUngroup は wrapper を置換する', () => {
    const capture = captureActiveGroupUngroupContext(makeResponse(), 'target')!;
    expect(
      buildExpectedContainerAfterUngroup(
        capture.siblingOrder,
        capture.groupId,
        capture.directChildren,
      ),
    ).toEqual([
      { type: 'item', id: 'before' },
      { type: 'item', id: 'leaf-item' },
      { type: 'group', id: 'nested' },
      { type: 'item', id: 'after' },
    ]);
  });

  it('same revision + exact → match-exact', () => {
    const capture = captureActiveGroupUngroupContext(makeResponse(), 'target')!;
    expect(
      classifyGroupUngroupAuthoritative(exactSuccessTree(), capture, {
        mutationRevision: 'sha256:r1',
      }),
    ).toEqual({ kind: 'match-exact' });
  });

  it('empty Group + sibling 正確 → match-exact', () => {
    const before = makeResponse({
      rootNodes: [
        { type: 'item', id: 'before' },
        { type: 'group', id: 'empty-target' },
        { type: 'item', id: 'after' },
      ],
      groups: [
        {
          groupId: 'empty-target',
          name: '空',
          kind: 'SECTION',
          children: [],
        },
      ],
      items: {
        before: { name: '前', type: 'text', description: '', note: '' },
        after: { name: '後', type: 'text', description: '', note: '' },
      },
    });
    const capture = captureActiveGroupUngroupContext(before, 'empty-target')!;
    const after = makeResponse({
      revision: 'sha256:r1',
      rootNodes: [
        { type: 'item', id: 'before' },
        { type: 'item', id: 'after' },
      ],
      groups: [],
      items: {
        before: { name: '前', type: 'text', description: '', note: '' },
        after: { name: '後', type: 'text', description: '', note: '' },
      },
    });
    expect(
      classifyGroupUngroupAuthoritative(after, capture, {
        mutationRevision: 'sha256:r1',
      }),
    ).toEqual({ kind: 'match-exact' });
  });

  it('empty Group + sibling 欠落 → former-sibling-mismatch', () => {
    const before = makeResponse({
      rootNodes: [
        { type: 'item', id: 'before' },
        { type: 'group', id: 'empty-target' },
        { type: 'item', id: 'after' },
      ],
      groups: [
        {
          groupId: 'empty-target',
          name: '空',
          kind: 'SECTION',
          children: [],
        },
      ],
      items: {
        before: { name: '前', type: 'text', description: '', note: '' },
        after: { name: '後', type: 'text', description: '', note: '' },
      },
    });
    const capture = captureActiveGroupUngroupContext(before, 'empty-target')!;
    const after = makeResponse({
      revision: 'sha256:r1',
      rootNodes: [{ type: 'item', id: 'before' }],
      groups: [],
      items: {
        before: { name: '前', type: 'text', description: '', note: '' },
      },
    });
    expect(
      classifyGroupUngroupAuthoritative(after, capture, {
        mutationRevision: 'sha256:r1',
      }).kind,
    ).toBe('former-sibling-mismatch');
  });

  it('target still present / definition-only / wrong parent を分類する', () => {
    const capture = captureActiveGroupUngroupContext(makeResponse(), 'target')!;
    expect(
      classifyGroupUngroupAuthoritative(makeResponse(), capture, {
        mutationRevision: 'sha256:r1',
      }).kind,
    ).toBe('target-still-present');

    const definitionOnly = makeResponse({
      rootNodes: [
        { type: 'item', id: 'before' },
        { type: 'item', id: 'after' },
      ],
      groups: [
        {
          groupId: 'target',
          name: '対象',
          kind: 'SECTION',
          children: [],
        },
      ],
    });
    expect(
      classifyGroupUngroupAuthoritative(definitionOnly, capture, {
        mutationRevision: 'sha256:r1',
      }).kind,
    ).toBe('definition-only');

    const wrongParent = makeResponse({
      revision: 'sha256:r1',
      rootNodes: [
        { type: 'group', id: 'other' },
        { type: 'item', id: 'before' },
        { type: 'item', id: 'after' },
      ],
      groups: [
        {
          groupId: 'other',
          name: '別',
          kind: 'SECTION',
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
      ],
    });
    expect(
      classifyGroupUngroupAuthoritative(wrongParent, capture, {
        mutationRevision: 'sha256:r1',
      }).kind,
    ).toBe('child-wrong-parent');
  });

  it('same revision + children 末端移動 → former-sibling-mismatch', () => {
    const capture = captureActiveGroupUngroupContext(makeResponse(), 'target')!;
    expect(
      classifyGroupUngroupAuthoritative(
        makeResponse({
          revision: 'sha256:r1',
          rootNodes: [
            { type: 'item', id: 'before' },
            { type: 'item', id: 'after' },
            { type: 'item', id: 'leaf-item' },
            { type: 'group', id: 'nested' },
          ],
          groups: [
            {
              groupId: 'nested',
              name: 'ネスト',
              kind: 'CARD',
              description: 'ネスト説明',
              children: [{ type: 'item', id: 'deep-item' }],
            },
          ],
        }),
        capture,
        { mutationRevision: 'sha256:r1' },
      ).kind,
    ).toBe('former-sibling-mismatch');
  });

  it('same revision + 前 sibling reorder → former-sibling-mismatch', () => {
    const before = makeResponse({
      rootNodes: [
        { type: 'item', id: 'before' },
        { type: 'item', id: 'mid' },
        { type: 'group', id: 'target' },
        { type: 'item', id: 'after' },
      ],
      items: {
        before: { name: '前', type: 'text', description: '', note: '' },
        mid: { name: '中', type: 'text', description: '', note: '' },
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
      },
    });
    const capture = captureActiveGroupUngroupContext(before, 'target')!;
    expect(
      classifyGroupUngroupAuthoritative(
        makeResponse({
          revision: 'sha256:r1',
          rootNodes: [
            { type: 'item', id: 'mid' },
            { type: 'item', id: 'before' },
            { type: 'item', id: 'leaf-item' },
            { type: 'group', id: 'nested' },
            { type: 'item', id: 'after' },
          ],
          groups: [
            {
              groupId: 'nested',
              name: 'ネスト',
              kind: 'CARD',
              description: 'ネスト説明',
              children: [{ type: 'item', id: 'deep-item' }],
            },
          ],
          items: before.description.items,
        }),
        capture,
        { mutationRevision: 'sha256:r1' },
      ).kind,
    ).toBe('former-sibling-mismatch');
  });

  it('same revision + 後 sibling reorder → former-sibling-mismatch', () => {
    const before = makeResponse({
      rootNodes: [
        { type: 'item', id: 'before' },
        { type: 'group', id: 'target' },
        { type: 'item', id: 'after-a' },
        { type: 'item', id: 'after-b' },
      ],
      items: {
        before: { name: '前', type: 'text', description: '', note: '' },
        'after-a': { name: '後A', type: 'text', description: '', note: '' },
        'after-b': { name: '後B', type: 'text', description: '', note: '' },
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
      },
    });
    const capture = captureActiveGroupUngroupContext(before, 'target')!;
    expect(
      classifyGroupUngroupAuthoritative(
        makeResponse({
          revision: 'sha256:r1',
          rootNodes: [
            { type: 'item', id: 'before' },
            { type: 'item', id: 'leaf-item' },
            { type: 'group', id: 'nested' },
            { type: 'item', id: 'after-b' },
            { type: 'item', id: 'after-a' },
          ],
          groups: [
            {
              groupId: 'nested',
              name: 'ネスト',
              kind: 'CARD',
              description: 'ネスト説明',
              children: [{ type: 'item', id: 'deep-item' }],
            },
          ],
          items: before.description.items,
        }),
        capture,
        { mutationRevision: 'sha256:r1' },
      ).kind,
    ).toBe('former-sibling-mismatch');
  });

  it('promoted Group metadata / descendant Item metadata 変更を検出する', () => {
    const capture = captureActiveGroupUngroupContext(makeResponse(), 'target')!;
    expect(
      classifyGroupUngroupAuthoritative(
        makeResponse({
          revision: 'sha256:r1',
          rootNodes: [
            { type: 'item', id: 'before' },
            { type: 'item', id: 'leaf-item' },
            { type: 'group', id: 'nested' },
            { type: 'item', id: 'after' },
          ],
          groups: [
            {
              groupId: 'nested',
              name: '改名ネスト',
              kind: 'CARD',
              description: 'ネスト説明',
              children: [{ type: 'item', id: 'deep-item' }],
            },
          ],
        }),
        capture,
        { mutationRevision: 'sha256:r1' },
      ).kind,
    ).toBe('group-metadata-mismatch');

    expect(
      classifyGroupUngroupAuthoritative(
        makeResponse({
          revision: 'sha256:r1',
          rootNodes: [
            { type: 'item', id: 'before' },
            { type: 'item', id: 'leaf-item' },
            { type: 'group', id: 'nested' },
            { type: 'item', id: 'after' },
          ],
          groups: [
            {
              groupId: 'nested',
              name: 'ネスト',
              kind: 'CARD',
              description: 'ネスト説明',
              children: [{ type: 'item', id: 'deep-item' }],
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
              description: '改変説明',
              note: '深層備考',
            },
          },
        }),
        capture,
        { mutationRevision: 'sha256:r1' },
      ).kind,
    ).toBe('item-metadata-mismatch');
  });

  it('child excluded / missing / order reverse を検出する', () => {
    const capture = captureActiveGroupUngroupContext(makeResponse(), 'target')!;
    expect(
      classifyGroupUngroupAuthoritative(
        makeResponse({
          revision: 'sha256:r1',
          rootNodes: [
            { type: 'item', id: 'before' },
            { type: 'item', id: 'leaf-item' },
            { type: 'group', id: 'nested' },
            { type: 'item', id: 'after' },
          ],
          groups: [
            {
              groupId: 'nested',
              name: 'ネスト',
              kind: 'CARD',
              description: 'ネスト説明',
              children: [{ type: 'item', id: 'deep-item' }],
            },
          ],
          excludedItems: {
            'leaf-item': {
              name: '葉',
              type: 'text',
              description: '葉説明',
              note: '葉備考',
            },
          },
          items: {
            before: { name: '前', type: 'text', description: '', note: '' },
            after: { name: '後', type: 'text', description: '', note: '' },
            'deep-item': {
              name: '深層',
              type: 'number',
              description: '深層説明',
              note: '深層備考',
            },
          },
        }),
        capture,
        { mutationRevision: 'sha256:r1' },
      ).kind,
    ).toBe('child-excluded');

    expect(
      classifyGroupUngroupAuthoritative(
        makeResponse({
          revision: 'sha256:r1',
          rootNodes: [
            { type: 'item', id: 'before' },
            { type: 'group', id: 'nested' },
            { type: 'item', id: 'after' },
          ],
          groups: [
            {
              groupId: 'nested',
              name: 'ネスト',
              kind: 'CARD',
              description: 'ネスト説明',
              children: [{ type: 'item', id: 'deep-item' }],
            },
          ],
        }),
        capture,
        { mutationRevision: 'sha256:r1' },
      ).kind,
    ).toBe('child-missing');

    expect(
      classifyGroupUngroupAuthoritative(
        makeResponse({
          revision: 'sha256:r1',
          rootNodes: [
            { type: 'item', id: 'before' },
            { type: 'group', id: 'nested' },
            { type: 'item', id: 'leaf-item' },
            { type: 'item', id: 'after' },
          ],
          groups: [
            {
              groupId: 'nested',
              name: 'ネスト',
              kind: 'CARD',
              description: 'ネスト説明',
              children: [{ type: 'item', id: 'deep-item' }],
            },
          ],
        }),
        capture,
        { mutationRevision: 'sha256:r1' },
      ).kind,
    ).toBe('child-order-mismatch');
  });

  it('mutationRevision null / different revision → revision-diverged', () => {
    const capture = captureActiveGroupUngroupContext(makeResponse(), 'target')!;
    expect(
      classifyGroupUngroupAuthoritative(exactSuccessTree(), capture, {
        mutationRevision: null,
      }).kind,
    ).toBe('revision-diverged');
    expect(
      classifyGroupUngroupAuthoritative(
        { ...exactSuccessTree(), revision: 'sha256:r-other' },
        capture,
        { mutationRevision: 'sha256:r1' },
      ).kind,
    ).toBe('revision-diverged');
  });

  it('matchesUngroupCapture は children / sibling / metadata 変更を検出する', () => {
    const response = makeResponse();
    const capture = captureActiveGroupUngroupContext(response, 'target')!;
    expect(matchesUngroupCapture(response, capture)).toBe(true);
    expect(
      matchesUngroupCapture(response, {
        ...capture,
        directChildren: [...capture.directChildren].reverse(),
      }),
    ).toBe(false);
    const reordered = makeResponse({
      rootNodes: [
        { type: 'item', id: 'after' },
        { type: 'group', id: 'target' },
        { type: 'item', id: 'before' },
      ],
    });
    expect(matchesUngroupCapture(reordered, capture)).toBe(false);
    expect(
      matchesUngroupCapture(response, {
        ...capture,
        name: '改名',
      }),
    ).toBe(false);
  });
});
