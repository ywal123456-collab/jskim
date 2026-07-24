import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DescriptionDocumentError,
  applyDeleteGroup,
  applyDeleteGroupSubtree,
  cloneNormalizedDescription,
  collectGroupSubtree,
  deleteDescriptionGroup,
  deleteDescriptionGroupSubtree,
  readDescriptionDocument,
  readDescriptionRevision,
  updateDescriptionGroup,
} from '../../src/editing/description-document/index.js';
import { resetDescriptionScreenLocksForTest } from '../../src/editing/description-screen-lock.js';
import {
  computeContentRevision,
  writeFileAtomic,
  type WriteFileAtomicFs,
} from '../../src/util/write-file-atomic.js';
import type { NormalizedDescription } from '../../src/editing/description-document/types.js';

const temps: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-group-delete-'));
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

function writeSnapshot(root: string, html: string): void {
  const dir = path.join(root, 'spec', 'demo', 'src', 'snapshots', 'demo-screen');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'default.html'), html, 'utf8');
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

function promotionTree(): NormalizedDescription {
  return normalizeFromDoc({
    schemaVersion: '1.3',
    screen: { id: 'demo-screen', name: 'Demo', description: '' },
    rootNodes: [
      { type: 'item', id: 'item-a' },
      { type: 'group', id: 'group-x' },
      { type: 'item', id: 'item-d' },
    ],
    groups: [
      {
        groupId: 'group-x',
        name: 'X',
        kind: 'SECTION',
        children: [
          { type: 'item', id: 'item-b' },
          { type: 'group', id: 'group-y' },
          { type: 'item', id: 'item-c' },
        ],
      },
      {
        groupId: 'group-y',
        name: 'Y',
        kind: 'SECTION',
        children: [{ type: 'item', id: 'item-y' }],
      },
    ],
    items: {
      'item-a': emptyItem(),
      'item-b': emptyItem(),
      'item-c': emptyItem(),
      'item-d': emptyItem(),
      'item-y': emptyItem(),
    },
    excludedItems: { 'excluded-item': emptyItem() },
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

describe('collectGroupSubtree', () => {
  it('depth-first pre-order で group / item を収集する', () => {
    const normalized = promotionTree();
    expect(collectGroupSubtree(normalized, 'group-x')).toEqual({
      groupIds: ['group-x', 'group-y'],
      itemIds: ['item-b', 'item-y', 'item-c'],
    });
  });
});

describe('applyDeleteGroup', () => {
  it('children を同一 index へ昇格し Group 定義のみ削除する', () => {
    const before = promotionTree();
    const snapshot = cloneNormalizedDescription(before);
    const result = applyDeleteGroup(before, { groupId: 'group-x' });

    expect(result.normalized.rootNodes).toEqual([
      { type: 'item', id: 'item-a' },
      { type: 'item', id: 'item-b' },
      { type: 'group', id: 'group-y' },
      { type: 'item', id: 'item-c' },
      { type: 'item', id: 'item-d' },
    ]);
    expect(result.normalized.groups.map((g) => g.groupId)).toEqual(['group-y']);
    expect(Object.keys(result.normalized.items).sort()).toEqual([
      'item-a',
      'item-b',
      'item-c',
      'item-d',
      'item-y',
    ]);
    expect(result.normalized.excludedItems).toEqual({ 'excluded-item': emptyItem() });
    expect(before.rootNodes).toEqual(snapshot.rootNodes);
  });

  it('root / nested の空 Group を削除する', () => {
    const normalized = normalizeFromDoc({
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [
        { type: 'group', id: 'empty-root' },
        {
          type: 'group',
          id: 'parent',
        },
      ],
      groups: [
        { groupId: 'empty-root', name: 'E', kind: 'SECTION', children: [] },
        {
          groupId: 'parent',
          name: 'P',
          kind: 'SECTION',
          children: [{ type: 'group', id: 'empty-nested' }],
        },
        { groupId: 'empty-nested', name: 'N', kind: 'SECTION', children: [] },
      ],
      items: {},
      excludedItems: {},
    });

    const afterRoot = applyDeleteGroup(normalized, { groupId: 'empty-root' });
    expect(afterRoot.normalized.rootNodes).toEqual([{ type: 'group', id: 'parent' }]);
    expect(afterRoot.normalized.groups.map((g) => g.groupId)).toEqual([
      'parent',
      'empty-nested',
    ]);

    const afterNested = applyDeleteGroup(afterRoot.normalized, {
      groupId: 'empty-nested',
    });
    expect(afterNested.normalized.groups).toHaveLength(1);
    expect(afterNested.normalized.groups[0].children).toEqual([]);
  });

  it('Group not found / unknown field / 入力不変', () => {
    const normalized = promotionTree();
    const snapshot = cloneNormalizedDescription(normalized);

    expect(() => applyDeleteGroup(normalized, { groupId: 'missing' })).toThrow(
      /Group が見つかりません/,
    );
    expect(() =>
      applyDeleteGroup(normalized, {
        groupId: 'group-x',
        force: true,
      } as DeleteGroupInputWithForce),
    ).toThrow(/許可されていないフィールド/);
    expect(normalized.rootNodes).toEqual(snapshot.rootNodes);
  });
});

type DeleteGroupInputWithForce = { groupId: string; force?: boolean };

describe('applyDeleteGroupSubtree', () => {
  it('manual-only subtree を削除し items / groups 定義を除去する', () => {
    const normalized = promotionTree();
    const result = applyDeleteGroupSubtree(normalized, { groupId: 'group-x' }, []);

    expect(result.normalized.rootNodes).toEqual([
      { type: 'item', id: 'item-a' },
      { type: 'item', id: 'item-d' },
    ]);
    expect(result.normalized.groups).toEqual([]);
    expect(Object.keys(result.normalized.items).sort()).toEqual(['item-a', 'item-d']);
    expect(result.normalized.excludedItems).toEqual({ 'excluded-item': emptyItem() });
  });

  it('collected Item 含有時は DFS 最初の itemId で atomic 拒否する', () => {
    const normalized = promotionTree();
    const before = cloneNormalizedDescription(normalized);

    expect(() =>
      applyDeleteGroupSubtree(normalized, { groupId: 'group-x' }, ['item-b']),
    ).toThrow(/item-b/);
    expect(normalized.rootNodes).toEqual(before.rootNodes);

    expect(() =>
      applyDeleteGroupSubtree(normalized, { groupId: 'group-x' }, ['item-y', 'item-b']),
    ).toThrow(/item-b/);
  });

  it('manual-only 後ろに collected があっても partial delete しない', () => {
    const normalized = normalizeFromDoc({
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'group', id: 'section' }],
      groups: [
        {
          groupId: 'section',
          name: 'S',
          kind: 'SECTION',
          children: [
            { type: 'item', id: 'manual-item' },
            { type: 'item', id: 'collected-item' },
          ],
        },
      ],
      items: {
        'manual-item': emptyItem(),
        'collected-item': emptyItem(),
      },
      excludedItems: {},
    });
    const before = cloneNormalizedDescription(normalized);
    expect(() =>
      applyDeleteGroupSubtree(normalized, { groupId: 'section' }, ['collected-item']),
    ).toThrow(/collected-item/);
    expect(normalized).toEqual(before);
  });
});

describe('deleteDescriptionGroup persistence', () => {
  it('v1.2 deleteGroup は not found で lazy migration しない', async () => {
    const root = tempRoot();
    const original = writeDescriptionFile(root, {
      schemaVersion: '1.2',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      itemOrder: ['item-a'],
      items: { 'item-a': emptyItem() },
      excludedItems: {},
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await expectDocErrorCode(
      () =>
        deleteDescriptionGroup(ctx(root), {
          groupId: 'section',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
    );
    expect(
      fs.readFileSync(
        path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json'),
        'utf8',
      ),
    ).toBe(original);
  });

  it('v1.3 deleteGroup は children 昇格を永続化する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [
        { type: 'item', id: 'item-a' },
        { type: 'group', id: 'group-x' },
        { type: 'item', id: 'item-d' },
      ],
      groups: [
        {
          groupId: 'group-x',
          name: 'X',
          kind: 'SECTION',
          children: [
            { type: 'item', id: 'item-b' },
            { type: 'group', id: 'group-y' },
            { type: 'item', id: 'item-c' },
          ],
        },
        {
          groupId: 'group-y',
          name: 'Y',
          kind: 'SECTION',
          children: [],
        },
      ],
      items: {
        'item-a': emptyItem(),
        'item-b': emptyItem(),
        'item-c': emptyItem(),
        'item-d': emptyItem(),
      },
      excludedItems: {},
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await deleteDescriptionGroup(ctx(root), {
      groupId: 'group-x',
      expectedRevision: revision,
    });
    const saved = readSaved(root);
    expect(saved.rootNodes).toEqual([
      { type: 'item', id: 'item-a' },
      { type: 'item', id: 'item-b' },
      { type: 'group', id: 'group-y' },
      { type: 'item', id: 'item-c' },
      { type: 'item', id: 'item-d' },
    ]);
    expect(saved.groups).toHaveLength(1);
  });

  it('replace 失敗後も revision 維持し後続 delete 成功', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'group', id: 'section' }],
      groups: [{ groupId: 'section', name: 'S', kind: 'SECTION', children: [] }],
      items: {},
      excludedItems: {},
    });
    const filePath = path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json');
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    const { io } = createMemoryFs({
      [filePath]: Buffer.from(fs.readFileSync(filePath)),
    });
    const baseRename = io.renameSync.bind(io);
    io.renameSync = (from, to) => {
      if (from.includes('.tmp') && to === filePath) {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      }
      return baseRename(from, to);
    };

    await expect(
      deleteDescriptionGroup(ctx(root), {
        groupId: 'section',
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
    expect(readDescriptionRevision(root, 'demo', 'demo-screen')).toBe(revision);
    expect(readSaved(root).groups).toHaveLength(1);

    await deleteDescriptionGroup(ctx(root), {
      groupId: 'section',
      expectedRevision: revision,
    });
    expect(readSaved(root).groups).toHaveLength(0);
  });

  it('同一 revision で deleteGroup と updateGroup 並行 → 1 成功 1 conflict', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'group', id: 'section' }],
      groups: [{ groupId: 'section', name: 'S', kind: 'SECTION', children: [] }],
      items: {},
      excludedItems: {},
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;

    const results = await Promise.allSettled([
      deleteDescriptionGroup(ctx(root), {
        groupId: 'section',
        expectedRevision: revision,
      }),
      updateDescriptionGroup(ctx(root), {
        groupId: 'section',
        name: 'Renamed',
        expectedRevision: revision,
      }),
    ]);

    const codes = results.map((result) =>
      result.status === 'rejected'
        ? docErrorCode(result.reason)
        : result.value.status,
    );
    expect(codes.filter((code) => code === 'updated')).toHaveLength(1);
    expect(codes.filter((code) => code === 'SPEC_DESCRIPTION_REVISION_CONFLICT')).toHaveLength(1);
  });
});

