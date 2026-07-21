import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeDescription } from '../../src/collector/merge-description.js';
import { writeCollectedDescription } from '../../src/collector/write-collected-description.js';
import {
  flattenItemTree,
  normalizeDescriptionDocument,
  parseDescriptionDocument,
  readDescriptionDocument,
  validateDescriptionStructure,
  validateDescriptionTreeSemantics,
} from '../../src/editing/description-document/index.js';

function emptyItem() {
  return { name: '', type: '', description: '', note: '' };
}

function baseV13(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.3',
    screen: { id: 'demo-screen', name: 'Demo', description: '' },
    rootNodes: [],
    groups: [],
    items: {},
    excludedItems: {},
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function readDoc(raw: unknown) {
  const result = readDescriptionDocument(raw);
  if ('error' in result) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result;
}

function expectError(raw: unknown, code: string) {
  const result = readDescriptionDocument(raw);
  expect(result).toHaveProperty('error');
  if ('error' in result) {
    expect(result.error.code).toBe(code);
  }
}

function chainGroups(count: number, leafItemId = 'leaf-item') {
  const groups: Array<Record<string, unknown>> = [];
  const rootNodes: Array<{ type: string; id: string }> = [
    { type: 'group', id: 'g1' },
  ];
  const items: Record<string, unknown> = {
    [leafItemId]: emptyItem(),
  };

  for (let i = 1; i <= count; i += 1) {
    const groupId = `g${i}`;
    const child =
      i === count
        ? [{ type: 'item', id: leafItemId }]
        : [{ type: 'group', id: `g${i + 1}` }];
    groups.push({
      groupId,
      name: groupId,
      kind: 'SECTION',
      children: child,
    });
  }

  return baseV13({ rootNodes, groups, items });
}

describe('Description v1.3 document', () => {
  it('valid empty v1.3 を読み込める', () => {
    const result = readDoc(baseV13());
    expect(result.normalized.rootNodes).toEqual([]);
    expect(result.flatItemOrder).toEqual([]);
  });

  it('valid root Items only', () => {
    const raw = baseV13({
      rootNodes: [
        { type: 'item', id: 'item-a' },
        { type: 'item', id: 'item-b' },
      ],
      items: {
        'item-a': emptyItem(),
        'item-b': emptyItem(),
      },
    });
    expect(readDoc(raw).flatItemOrder).toEqual(['item-a', 'item-b']);
  });

  it('valid nested Groups を depth-first pre-order で flatten する', () => {
    const raw = baseV13({
      rootNodes: [
        { type: 'item', id: 'item-a' },
        { type: 'group', id: 'group-1' },
        { type: 'item', id: 'item-d' },
      ],
      groups: [
        {
          groupId: 'group-1',
          name: 'Group 1',
          kind: 'SECTION',
          children: [
            { type: 'item', id: 'item-b' },
            { type: 'group', id: 'group-2' },
          ],
        },
        {
          groupId: 'group-2',
          name: 'Group 2',
          kind: 'CARD',
          children: [{ type: 'item', id: 'item-c' }],
        },
      ],
      items: {
        'item-a': emptyItem(),
        'item-b': emptyItem(),
        'item-c': emptyItem(),
        'item-d': emptyItem(),
      },
    });
    expect(readDoc(raw).flatItemOrder).toEqual([
      'item-a',
      'item-b',
      'item-c',
      'item-d',
    ]);
  });

  it('valid depth 8 を許可する', () => {
    expect(() => readDoc(chainGroups(8))).not.toThrow();
  });

  it('invalid depth 9 を拒否する', () => {
    expectError(chainGroups(9), 'SPEC_DESCRIPTION_GROUP_DEPTH_EXCEEDED');
  });

  it('duplicate groupId を拒否する', () => {
    expectError(
      baseV13({
        groups: [
          {
            groupId: 'dup',
            name: 'A',
            kind: 'SECTION',
            children: [],
          },
          {
            groupId: 'dup',
            name: 'B',
            kind: 'SECTION',
            children: [],
          },
        ],
      }),
      'SPEC_DESCRIPTION_GROUP_ID_DUPLICATE',
    );
  });

  it('groupId/itemId collision を拒否する', () => {
    expectError(
      baseV13({
        groups: [
          {
            groupId: 'same-id',
            name: 'G',
            kind: 'SECTION',
            children: [],
          },
        ],
        items: { 'same-id': emptyItem() },
      }),
      'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
    );
  });

  it('groupId/excluded ID collision を拒否する', () => {
    expectError(
      baseV13({
        groups: [
          {
            groupId: 'same-id',
            name: 'G',
            kind: 'SECTION',
            children: [],
          },
        ],
        excludedItems: { 'same-id': emptyItem() },
      }),
      'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
    );
  });

  it('dangling Group ref を拒否する', () => {
    expectError(
      baseV13({
        rootNodes: [{ type: 'group', id: 'missing-group' }],
      }),
      'SPEC_DESCRIPTION_NODE_REFERENCE_NOT_FOUND',
    );
  });

  it('dangling Item ref を拒否する', () => {
    expectError(
      baseV13({
        rootNodes: [{ type: 'item', id: 'missing-item' }],
      }),
      'SPEC_DESCRIPTION_NODE_REFERENCE_NOT_FOUND',
    );
  });

  it('orphan Group を拒否する', () => {
    expectError(
      baseV13({
        groups: [
          {
            groupId: 'orphan-group',
            name: 'Orphan',
            kind: 'SECTION',
            children: [],
          },
        ],
      }),
      'SPEC_DESCRIPTION_GROUP_ORPHAN',
    );
  });

  it('orphan active Item を拒否する', () => {
    expectError(
      baseV13({
        items: { 'orphan-item': emptyItem() },
      }),
      'SPEC_DESCRIPTION_ITEM_ORPHAN',
    );
  });

  it('duplicate Group placement を拒否する', () => {
    expectError(
      baseV13({
        rootNodes: [
          { type: 'group', id: 'group-a' },
          { type: 'group', id: 'group-a' },
        ],
        groups: [
          {
            groupId: 'group-a',
            name: 'A',
            kind: 'SECTION',
            children: [],
          },
        ],
      }),
      'SPEC_DESCRIPTION_NODE_DUPLICATE',
    );
  });

  it('duplicate Item placement を拒否する', () => {
    expectError(
      baseV13({
        rootNodes: [
          { type: 'item', id: 'item-a' },
          { type: 'item', id: 'item-a' },
        ],
        items: { 'item-a': emptyItem() },
      }),
      'SPEC_DESCRIPTION_NODE_DUPLICATE',
    );
  });

  it('self-cycle を拒否する', () => {
    expectError(
      baseV13({
        rootNodes: [{ type: 'group', id: 'loop' }],
        groups: [
          {
            groupId: 'loop',
            name: 'Loop',
            kind: 'SECTION',
            children: [{ type: 'group', id: 'loop' }],
          },
        ],
      }),
      'SPEC_DESCRIPTION_GROUP_CYCLE',
    );
  });

  it('indirect cycle を拒否する', () => {
    expectError(
      baseV13({
        rootNodes: [{ type: 'group', id: 'g1' }],
        groups: [
          {
            groupId: 'g1',
            name: 'G1',
            kind: 'SECTION',
            children: [{ type: 'group', id: 'g2' }],
          },
          {
            groupId: 'g2',
            name: 'G2',
            kind: 'SECTION',
            children: [{ type: 'group', id: 'g1' }],
          },
        ],
      }),
      'SPEC_DESCRIPTION_GROUP_CYCLE',
    );
  });

  it('excluded Item in tree を拒否する', () => {
    expectError(
      baseV13({
        rootNodes: [{ type: 'item', id: 'excluded-one' }],
        excludedItems: { 'excluded-one': emptyItem() },
      }),
      'SPEC_DESCRIPTION_EXCLUDED_ITEM_IN_TREE',
    );
  });

  it('unknown Group kind を拒否する', () => {
    const parsed = parseDescriptionDocument(
      baseV13({
        groups: [
          {
            groupId: 'bad-kind',
            name: 'Bad',
            kind: 'UNKNOWN',
            children: [],
          },
        ],
      }),
    );
    expect(parsed).not.toHaveProperty('error');
    if ('error' in parsed) {
      return;
    }
    expect(validateDescriptionStructure(parsed)?.code).toBe(
      'SPEC_DESCRIPTION_INVALID',
    );
  });

  it('unknown Group field を拒否する', () => {
    expectError(
      baseV13({
        groups: [
          {
            groupId: 'extra-field',
            name: 'Extra',
            kind: 'SECTION',
            children: [],
            extra: true,
          },
        ],
      }),
      'SPEC_DESCRIPTION_INVALID',
    );
  });

  it('unknown SpecNodeRef field を拒否する', () => {
    expectError(
      baseV13({
        rootNodes: [{ type: 'item', id: 'item-a', extra: true }],
        items: { 'item-a': emptyItem() },
      }),
      'SPEC_DESCRIPTION_INVALID',
    );
  });
});

describe('Description flat schema 互換 normalize', () => {
  it('v1.0 → collectedOrder 優先で root Item tree を合成する', () => {
    const raw = {
      schemaVersion: '1.0',
      screen: { id: 'demo', name: 'Demo', description: '' },
      items: {
        a: emptyItem(),
        b: emptyItem(),
        c: emptyItem(),
      },
    };
    const parsed = parseDescriptionDocument(raw);
    expect(parsed).not.toHaveProperty('error');
    if ('error' in parsed) {
      return;
    }
    const normalized = normalizeDescriptionDocument(parsed, {
      collectedOrder: ['b', 'z'],
    });
    expect(normalized.rootNodes).toEqual([
      { type: 'item', id: 'b' },
      { type: 'item', id: 'a' },
      { type: 'item', id: 'c' },
    ]);
    expect(flattenItemTree(normalized)).toEqual(['b', 'a', 'c']);
  });

  it('v1.1 → itemOrder を保持する', () => {
    const raw = {
      schemaVersion: '1.1',
      screen: { id: 'demo', name: 'Demo', description: '' },
      itemOrder: ['b', 'a'],
      items: {
        a: emptyItem(),
        b: emptyItem(),
      },
    };
    const result = readDoc(raw);
    expect(result.flatItemOrder).toEqual(['b', 'a']);
  });

  it('v1.2 → itemOrder と excludedItems を保持する', () => {
    const raw = {
      schemaVersion: '1.2',
      screen: { id: 'demo', name: 'Demo', description: '' },
      itemOrder: ['active-item'],
      items: { 'active-item': emptyItem() },
      excludedItems: { 'excluded-item': emptyItem() },
    };
    const result = readDoc(raw);
    expect(result.flatItemOrder).toEqual(['active-item']);
    expect(Object.keys(result.normalized.excludedItems)).toEqual([
      'excluded-item',
    ]);
  });

  it('v1.3 nested tree を保持する', () => {
    const raw = baseV13({
      rootNodes: [{ type: 'group', id: 'section' }],
      groups: [
        {
          groupId: 'section',
          name: 'Section',
          kind: 'SECTION',
          children: [{ type: 'item', id: 'field' }],
        },
      ],
      items: { field: emptyItem() },
    });
    const result = readDoc(raw);
    expect(result.normalized.groups).toHaveLength(1);
    expect(result.flatItemOrder).toEqual(['field']);
  });
});

describe('Description read-only / no-rewrite', () => {
  const versions = [
    {
      name: 'v1.0',
      doc: {
        schemaVersion: '1.0',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        items: { 'item-a': emptyItem() },
      },
    },
    {
      name: 'v1.1',
      doc: {
        schemaVersion: '1.1',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        itemOrder: ['item-a'],
        items: { 'item-a': emptyItem() },
      },
    },
    {
      name: 'v1.2',
      doc: {
        schemaVersion: '1.2',
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        itemOrder: ['item-a'],
        items: { 'item-a': emptyItem() },
        excludedItems: {},
      },
    },
    {
      name: 'v1.3',
      doc: baseV13({
        rootNodes: [{ type: 'item', id: 'item-a' }],
        items: { 'item-a': emptyItem() },
      }),
    },
  ] as const;

  for (const version of versions) {
    it(`${version.name} load 後に原稿 bytes / mtime / raw object を変更しない`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desc-readonly-'));
      const filePath = path.join(dir, 'demo-screen.json');
      const json = `${JSON.stringify(version.doc, null, 2)}\n`;
      fs.writeFileSync(filePath, json, 'utf8');
      const before = fs.readFileSync(filePath);
      const mtimeBefore = fs.statSync(filePath).mtimeMs;
      const raw = JSON.parse(before.toString()) as Record<string, unknown>;
      deepFreeze(raw);

      const parsed = parseDescriptionDocument(raw);
      expect(parsed).not.toHaveProperty('error');
      if ('error' in parsed) {
        return;
      }
      expect(validateDescriptionStructure(parsed)).toBeNull();
      const normalized = normalizeDescriptionDocument(parsed, {
        collectedOrder: ['item-a'],
      });
      if (parsed.sourceSchemaVersion === '1.3') {
        expect(validateDescriptionTreeSemantics(normalized)).toBeNull();
      }
      expect(flattenItemTree(normalized)).toEqual(['item-a']);
      readDescriptionDocument(raw, { collectedOrder: ['item-a'] });

      expect(fs.readFileSync(filePath)).toEqual(before);
      expect(fs.statSync(filePath).mtimeMs).toBe(mtimeBefore);
      expect(raw.schemaVersion).toBe(version.doc.schemaVersion);
    });
  }
});

