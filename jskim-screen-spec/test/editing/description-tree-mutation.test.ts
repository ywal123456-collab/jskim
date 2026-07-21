import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeDescription } from '../../src/collector/merge-description.js';
import { writeCollectedDescription } from '../../src/collector/write-collected-description.js';
import {
  DescriptionDocumentError,
  createDescriptionGroup,
  descriptionScreenMutationLockPath,
  flattenItemTree,
  readDescriptionDocument,
  readDescriptionRevision,
  readDescriptionTreeState,
  updateDescriptionGroup,
} from '../../src/editing/description-document/index.js';
import {
  bindDescriptionScreenLock,
  resetDescriptionScreenLocksForTest,
  withDescriptionScreenLock,
} from '../../src/editing/description-screen-lock.js';
import { createFileDescriptionStore } from '../../src/editing/file-description-store.js';
import {
  computeContentRevision,
  writeFileAtomic,
  type WriteFileAtomicFs,
} from '../../src/util/write-file-atomic.js';

const temps: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-desc-tree-'));
  temps.push(dir);
  fs.mkdirSync(path.join(dir, 'spec', 'demo', 'src', 'data'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(dir, 'spec', 'demo', '.jskim', 'description-mutation'), {
    recursive: true,
  });
  return dir;
}

function ctx(root: string) {
  return { rootDir: root, projectName: 'demo', screenId: 'demo-screen' };
}

function emptyItem() {
  return { name: '', type: '', description: '', note: '' };
}

function writeDescriptionFile(
  root: string,
  doc: Record<string, unknown>,
): string {
  const filePath = path.join(
    root,
    'spec',
    'demo',
    'src',
    'data',
    'demo-screen.json',
  );
  const json = `${JSON.stringify(doc, null, 2)}\n`;
  fs.writeFileSync(filePath, json, 'utf8');
  return json;
}

function readSaved(root: string): Record<string, unknown> {
  const filePath = path.join(
    root,
    'spec',
    'demo',
    'src',
    'data',
    'demo-screen.json',
  );
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

function createMemoryFs(initial: Record<string, Buffer> = {}) {
  const files = new Map<string, Buffer>(
    Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)]),
  );
  const failOn = {
    writeFileSync: null as null | Error,
    renameSync: [] as Array<{
      fromIncludes?: string;
      toIncludes?: string;
      error: Error;
    }>,
  };

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
      if (failOn.writeFileSync) {
        throw failOn.writeFileSync;
      }
      files.set(p, Buffer.from(data));
    },
    renameSync: (from, to) => {
      for (const rule of failOn.renameSync) {
        if (
          (!rule.fromIncludes || from.includes(rule.fromIncludes)) &&
          (!rule.toIncludes || to.includes(rule.toIncludes))
        ) {
          throw rule.error;
        }
      }
      const buf = files.get(from);
      if (!buf) {
        throw Object.assign(new Error(`ENOENT rename from ${from}`), {
          code: 'ENOENT',
        });
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
        throw Object.assign(new Error(`ENOENT link from ${existingPath}`), {
          code: 'ENOENT',
        });
      }
      if (files.has(newPath)) {
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      }
      files.set(newPath, Buffer.from(buf));
    },
  };

  return { io, files, failOn };
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

