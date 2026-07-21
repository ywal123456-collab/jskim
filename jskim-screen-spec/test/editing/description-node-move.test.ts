import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DescriptionDocumentError,
  applyMoveNode,
  applyReorderChildren,
  cloneNormalizedDescription,
  findNodeLocation,
  moveDescriptionNode,
  readDescriptionDocument,
  readDescriptionRevision,
  reorderDescriptionChildren,
} from '../../src/editing/description-document/index.js';
import { resetDescriptionScreenLocksForTest } from '../../src/editing/description-screen-lock.js';
import {
  computeContentRevision,
  writeFileAtomic,
  type WriteFileAtomicFs,
} from '../../src/util/write-file-atomic.js';
import type { NormalizedDescription, SpecNodeRef } from '../../src/editing/description-document/types.js';

const temps: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-node-move-'));
  temps.push(dir);
  fs.mkdirSync(path.join(dir, 'spec', 'demo', 'src', 'data'), { recursive: true });
  return dir;
}

function ctx(root: string) {
  return { rootDir: root, projectName: 'demo', screenId: 'demo-screen' };
}

function emptyItem() {
  return { name: '', type: '', description: '', note: '' };
}

function writeDescriptionFile(root: string, doc: Record<string, unknown>): string {
  const filePath = path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json');
  const json = `${JSON.stringify(doc, null, 2)}\n`;
  fs.writeFileSync(filePath, json, 'utf8');
  return json;
}

function readSaved(root: string): Record<string, unknown> {
  const filePath = path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function docErrorCode(err: unknown): string | undefined {
  return err instanceof DescriptionDocumentError ? err.code : undefined;
}

async function expectDocErrorCode(
  fn: () => unknown | Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await fn();
    expect.fail('should throw');
  } catch (err) {
    expect(docErrorCode(err)).toBe(code);
  }
}

function normalizeFromDoc(doc: Record<string, unknown>): NormalizedDescription {
  const state = readDescriptionDocument(doc);
  if ('error' in state) {
    throw new Error(state.error.message);
  }
  return state.normalized;
}

function baseV13Tree(overrides: Partial<{
  rootNodes: SpecNodeRef[];
  groups: NormalizedDescription['groups'];
  items: NormalizedDescription['items'];
}>): NormalizedDescription {
  return normalizeFromDoc({
    schemaVersion: '1.3',
    screen: { id: 'demo-screen', name: 'Demo', description: '' },
    rootNodes: overrides.rootNodes ?? [],
    groups: overrides.groups ?? [],
    items: overrides.items ?? {},
    excludedItems: {},
  });
}