describe('Description v1.3 mutation 境界', () => {
  it('mergeDescription は v1.3 を拒否する', () => {
    expect(() =>
      mergeDescription({
        existing: baseV13() as never,
        screenId: 'demo-screen',
        foundItemIds: [],
      }),
    ).toThrow(/schemaVersion "1.3"/);
  });

  it('writeCollectedDescription は v1.3 を拒否する', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desc-v13-collect-'));
    const filePath = path.join(dir, 'demo-screen.json');
    fs.writeFileSync(
      filePath,
      `${JSON.stringify(baseV13(), null, 2)}\n`,
      'utf8',
    );
    expect(() =>
      writeCollectedDescription({
        filePath,
        screenId: 'demo-screen',
        foundItemIds: ['new-item'],
      }),
    ).toThrow(/schemaVersion "1.3"/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Description validation の決定性', () => {
  it('同じ invalid 入力は常に同じ最初のエラーを返す', () => {
    const raw = baseV13({
      rootNodes: [{ type: 'item', id: 'missing' }],
      groups: [
        {
          groupId: 'orphan',
          name: 'Orphan',
          kind: 'SECTION',
          children: [],
        },
      ],
    });
    const first = readDescriptionDocument(raw);
    const second = readDescriptionDocument(raw);
    expect(first).toEqual(second);
    if ('error' in first) {
      expect(first.error.code).toBe('SPEC_DESCRIPTION_NODE_REFERENCE_NOT_FOUND');
    }
  });
});