describe('Description tree mutation', () => {
  it('read-only は bytes / mtime を変更しない', () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.2',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      itemOrder: ['item-a'],
      items: { 'item-a': emptyItem() },
      excludedItems: {},
    });
    const filePath = path.join(
      root,
      'spec',
      'demo',
      'src',
      'data',
      'demo-screen.json',
    );
    const before = fs.readFileSync(filePath);
    const mtime = fs.statSync(filePath).mtimeMs;
    readDescriptionTreeState(ctx(root));
    expect(fs.readFileSync(filePath)).toEqual(before);
    expect(fs.statSync(filePath).mtimeMs).toBe(mtime);
  });

  it('Description ファイル無し read は NOT_FOUND', () => {
    const root = tempRoot();
    const state = readDescriptionTreeState(ctx(root));
    expect(state).toHaveProperty('error');
    if (!('error' in state)) {
      return;
    }
    expect(state.error.code).toBe('SPEC_DESCRIPTION_NOT_FOUND');
  });

  it('Description ファイル無し mutation は NOT_FOUND', async () => {
    const root = tempRoot();
    await expect(
      createDescriptionGroup(ctx(root), {
        groupId: 'section',
        name: 'Section',
        kind: 'SECTION',
        expectedRevision: 'sha256:deadbeef',
      }),
    ).rejects.toMatchObject({ code: 'SPEC_DESCRIPTION_NOT_FOUND' });
  });

  it('expectedRevision 欠落を拒否する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [],
      groups: [],
      items: {},
      excludedItems: {},
    });
    await expectDocErrorCode(
      () =>
        createDescriptionGroup(ctx(root), {
          groupId: 'section',
          name: 'Section',
          kind: 'SECTION',
          expectedRevision: undefined as unknown as string,
        }),
      'SPEC_DESCRIPTION_REVISION_REQUIRED',
    );
  });

  it('stale revision は conflict する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [],
      groups: [],
      items: {},
      excludedItems: {},
    });
    await expectDocErrorCode(
      () =>
        createDescriptionGroup(ctx(root), {
          groupId: 'section',
          name: 'Section',
          kind: 'SECTION',
          expectedRevision: 'sha256:deadbeef',
        }),
      'SPEC_DESCRIPTION_REVISION_CONFLICT',
    );
  });

  it('v1.0 createGroup で v1.3 lazy migration し item 順序を維持する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.0',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      items: {
        'item-b': emptyItem(),
        'item-a': emptyItem(),
      },
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    const result = await createDescriptionGroup(ctx(root), {
      groupId: 'section',
      name: 'Section',
      kind: 'SECTION',
      expectedRevision: revision,
      collectedOrder: ['item-b', 'item-a'],
    });
    expect(result.status).toBe('updated');
    expect(result.sourceSchemaVersion).toBe('1.3');
    const saved = readSaved(root);
    expect(saved.schemaVersion).toBe('1.3');
    expect(saved.itemOrder).toBeUndefined();
    expect(saved.rootNodes).toEqual([
      { type: 'item', id: 'item-b' },
      { type: 'item', id: 'item-a' },
      { type: 'group', id: 'section' },
    ]);
    expect(saved.groups).toHaveLength(1);
    expect(saved.excludedItems).toEqual({});
  });

  it('v1.1 createGroup で itemOrder 順序を rootNodes に反映する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.1',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      itemOrder: ['item-b', 'item-a'],
      items: {
        'item-a': emptyItem(),
        'item-b': emptyItem(),
      },
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await createDescriptionGroup(ctx(root), {
      groupId: 'section',
      name: 'Section',
      kind: 'SECTION',
      expectedRevision: revision,
    });
    const saved = readSaved(root);
    expect(saved.schemaVersion).toBe('1.3');
    expect(saved.rootNodes).toEqual([
      { type: 'item', id: 'item-b' },
      { type: 'item', id: 'item-a' },
      { type: 'group', id: 'section' },
    ]);
  });

  it('v1.2 createGroup で excludedItems を維持する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.2',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      itemOrder: ['active-item'],
      items: { 'active-item': emptyItem() },
      excludedItems: { 'excluded-item': emptyItem() },
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await createDescriptionGroup(ctx(root), {
      groupId: 'section',
      name: 'Section',
      kind: 'SECTION',
      expectedRevision: revision,
    });
    const saved = readSaved(root);
    expect(saved.excludedItems).toHaveProperty('excluded-item');
    expect(saved.itemOrder).toBeUndefined();
  });

  it('createGroup root tail / insertIndex / nested / depth 8 / depth 9', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'item', id: 'item-a' }],
      groups: [],
      items: { 'item-a': emptyItem() },
      excludedItems: {},
    });
    let revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await createDescriptionGroup(ctx(root), {
      groupId: 'tail-group',
      name: 'Tail',
      kind: 'SECTION',
      expectedRevision: revision,
    });
    let saved = readSaved(root);
    expect(saved.rootNodes).toEqual([
      { type: 'item', id: 'item-a' },
      { type: 'group', id: 'tail-group' },
    ]);

    revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await createDescriptionGroup(ctx(root), {
      groupId: 'head-group',
      name: 'Head',
      kind: 'SECTION',
      insertIndex: 0,
      expectedRevision: revision,
    });
    saved = readSaved(root);
    expect((saved.rootNodes as unknown[])[0]).toEqual({
      type: 'group',
      id: 'head-group',
    });

    revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await createDescriptionGroup(ctx(root), {
      groupId: 'child-group',
      name: 'Child',
      kind: 'CARD',
      parentGroupId: 'head-group',
      expectedRevision: revision,
    });
    saved = readSaved(root);
    const head = (saved.groups as Array<{ groupId: string; children: unknown[] }>).find(
      (g) => g.groupId === 'head-group',
    );
    expect(head?.children.at(-1)).toEqual({ type: 'group', id: 'child-group' });

    revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await createDescriptionGroup(ctx(root), {
      groupId: 'first-child',
      name: 'First',
      kind: 'CONTENT',
      parentGroupId: 'head-group',
      insertIndex: 0,
      expectedRevision: revision,
    });
    saved = readSaved(root);
    const head2 = (saved.groups as Array<{ groupId: string; children: unknown[] }>).find(
      (g) => g.groupId === 'head-group',
    );
    expect(head2?.children[0]).toEqual({ type: 'group', id: 'first-child' });

    const depthRoot = tempRoot();
    const groups = [];
    const rootNodes = [{ type: 'group', id: 'g1' }];
    for (let i = 1; i <= 8; i += 1) {
      groups.push({
        groupId: `g${i}`,
        name: `G${i}`,
        kind: 'SECTION',
        children:
          i === 8 ? [] : [{ type: 'group', id: `g${i + 1}` }],
      });
    }
    writeDescriptionFile(depthRoot, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes,
      groups,
      items: {},
      excludedItems: {},
    });
    revision = readDescriptionRevision(depthRoot, 'demo', 'demo-screen')!;
    await expectDocErrorCode(
      () =>
        createDescriptionGroup(ctx(depthRoot), {
          groupId: 'too-deep',
          name: 'Too deep',
          kind: 'SECTION',
          parentGroupId: 'g8',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_GROUP_DEPTH_EXCEEDED',
    );
  });

  it('createGroup duplicate / collision / parent / insertIndex を拒否する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'group', id: 'section' }, { type: 'item', id: 'item-a' }],
      groups: [
        {
          groupId: 'section',
          name: 'Section',
          kind: 'SECTION',
          children: [],
        },
      ],
      items: { 'item-a': emptyItem() },
      excludedItems: { 'excluded-a': emptyItem() },
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await expectDocErrorCode(
      () =>
        createDescriptionGroup(ctx(root), {
          groupId: 'section',
          name: 'Dup',
          kind: 'SECTION',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_GROUP_ALREADY_EXISTS',
    );
    await expectDocErrorCode(
      () =>
        createDescriptionGroup(ctx(root), {
          groupId: 'item-a',
          name: 'Bad',
          kind: 'SECTION',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
    );
    await expectDocErrorCode(
      () =>
        createDescriptionGroup(ctx(root), {
          groupId: 'excluded-a',
          name: 'Bad',
          kind: 'SECTION',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
    );
    await expectDocErrorCode(
      () =>
        createDescriptionGroup(ctx(root), {
          groupId: 'missing-parent',
          name: 'Bad',
          kind: 'SECTION',
          parentGroupId: 'ghost',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_GROUP_PARENT_NOT_FOUND',
    );
    await expectDocErrorCode(
      () =>
        createDescriptionGroup(ctx(root), {
          groupId: 'bad-index',
          name: 'Bad',
          kind: 'SECTION',
          insertIndex: 99,
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_GROUP_INSERT_INDEX_INVALID',
    );
  });

  it('updateGroup metadata 変更と unchanged / not found', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'group', id: 'section' }],
      groups: [
        {
          groupId: 'section',
          name: 'Old',
          kind: 'SECTION',
          children: [{ type: 'item', id: 'item-a' }],
        },
      ],
      items: { 'item-a': emptyItem() },
      excludedItems: {},
    });
    let revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    const before = fs.readFileSync(
      path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json'),
    );
    const unchanged = await updateDescriptionGroup(ctx(root), {
      groupId: 'section',
      name: 'Old',
      expectedRevision: revision,
    });
    expect(unchanged.status).toBe('unchanged');
    expect(
      fs.readFileSync(
        path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json'),
      ),
    ).toEqual(before);

    revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await updateDescriptionGroup(ctx(root), {
      groupId: 'section',
      name: 'New Name',
      description: 'desc',
      kind: 'CARD',
      expectedRevision: revision,
    });
    const saved = readSaved(root);
    const group = (saved.groups as Array<Record<string, unknown>>)[0];
    expect(group.name).toBe('New Name');
    expect(group.description).toBe('desc');
    expect(group.kind).toBe('CARD');
    expect(group.children).toEqual([{ type: 'item', id: 'item-a' }]);
    expect(saved.rootNodes).toEqual([{ type: 'group', id: 'section' }]);

    revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await updateDescriptionGroup(ctx(root), {
      groupId: 'section',
      description: null,
      expectedRevision: revision,
    });
    expect((readSaved(root).groups as Array<Record<string, unknown>>)[0].description).toBeUndefined();

    await expectDocErrorCode(
      () =>
        updateDescriptionGroup(ctx(root), {
          groupId: 'missing',
          name: 'X',
          expectedRevision: readDescriptionRevision(root, 'demo', 'demo-screen')!,
        }),
      'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
    );
  });

  it('updateGroup unknown field を拒否する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'group', id: 'section' }],
      groups: [
        {
          groupId: 'section',
          name: 'Section',
          kind: 'SECTION',
          children: [],
        },
      ],
      items: {},
      excludedItems: {},
    });
    await expectDocErrorCode(
      () =>
        updateDescriptionGroup(ctx(root), {
          groupId: 'section',
          name: 'Next',
          groupIdRenamed: 'bad',
          expectedRevision: readDescriptionRevision(root, 'demo', 'demo-screen')!,
        } as never),
      'SPEC_DESCRIPTION_INVALID',
    );
  });

  it('write 失敗時は既存 bytes を維持する', async () => {
    const root = tempRoot();
    const original = writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [],
      groups: [],
      items: {},
      excludedItems: {},
    });
    const filePath = path.join(
      root,
      'spec',
      'demo',
      'src',
      'data',
      'demo-screen.json',
    );
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    const { io, failOn } = createMemoryFs({
      [filePath]: Buffer.from(original),
    });
    failOn.writeFileSync = Object.assign(new Error('disk full'), {
      code: 'ENOSPC',
    });
    await expect(
      createDescriptionGroup(ctx(root), {
        groupId: 'section',
        name: 'Section',
        kind: 'SECTION',
        expectedRevision: revision,
          adapters: {
            fs: io,
            writeFileAtomic: (target, content, options) =>
              writeFileAtomic(target, content, { ...options, fs: io }),
            readFileSync: ((p) => io.readFileSync(String(p))) as typeof fs.readFileSync,
            existsSync: ((p) => io.existsSync(String(p))) as typeof fs.existsSync,
          },
      }),
    ).rejects.toThrow();
    expect(fs.readFileSync(filePath, 'utf8')).toBe(original);
  });

  it('filesystem lock 取得中は MUTATION_IN_PROGRESS を返す', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [],
      groups: [],
      items: {},
      excludedItems: {},
    });
    const lock = descriptionScreenMutationLockPath(root, 'demo', 'demo-screen');
    fs.writeFileSync(lock, '{"schemaVersion":"1.0"}\n', { flag: 'wx' });
    await expectDocErrorCode(
      () =>
        createDescriptionGroup(ctx(root), {
          groupId: 'section',
          name: 'Section',
          kind: 'SECTION',
          expectedRevision: readDescriptionRevision(root, 'demo', 'demo-screen')!,
        }),
      'SPEC_DESCRIPTION_MUTATION_IN_PROGRESS',
    );
    fs.unlinkSync(lock);
  });

  it('legacy Collector / PUT は v1.3 を fail-closed のまま維持する', async () => {
    const root = tempRoot();
    const filePath = path.join(
      root,
      'spec',
      'demo',
      'src',
      'data',
      'demo-screen.json',
    );
    fs.writeFileSync(
      filePath,
      `${JSON.stringify(
        {
          schemaVersion: '1.3',
          screen: { id: 'demo-screen', name: 'Demo', description: '' },
          rootNodes: [],
          groups: [],
          items: {},
          excludedItems: {},
        },
        null,
        2,
      )}\n`,
    );
    expect(() =>
      mergeDescription({
        existing: readSaved(root) as never,
        screenId: 'demo-screen',
        foundItemIds: [],
      }),
    ).toThrow(/schemaVersion "1.3"/);
    expect(() =>
      writeCollectedDescription({
        filePath,
        screenId: 'demo-screen',
        foundItemIds: ['new-item'],
      }),
    ).toThrow(/schemaVersion "1.3"/);

    const store = createFileDescriptionStore({
      rootDir: root,
      projectName: 'demo',
      listScreenIds: () => ['demo-screen'],
    });
    expect(() =>
      store.write(
        'demo-screen',
        {
          schemaVersion: '1.2',
          screen: { id: 'demo-screen', name: 'Demo', description: '' },
          itemOrder: [],
          items: {},
          excludedItems: {},
        },
        readDescriptionRevision(root, 'demo', 'demo-screen')!,
      ),
    ).toThrow(/schemaVersion "1.3"/);
  });

  it('flatten read projection は lazy migration 後も維持される', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.1',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      itemOrder: ['item-b', 'item-a'],
      items: {
        'item-a': emptyItem(),
        'item-b': emptyItem(),
      },
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await createDescriptionGroup(ctx(root), {
      groupId: 'section',
      name: 'Section',
      kind: 'SECTION',
      expectedRevision: revision,
    });
    const state = readDescriptionTreeState(ctx(root));
    expect(state).not.toHaveProperty('error');
    if ('error' in state) {
      return;
    }
    expect(state.flatItemOrder).toEqual(['item-b', 'item-a']);
    expect(flattenItemTree(state.normalized)).toEqual(['item-b', 'item-a']);
  });
});