describe('deleteDescriptionGroupSubtree persistence', () => {
  it('snapshot collected Item 保護で bytes / revision 不変', async () => {
    const root = tempRoot();
    writeSnapshot(
      root,
      '<div data-jskim-spec-item="item-b"></div><div data-jskim-spec-item="item-a"></div>',
    );
    const original = writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'group', id: 'section' }],
      groups: [
        {
          groupId: 'section',
          name: 'S',
          kind: 'SECTION',
          children: [
            { type: 'item', id: 'manual-item' },
            { type: 'item', id: 'item-b' },
          ],
        },
      ],
      items: {
        'manual-item': emptyItem(),
        'item-b': emptyItem(),
      },
      excludedItems: {},
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    const mtimeBefore = fs.statSync(
      path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json'),
    ).mtimeMs;

    await expectDocErrorCode(
      () =>
        deleteDescriptionGroupSubtree(ctx(root), {
          groupId: 'section',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_GROUP_SUBTREE_CONTAINS_COLLECTED_ITEM',
    );

    expect(
      fs.readFileSync(
        path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json'),
        'utf8',
      ),
    ).toBe(original);
    expect(readDescriptionRevision(root, 'demo', 'demo-screen')).toBe(revision);
    expect(
      fs.statSync(path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json')).mtimeMs,
    ).toBe(mtimeBefore);
  });

  it('snapshot 無し subtree 削除は fail-closed で bytes / revision / mtime 不変', async () => {
    const root = tempRoot();
    const original = writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'group', id: 'section' }],
      groups: [
        {
          groupId: 'section',
          name: 'S',
          kind: 'SECTION',
          children: [{ type: 'item', id: 'manual-item' }],
        },
      ],
      items: { 'manual-item': emptyItem() },
      excludedItems: { 'excluded-item': emptyItem() },
    });
    const filePath = path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json');
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    const mtimeBefore = fs.statSync(filePath).mtimeMs;

    await expectDocErrorCode(
      () =>
        deleteDescriptionGroupSubtree(ctx(root), {
          groupId: 'section',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_COLLECTED_STATE_UNAVAILABLE',
    );

    expect(fs.readFileSync(filePath, 'utf8')).toBe(original);
    expect(readDescriptionRevision(root, 'demo', 'demo-screen')).toBe(revision);
    expect(fs.statSync(filePath).mtimeMs).toBe(mtimeBefore);
  });

  it('snapshot 読取不能時も subtree 削除は fail-closed で Description 不変', async () => {
    const root = tempRoot();
    const original = writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'group', id: 'section' }],
      groups: [
        {
          groupId: 'section',
          name: 'S',
          kind: 'SECTION',
          children: [{ type: 'item', id: 'manual-item' }],
        },
      ],
      items: { 'manual-item': emptyItem() },
      excludedItems: {},
    });
    const filePath = path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json');
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    const mtimeBefore = fs.statSync(filePath).mtimeMs;
    // ディレクトリではなくファイルにして readdir 失敗を起こす（既存 fs 契約の fail-closed）
    const snapshotPath = path.join(
      root,
      'spec',
      'demo',
      'src',
      'snapshots',
      'demo-screen',
    );
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, 'not-a-directory', 'utf8');

    await expectDocErrorCode(
      () =>
        deleteDescriptionGroupSubtree(ctx(root), {
          groupId: 'section',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_COLLECTED_STATE_UNAVAILABLE',
    );
    expect(fs.readFileSync(filePath, 'utf8')).toBe(original);
    expect(readDescriptionRevision(root, 'demo', 'demo-screen')).toBe(revision);
    expect(fs.statSync(filePath).mtimeMs).toBe(mtimeBefore);
  });

  it('manual-only nested subtree は空 snapshot 判定後に削除成功する', async () => {
    const root = tempRoot();
    writeSnapshot(root, '<div></div>');
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: 'keep' },
      rootNodes: [
        { type: 'item', id: 'sibling-before' },
        { type: 'group', id: 'section' },
        { type: 'item', id: 'sibling-after' },
        { type: 'group', id: 'other' },
      ],
      groups: [
        {
          groupId: 'section',
          name: 'S',
          kind: 'SECTION',
          children: [
            { type: 'item', id: 'manual-a' },
            { type: 'group', id: 'nested' },
            { type: 'item', id: 'manual-b' },
          ],
        },
        {
          groupId: 'nested',
          name: 'N',
          kind: 'SECTION',
          children: [{ type: 'item', id: 'manual-n' }],
        },
        {
          groupId: 'other',
          name: 'O',
          kind: 'SECTION',
          children: [{ type: 'item', id: 'other-item' }],
        },
      ],
      items: {
        'sibling-before': emptyItem(),
        'sibling-after': emptyItem(),
        'manual-a': emptyItem(),
        'manual-b': emptyItem(),
        'manual-n': emptyItem(),
        'other-item': emptyItem(),
      },
      excludedItems: { 'excluded-item': emptyItem() },
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await deleteDescriptionGroupSubtree(ctx(root), {
      groupId: 'section',
      expectedRevision: revision,
    });
    const saved = readSaved(root);
    expect(saved.schemaVersion).toBe('1.3');
    expect(saved.screen).toEqual({
      id: 'demo-screen',
      name: 'Demo',
      description: 'keep',
    });
    expect(saved.rootNodes).toEqual([
      { type: 'item', id: 'sibling-before' },
      { type: 'item', id: 'sibling-after' },
      { type: 'group', id: 'other' },
    ]);
    expect(saved.groups).toEqual([
      {
        groupId: 'other',
        name: 'O',
        kind: 'SECTION',
        children: [{ type: 'item', id: 'other-item' }],
      },
    ]);
    expect(Object.keys(saved.items as object).sort()).toEqual([
      'other-item',
      'sibling-after',
      'sibling-before',
    ]);
    expect(saved.excludedItems).toEqual({ 'excluded-item': emptyItem() });
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
        throw Object.assign(new Error(`ENOENT: ${from}`), { code: 'ENOENT' });
      }
      files.set(to, Buffer.from(buf));
      files.delete(from);
    },
    unlinkSync: (p) => {
      files.delete(p);
    },
  };
  return { io, files };
}