afterEach(() => {
  resetDescriptionScreenLocksForTest();
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('findNodeLocation', () => {
  it('root / nested の位置を返し入力 object を変更しない', () => {
    const normalized = baseV13Tree({
      rootNodes: [
        { type: 'item', id: 'item-a' },
        { type: 'group', id: 'section' },
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
        'item-a': emptyItem(),
        'item-b': emptyItem(),
      },
    });
    const before = cloneNormalizedDescription(normalized);
    expect(findNodeLocation(normalized, { type: 'item', id: 'item-a' })).toEqual({
      node: { type: 'item', id: 'item-a' },
      parentGroupId: null,
      index: 0,
    });
    expect(findNodeLocation(normalized, { type: 'item', id: 'item-b' })).toEqual({
      node: { type: 'item', id: 'item-b' },
      parentGroupId: 'section',
      index: 0,
    });
    expect(normalized).toEqual(before);
  });
});

describe('applyMoveNode', () => {
  it('root Item / Group の順序変更と cross-parent 移動', () => {
    let normalized = baseV13Tree({
      rootNodes: [
        { type: 'item', id: 'item-a' },
        { type: 'item', id: 'item-b' },
        { type: 'group', id: 'section' },
      ],
      groups: [
        {
          groupId: 'section',
          name: 'Section',
          kind: 'SECTION',
          children: [{ type: 'item', id: 'item-c' }],
        },
      ],
      items: {
        'item-a': emptyItem(),
        'item-b': emptyItem(),
        'item-c': emptyItem(),
      },
    });

    const reorderRoot = applyMoveNode(normalized, {
      node: { type: 'item', id: 'item-b' },
      destinationParentGroupId: null,
      insertIndex: 0,
    });
    expect(reorderRoot.status).toBe('updated');
    normalized = reorderRoot.normalized;
    expect(normalized.rootNodes.map((n) => n.id)).toEqual([
      'item-b',
      'item-a',
      'section',
    ]);

    const toGroup = applyMoveNode(normalized, {
      node: { type: 'item', id: 'item-a' },
      destinationParentGroupId: 'section',
    });
    normalized = toGroup.normalized;
    expect(normalized.rootNodes.map((n) => n.id)).toEqual(['item-b', 'section']);
    expect(normalized.groups[0].children.map((n) => n.id)).toEqual([
      'item-c',
      'item-a',
    ]);

    const toGroupHead = applyMoveNode(normalized, {
      node: { type: 'item', id: 'item-a' },
      destinationParentGroupId: 'section',
      insertIndex: 0,
    });
    normalized = toGroupHead.normalized;
    expect(normalized.groups[0].children.map((n) => n.id)).toEqual([
      'item-a',
      'item-c',
    ]);

    const toRoot = applyMoveNode(normalized, {
      node: { type: 'item', id: 'item-c' },
      destinationParentGroupId: null,
      insertIndex: 0,
    });
    expect(toRoot.normalized.rootNodes.map((n) => n.id)).toEqual([
      'item-c',
      'item-b',
      'section',
    ]);
  });
});

describe('applyMoveNode insertIndex', () => {
  it('同一 parent で source 除去後 index を計算する', () => {
    const normalized = baseV13Tree({
      rootNodes: [
        { type: 'item', id: 'item-a' },
        { type: 'item', id: 'item-b' },
        { type: 'item', id: 'item-c' },
      ],
      items: {
        'item-a': emptyItem(),
        'item-b': emptyItem(),
        'item-c': emptyItem(),
      },
    });

    const moved = applyMoveNode(normalized, {
      node: { type: 'item', id: 'item-b' },
      destinationParentGroupId: null,
      insertIndex: 2,
    });
    expect(moved.status).toBe('updated');
    expect(moved.normalized.rootNodes.map((n) => n.id)).toEqual([
      'item-a',
      'item-c',
      'item-b',
    ]);

    const unchanged = applyMoveNode(normalized, {
      node: { type: 'item', id: 'item-b' },
      destinationParentGroupId: null,
      insertIndex: 1,
    });
    expect(unchanged.status).toBe('unchanged');

    const tailUnchanged = applyMoveNode(normalized, {
      node: { type: 'item', id: 'item-c' },
      destinationParentGroupId: null,
    });
    expect(tailUnchanged.status).toBe('unchanged');
  });
});

describe('applyMoveNode cycle / depth / invalid', () => {
  it('Group cycle を拒否し tree を変更しない', () => {
    const normalized = baseV13Tree({
      rootNodes: [{ type: 'group', id: 'parent' }],
      groups: [
        {
          groupId: 'parent',
          name: 'Parent',
          kind: 'SECTION',
          children: [{ type: 'group', id: 'child' }],
        },
        {
          groupId: 'child',
          name: 'Child',
          kind: 'SECTION',
          children: [{ type: 'group', id: 'grand' }],
        },
        {
          groupId: 'grand',
          name: 'Grand',
          kind: 'SECTION',
          children: [],
        },
      ],
    });
    const before = cloneNormalizedDescription(normalized);

    expect(() =>
      applyMoveNode(normalized, {
        node: { type: 'group', id: 'parent' },
        destinationParentGroupId: 'parent',
      }),
    ).toThrow(/自身または子孫/);
    expect(() =>
      applyMoveNode(normalized, {
        node: { type: 'group', id: 'parent' },
        destinationParentGroupId: 'child',
      }),
    ).toThrow(/自身または子孫/);
    expect(() =>
      applyMoveNode(normalized, {
        node: { type: 'group', id: 'parent' },
        destinationParentGroupId: 'grand',
      }),
    ).toThrow(/自身または子孫/);
    expect(normalized).toEqual(before);
  });

  it('depth 8 成功 / 9 拒否', () => {
    const groups: NormalizedDescription['groups'] = [];
    const rootNodes: SpecNodeRef[] = [{ type: 'group', id: 'g1' }];
    for (let i = 1; i <= 8; i += 1) {
      const nextId = `g${i + 1}`;
      groups.push({
        groupId: `g${i}`,
        name: `G${i}`,
        kind: 'SECTION',
        children: i < 8 ? [{ type: 'group', id: nextId }] : [],
      });
    }
    const normalized = baseV13Tree({ rootNodes, groups });

    const ok = applyMoveNode(normalized, {
      node: { type: 'group', id: 'g1' },
      destinationParentGroupId: null,
      insertIndex: 0,
    });
    expect(ok.status).toBe('unchanged');

    const deep = baseV13Tree({
      rootNodes: [{ type: 'group', id: 'anchor' }, { type: 'group', id: 'g1' }],
      groups: [
        {
          groupId: 'anchor',
          name: 'Anchor',
          kind: 'SECTION',
          children: [],
        },
        ...groups,
      ],
    });

    expect(() =>
      applyMoveNode(deep, {
        node: { type: 'group', id: 'g1' },
        destinationParentGroupId: 'anchor',
      }),
    ).toThrow(/深さが上限/);
  });

  it('invalid input を決定順で拒否する', () => {
    const normalized = baseV13Tree({
      rootNodes: [{ type: 'item', id: 'item-a' }],
      items: { 'item-a': emptyItem() },
    });

    expect(() =>
      applyMoveNode(normalized, {
        node: { type: 'item', id: 'missing' },
        destinationParentGroupId: null,
      }),
    ).toThrow(/tree 上に node が見つかりません/);

    expect(() =>
      applyMoveNode(normalized, {
        node: { type: 'item', id: 'item-a' },
        destinationParentGroupId: 'missing-group',
      }),
    ).toThrow(/移動先 Group が見つかりません/);

    expect(() =>
      applyMoveNode(normalized, {
        node: { type: 'item', id: 'item-a' },
        destinationParentGroupId: null,
        insertIndex: 5,
      }),
    ).toThrow(/insertIndex/);

    expect(() =>
      applyMoveNode(normalized, {
        node: { type: 'item', id: 'item-a' },
        destinationParentGroupId: null,
        insertIndex: 1.5,
      } as never),
    ).toThrow(/insertIndex/);

    expect(() =>
      applyMoveNode(normalized, {
        node: { type: 'item', id: 'item-a' },
        destinationParentGroupId: null,
        extra: true,
      } as never),
    ).toThrow(/許可されていないフィールド/);
  });
});

describe('applyReorderChildren', () => {
  it('root / Group children の permutation と unchanged', () => {
    const normalized = baseV13Tree({
      rootNodes: [
        { type: 'item', id: 'item-a' },
        { type: 'group', id: 'section' },
        { type: 'item', id: 'item-b' },
      ],
      groups: [
        {
          groupId: 'section',
          name: 'Section',
          kind: 'SECTION',
          children: [
            { type: 'item', id: 'item-c' },
            { type: 'group', id: 'inner' },
          ],
        },
        {
          groupId: 'inner',
          name: 'Inner',
          kind: 'CARD',
          children: [],
        },
      ],
      items: {
        'item-a': emptyItem(),
        'item-b': emptyItem(),
        'item-c': emptyItem(),
      },
    });

    const rootReorder = applyReorderChildren(normalized, {
      parentGroupId: null,
      orderedNodes: [
        { type: 'group', id: 'section' },
        { type: 'item', id: 'item-b' },
        { type: 'item', id: 'item-a' },
      ],
    });
    expect(rootReorder.status).toBe('updated');
    expect(rootReorder.normalized.rootNodes.map((n) => n.id)).toEqual([
      'section',
      'item-b',
      'item-a',
    ]);

    const groupReorder = applyReorderChildren(rootReorder.normalized, {
      parentGroupId: 'section',
      orderedNodes: [
        { type: 'group', id: 'inner' },
        { type: 'item', id: 'item-c' },
      ],
    });
    expect(groupReorder.status).toBe('updated');

    const unchanged = applyReorderChildren(groupReorder.normalized, {
      parentGroupId: 'section',
      orderedNodes: [
        { type: 'group', id: 'inner' },
        { type: 'item', id: 'item-c' },
      ],
    });
    expect(unchanged.status).toBe('unchanged');
  });

  it('空 children と mismatch を拒否する', () => {
    const normalized = baseV13Tree({ rootNodes: [] });

    expect(
      applyReorderChildren(normalized, {
        parentGroupId: null,
        orderedNodes: [],
      }).status,
    ).toBe('unchanged');

    expect(() =>
      applyReorderChildren(normalized, {
        parentGroupId: null,
        orderedNodes: [{ type: 'item', id: 'ghost' }],
      }),
    ).toThrow(/件数が現在の children と一致しません/);

    const withRoot = baseV13Tree({
      rootNodes: [{ type: 'item', id: 'item-a' }],
      items: { 'item-a': emptyItem() },
    });
    const withTwo = baseV13Tree({
      rootNodes: [
        { type: 'item', id: 'item-a' },
        { type: 'item', id: 'item-b' },
      ],
      items: {
        'item-a': emptyItem(),
        'item-b': emptyItem(),
      },
    });
    expect(() =>
      applyReorderChildren(withTwo, {
        parentGroupId: null,
        orderedNodes: [
          { type: 'item', id: 'item-a' },
          { type: 'item', id: 'item-a' },
        ],
      }),
    ).toThrow(/重複 node/);

    expect(() =>
      applyReorderChildren(withRoot, {
        parentGroupId: null,
        orderedNodes: [],
      }),
    ).toThrow(/件数が現在の children と一致しません/);

    expect(() =>
      applyReorderChildren(withRoot, {
        parentGroupId: 'missing',
        orderedNodes: [{ type: 'item', id: 'item-a' }],
      }),
    ).toThrow(/Group が見つかりません/);

    expect(() =>
      applyReorderChildren(withRoot, {
        parentGroupId: null,
        orderedNodes: [{ type: 'group', id: 'item-a' }],
      }),
    ).toThrow(/type が一致しません/);
  });
});

describe('moveDescriptionNode persistence', () => {
  it('v1.2 root reorder → v1.3 lazy migration', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.2',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      itemOrder: ['item-b', 'item-a'],
      items: {
        'item-a': emptyItem(),
        'item-b': emptyItem(),
      },
      excludedItems: { 'item-x': emptyItem() },
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await reorderDescriptionChildren(ctx(root), {
      parentGroupId: null,
      orderedNodes: [
        { type: 'item', id: 'item-a' },
        { type: 'item', id: 'item-b' },
      ],
      expectedRevision: revision,
    });
    const saved = readSaved(root);
    expect(saved.schemaVersion).toBe('1.3');
    expect(saved.itemOrder).toBeUndefined();
    expect(saved.rootNodes).toEqual([
      { type: 'item', id: 'item-a' },
      { type: 'item', id: 'item-b' },
    ]);
    expect(saved.excludedItems).toEqual({ 'item-x': emptyItem() });
  });

  it('v1.2 Group destination 失敗時は lazy migration しない', async () => {
    const root = tempRoot();
    const original = writeDescriptionFile(root, {
      schemaVersion: '1.1',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      itemOrder: ['item-a'],
      items: { 'item-a': emptyItem() },
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await expectDocErrorCode(
      () =>
        moveDescriptionNode(ctx(root), {
          node: { type: 'item', id: 'item-a' },
          destinationParentGroupId: 'section',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
    );
    expect(fs.readFileSync(
      path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json'),
      'utf8',
    )).toBe(original);
    expect(readSaved(root).schemaVersion).toBe('1.1');
  });

  it('unchanged は bytes / mtime を変更しない', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'item', id: 'item-a' }],
      groups: [],
      items: { 'item-a': emptyItem() },
      excludedItems: {},
    });
    const filePath = path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json');
    const before = fs.readFileSync(filePath);
    const mtime = fs.statSync(filePath).mtimeMs;
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    const result = await moveDescriptionNode(ctx(root), {
      node: { type: 'item', id: 'item-a' },
      destinationParentGroupId: null,
      expectedRevision: revision,
    });
    expect(result.status).toBe('unchanged');
    expect(fs.readFileSync(filePath)).toEqual(before);
    expect(fs.statSync(filePath).mtimeMs).toBe(mtime);
  });

  it('replace 失敗後も revision 維持し後続 mutation 可能', async () => {
    const root = tempRoot();
    const original = writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [
        { type: 'item', id: 'item-a' },
        { type: 'item', id: 'item-b' },
      ],
      groups: [],
      items: {
        'item-a': emptyItem(),
        'item-b': emptyItem(),
      },
      excludedItems: {},
    });
    const filePath = path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json');
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    const { io } = createMemoryFs({ [filePath]: Buffer.from(original) });
    const baseRename = io.renameSync.bind(io);
    io.renameSync = (from, to) => {
      if (from.includes('.tmp') && to === filePath) {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      }
      return baseRename(from, to);
    };

    await expect(
      moveDescriptionNode(ctx(root), {
        node: { type: 'item', id: 'item-b' },
        destinationParentGroupId: null,
        insertIndex: 0,
        expectedRevision: revision,
        adapters: {
          fs: io,
          writeFileAtomic: (target, content, options) =>
            writeFileAtomic(target, content, { ...options, fs: io }),
          readFileSync: ((p) => io.readFileSync(String(p))) as typeof fs.readFileSync,
          existsSync: ((p) => io.existsSync(String(p))) as typeof fs.existsSync,
        },
      }),
    ).rejects.toThrow(/EPERM/);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(original);
    expect(readDescriptionRevision(root, 'demo', 'demo-screen')).toBe(revision);

    const retry = await moveDescriptionNode(ctx(root), {
      node: { type: 'item', id: 'item-b' },
      destinationParentGroupId: null,
      insertIndex: 0,
      expectedRevision: revision,
    });
    expect(retry.status).toBe('updated');
    expect(readSaved(root).rootNodes).toEqual([
      { type: 'item', id: 'item-b' },
      { type: 'item', id: 'item-a' },
    ]);
  });

  it('同一 revision 並行 move は 1 成功 1 conflict', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [
        { type: 'item', id: 'item-a' },
        { type: 'item', id: 'item-b' },
      ],
      groups: [],
      items: {
        'item-a': emptyItem(),
        'item-b': emptyItem(),
      },
      excludedItems: {},
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    const results = await Promise.allSettled([
      moveDescriptionNode(ctx(root), {
        node: { type: 'item', id: 'item-a' },
        destinationParentGroupId: null,
        insertIndex: 1,
        expectedRevision: revision,
      }),
      moveDescriptionNode(ctx(root), {
        node: { type: 'item', id: 'item-b' },
        destinationParentGroupId: null,
        insertIndex: 0,
        expectedRevision: revision,
      }),
    ]);
    const codes = results.map((r) =>
      r.status === 'fulfilled' ? 'ok' : docErrorCode(r.reason),
    );
    expect(codes.filter((c) => c === 'ok')).toHaveLength(1);
    expect(codes.filter((c) => c === 'SPEC_DESCRIPTION_REVISION_CONFLICT')).toHaveLength(1);
  });
});

function createMemoryFs(initial: Record<string, Buffer> = {}) {
  const files = new Map<string, Buffer>(
    Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)]),
  );
  const io: WriteFileAtomicFs = {
    existsSync: (p) => files.has(p),
    mkdirSync: () => undefined,
    readFileSync: (p) => {
      const buf = files.get(p);
      if (!buf) {
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      }
      return Buffer.from(buf);
    },
    writeFileSync: (p, data) => {
      files.set(p, Buffer.from(data));
    },
    renameSync: (from, to) => {
      const buf = files.get(from);
      if (!buf) {
        throw Object.assign(new Error(`ENOENT rename from ${from}`), { code: 'ENOENT' });
      }
      files.set(to, Buffer.from(buf));
      files.delete(from);
    },
    unlinkSync: (p) => {
      files.delete(p);
    },
    linkSync: (existingPath, newPath) => {
      const buf = files.get(existingPath);
      if (!buf) {
        throw Object.assign(new Error(`ENOENT link from ${existingPath}`), { code: 'ENOENT' });
      }
      if (files.has(newPath)) {
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      }
      files.set(newPath, Buffer.from(buf));
    },
  };
  return { io, files };
}
