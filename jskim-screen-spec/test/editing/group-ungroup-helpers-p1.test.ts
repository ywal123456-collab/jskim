import { describe, expect, it } from 'vitest';
import {
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

describe('group-ungroup-helpers P1 blockers', () => {
  it('A: 同一 revision で exact 位置失敗を relative success にしない', () => {
    const capture = captureActiveGroupUngroupContext(makeResponse(), 'target')!;
    // children は parent 直下だが、間に after が入って非連続
    const broken = makeResponse({
      revision: 'sha256:r1',
      rootNodes: [
        { type: 'item', id: 'before' },
        { type: 'item', id: 'leaf-item' },
        { type: 'item', id: 'after' },
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
    });
    const classification = classifyGroupUngroupAuthoritative(broken, capture, {
      mutationRevision: 'sha256:r1',
    });
    expect(classification.kind).not.toBe('match-exact');
    expect(
      classification.kind === 'exact-placement-mismatch' ||
        classification.kind === 'former-sibling-mismatch' ||
        classification.kind === 'child-order-mismatch',
    ).toBe(true);
  });

  it('B: former sibling 欠落を success にしない', () => {
    const capture = captureActiveGroupUngroupContext(makeResponse(), 'target')!;
    const after = makeResponse({
      revision: 'sha256:r1',
      rootNodes: [
        { type: 'item', id: 'before' },
        { type: 'item', id: 'leaf-item' },
        { type: 'group', id: 'nested' },
        // after sibling missing
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
    const classification = classifyGroupUngroupAuthoritative(after, capture, {
      mutationRevision: 'sha256:r1',
    });
    expect(classification.kind).toBe('former-sibling-mismatch');
  });

  it('C: promoted Item metadata 損失を success にしない', () => {
    const capture = captureActiveGroupUngroupContext(makeResponse(), 'target')!;
    const after = makeResponse({
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
          name: '改変された葉',
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
    const classification = classifyGroupUngroupAuthoritative(after, capture, {
      mutationRevision: 'sha256:r1',
    });
    expect(classification.kind).toBe('item-metadata-mismatch');
  });

  it('C2: promoted Group descendant 損失を success にしない', () => {
    const capture = captureActiveGroupUngroupContext(makeResponse(), 'target')!;
    const after = makeResponse({
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
          children: [], // deep-item lost
        },
      ],
    });
    const classification = classifyGroupUngroupAuthoritative(after, capture, {
      mutationRevision: 'sha256:r1',
    });
    expect(classification.kind).toBe('group-descendant-mismatch');
  });

  it('different revision は構造が正しく見えても success にしない', () => {
    const capture = captureActiveGroupUngroupContext(makeResponse(), 'target')!;
    const after = makeResponse({
      revision: 'sha256:r-other',
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
    const classification = classifyGroupUngroupAuthoritative(after, capture, {
      mutationRevision: 'sha256:r1',
    });
    expect(classification.kind).toBe('revision-diverged');
  });

  it('matchesUngroupCapture は siblingOrder 全体変更を検出する', () => {
    const response = makeResponse();
    const capture = captureActiveGroupUngroupContext(response, 'target')!;
    const reordered = makeResponse({
      rootNodes: [
        { type: 'item', id: 'after' },
        { type: 'group', id: 'target' },
        { type: 'item', id: 'before' },
      ],
    });
    expect(matchesUngroupCapture(reordered, capture)).toBe(false);
  });
});
