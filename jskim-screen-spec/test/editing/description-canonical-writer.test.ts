import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cloneNormalizedDescription,
  formatDescriptionDocumentV13,
  readDescriptionDocument,
} from '../../src/editing/description-document/index.js';
import type { NormalizedDescription } from '../../src/editing/description-document/index.js';

function emptyItem() {
  return { name: '', type: '', description: '', note: '' };
}

function baseNormalized(
  overrides: Partial<NormalizedDescription> = {},
): NormalizedDescription {
  return {
    sourceSchemaVersion: '1.3',
    screen: { id: 'demo-screen', name: 'Demo', description: '' },
    rootNodes: [{ type: 'item', id: 'item-a' }],
    groups: [
      {
        groupId: 'z-group',
        name: 'Z',
        kind: 'SECTION',
        children: [{ type: 'item', id: 'item-b' }],
      },
      {
        groupId: 'a-group',
        name: 'A',
        kind: 'CARD',
        children: [],
      },
    ],
    items: {
      'item-a': emptyItem(),
      'item-b': emptyItem(),
    },
    excludedItems: { 'excluded-x': emptyItem() },
    ...overrides,
  };
}

describe('formatDescriptionDocumentV13', () => {
  it('同じ input から同じ bytes を生成する', () => {
    const normalized = baseNormalized();
    const a = formatDescriptionDocumentV13(normalized);
    const b = formatDescriptionDocumentV13(normalized);
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
  });

  it('groups[] を groupId 昇順に並べ、rootNodes / children 順序は維持する', () => {
    const normalized = baseNormalized({
      rootNodes: [
        { type: 'group', id: 'z-group' },
        { type: 'item', id: 'item-a' },
        { type: 'group', id: 'a-group' },
      ],
    });
    const json = JSON.parse(formatDescriptionDocumentV13(normalized)) as {
      rootNodes: Array<{ id: string }>;
      groups: Array<{ groupId: string; children: Array<{ id: string }> }>;
    };
    expect(json.rootNodes.map((n) => n.id)).toEqual([
      'z-group',
      'item-a',
      'a-group',
    ]);
    expect(json.groups.map((g) => g.groupId)).toEqual(['a-group', 'z-group']);
    expect(json.groups[1].children[0].id).toBe('item-b');
  });

  it('items / excludedItems key を ASCII 昇順に並べる', () => {
    const normalized = baseNormalized({
      items: {
        'z-item': emptyItem(),
        'a-item': emptyItem(),
      },
      excludedItems: {
        'z-ex': emptyItem(),
        'a-ex': emptyItem(),
      },
      rootNodes: [],
      groups: [],
    });
    const json = JSON.parse(formatDescriptionDocumentV13(normalized)) as {
      items: Record<string, unknown>;
      excludedItems: Record<string, unknown>;
    };
    expect(Object.keys(json.items)).toEqual(['a-item', 'z-item']);
    expect(Object.keys(json.excludedItems)).toEqual(['a-ex', 'z-ex']);
  });

  it('field 順序と description 省略を固定する', () => {
    const normalized = baseNormalized({
      rootNodes: [],
      groups: [
        {
          groupId: 'section',
          name: 'Section',
          description: 'desc',
          kind: 'SECTION',
          children: [{ type: 'item', id: 'item-a' }],
        },
      ],
      items: { 'item-a': emptyItem() },
      excludedItems: {},
    });
    const text = formatDescriptionDocumentV13(normalized);
    expect(text).toContain(
      '"groupId": "section",\n      "name": "Section",\n      "description": "desc",\n      "kind": "SECTION"',
    );
    expect(text).toContain('"type": "item",\n          "id": "item-a"');
  });

  it('入力 normalized object を変更しない', () => {
    const normalized = baseNormalized();
    const before = cloneNormalizedDescription(normalized);
    formatDescriptionDocumentV13(normalized);
    expect(normalized).toEqual(before);
  });

  it('parse 後も semantic が一致する', () => {
    const normalized = baseNormalized({
      rootNodes: [
        { type: 'group', id: 'a-group' },
        { type: 'group', id: 'z-group' },
        { type: 'item', id: 'item-a' },
      ],
    });
    const parsed = JSON.parse(formatDescriptionDocumentV13(normalized));
    const result = readDescriptionDocument(parsed);
    expect(result).not.toHaveProperty('error');
    if ('error' in result) {
      return;
    }
    expect(result.flatItemOrder).toEqual(['item-b', 'item-a']);
  });
});