describe('Description tree mutation concurrency', () => {
  it('同一 revision の並行 mutation は 1 成功 / 1 conflict', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [],
      groups: [],
      items: {},
      excludedItems: {},
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    const results = await Promise.allSettled([
      createDescriptionGroup(ctx(root), {
        groupId: 'group-a',
        name: 'A',
        kind: 'SECTION',
        expectedRevision: revision,
      }),
      createDescriptionGroup(ctx(root), {
        groupId: 'group-b',
        name: 'B',
        kind: 'SECTION',
        expectedRevision: revision,
      }),
    ]);
    const codes = results.map((result) =>
      result.status === 'fulfilled'
        ? 'ok'
        : docErrorCode(result.reason),
    );
    expect(codes.filter((c) => c === 'ok')).toHaveLength(1);
    expect(codes.filter((c) => c === 'SPEC_DESCRIPTION_REVISION_CONFLICT')).toHaveLength(1);
  });

  it('別 Screen は並列可能', async () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, 'spec', 'demo', 'src', 'data'), {
      recursive: true,
    });
    for (const screenId of ['screen-a', 'screen-b']) {
      fs.writeFileSync(
        path.join(root, 'spec', 'demo', 'src', 'data', `${screenId}.json`),
        `${JSON.stringify(
          {
            schemaVersion: '1.3',
            screen: { id: screenId, name: screenId, description: '' },
            rootNodes: [],
            groups: [],
            items: {},
            excludedItems: {},
          },
          null,
          2,
        )}\n`,
      );
    }
    const [a, b] = await Promise.all([
      createDescriptionGroup(
        { rootDir: root, projectName: 'demo', screenId: 'screen-a' },
        {
          groupId: 'ga',
          name: 'A',
          kind: 'SECTION',
          expectedRevision: readDescriptionRevision(root, 'demo', 'screen-a')!,
        },
      ),
      createDescriptionGroup(
        { rootDir: root, projectName: 'demo', screenId: 'screen-b' },
        {
          groupId: 'gb',
          name: 'B',
          kind: 'SECTION',
          expectedRevision: readDescriptionRevision(root, 'demo', 'screen-b')!,
        },
      ),
    ]);
    expect(a.status).toBe('updated');
    expect(b.status).toBe('updated');
  });
});
