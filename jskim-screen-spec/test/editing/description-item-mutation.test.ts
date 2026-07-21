import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DescriptionDocumentError,
  createDescriptionItem,
  flattenItemTree,
  readDescriptionRevision,
  readDescriptionTreeState,
  updateDescriptionItem,
} from '../../src/editing/description-document/index.js';
import { resetDescriptionScreenLocksForTest } from '../../src/editing/description-screen-lock.js';
import {
  computeContentRevision,
  writeFileAtomic,
  type WriteFileAtomicFs,
} from '../../src/util/write-file-atomic.js';
import { isValidItemId } from '../../src/util/screen-id.js';

const temps: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-desc-item-'));
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

function itemFields(overrides: Record<string, string> = {}) {
  return { ...emptyItem(), ...overrides };
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

function countItemRefs(saved: Record<string, unknown>, itemId: string): number {
  let count = 0;
  const visit = (nodes: unknown) => {
    if (!Array.isArray(nodes)) {
      return;
    }
    for (const node of nodes) {
      if (
        node &&
        typeof node === 'object' &&
        (node as { type?: string; id?: string }).type === 'item' &&
        (node as { id?: string }).id === itemId
      ) {
        count += 1;
      }
      if (
        node &&
        typeof node === 'object' &&
        (node as { type?: string; children?: unknown[] }).type === 'group'
      ) {
        visit((node as { children?: unknown[] }).children);
      }
    }
  };
  visit(saved.rootNodes);
  for (const group of (saved.groups as Array<{ children?: unknown[] }>) || []) {
    visit(group.children);
  }
  return count;
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

describe('Description item mutation', () => {
  it('updateItem は v1.3 active Item metadata を変更し tree 位置を維持する', async () => {
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
          children: [{ type: 'item', id: 'item-a' }],
        },
      ],
      items: { 'item-a': itemFields({ name: 'Old', type: 'text' }) },
      excludedItems: {},
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    const result = await updateDescriptionItem(ctx(root), {
      itemId: 'item-a',
      name: 'New',
      description: 'desc',
      expectedRevision: revision,
    });
    expect(result.status).toBe('updated');
    const saved = readSaved(root);
    expect(saved.schemaVersion).toBe('1.3');
    expect((saved.items as Record<string, unknown>)['item-a']).toMatchObject({
      name: 'New',
      type: 'text',
      description: 'desc',
    });
    expect(saved.rootNodes).toEqual([{ type: 'group', id: 'section' }]);
    expect(
      (saved.groups as Array<{ children: unknown[] }>)[0].children,
    ).toEqual([{ type: 'item', id: 'item-a' }]);
  });

  it('updateItem partial PATCH は未指定 field を維持する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'item', id: 'item-a' }],
      groups: [],
      items: {
        'item-a': itemFields({
          name: 'Name',
          type: 'text',
          description: 'Desc',
          note: 'Note',
        }),
      },
      excludedItems: {},
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await updateDescriptionItem(ctx(root), {
      itemId: 'item-a',
      name: 'Changed',
      expectedRevision: revision,
    });
    const item = (readSaved(root).items as Record<string, Record<string, string>>)[
      'item-a'
    ];
    expect(item.name).toBe('Changed');
    expect(item.type).toBe('text');
    expect(item.description).toBe('Desc');
    expect(item.note).toBe('Note');
  });

  it('updateItem 同一値は unchanged で bytes/mtime/revision を維持する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'item', id: 'item-a' }],
      groups: [],
      items: { 'item-a': itemFields({ name: 'Same', type: 'text' }) },
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
    const before = fs.readFileSync(filePath);
    const mtime = fs.statSync(filePath).mtimeMs;
    const result = await updateDescriptionItem(ctx(root), {
      itemId: 'item-a',
      name: 'Same',
      expectedRevision: revision,
    });
    expect(result.status).toBe('unchanged');
    expect(result.revision).toBe(revision);
    expect(fs.readFileSync(filePath)).toEqual(before);
    expect(fs.statSync(filePath).mtimeMs).toBe(mtime);
  });

  it('updateItem は Group ID / excluded / unknown / empty patch / unknown field / null を拒否する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [
        { type: 'group', id: 'section' },
        { type: 'item', id: 'item-a' },
      ],
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
        updateDescriptionItem(ctx(root), {
          itemId: 'section',
          name: 'X',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_NODE_NOT_FOUND',
    );
    await expectDocErrorCode(
      () =>
        updateDescriptionItem(ctx(root), {
          itemId: 'excluded-a',
          name: 'X',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_NODE_NOT_FOUND',
    );
    await expectDocErrorCode(
      () =>
        updateDescriptionItem(ctx(root), {
          itemId: 'missing',
          name: 'X',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_NODE_NOT_FOUND',
    );
    await expectDocErrorCode(
      () =>
        updateDescriptionItem(ctx(root), {
          itemId: 'item-a',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_INVALID',
    );
    await expectDocErrorCode(
      () =>
        updateDescriptionItem(ctx(root), {
          itemId: 'item-a',
          name: 'X',
          force: true,
          expectedRevision: revision,
        } as never),
      'SPEC_DESCRIPTION_INVALID',
    );
    await expectDocErrorCode(
      () =>
        updateDescriptionItem(ctx(root), {
          itemId: 'item-a',
          description: null as unknown as string,
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_INVALID',
    );
  });

  it('createItem は root / Group tail / insertIndex / 空 tree を配置できる', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
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
      excludedItems: {},
    });
    let revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await createDescriptionItem(ctx(root), {
      itemId: 'manual-tail',
      name: 'Tail',
      type: 'text',
      description: '',
      note: '',
      expectedRevision: revision,
    });
    let saved = readSaved(root);
    expect(saved.rootNodes).toEqual([
      { type: 'item', id: 'item-a' },
      { type: 'group', id: 'section' },
      { type: 'item', id: 'manual-tail' },
    ]);
    expect(countItemRefs(saved, 'manual-tail')).toBe(1);

    revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await createDescriptionItem(ctx(root), {
      itemId: 'manual-head',
      name: 'Head',
      type: 'text',
      description: '',
      note: '',
      insertIndex: 0,
      expectedRevision: revision,
    });
    saved = readSaved(root);
    expect((saved.rootNodes as unknown[])[0]).toEqual({
      type: 'item',
      id: 'manual-head',
    });

    revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await createDescriptionItem(ctx(root), {
      itemId: 'group-middle',
      name: 'Middle',
      type: 'text',
      description: '',
      note: '',
      parentGroupId: 'section',
      insertIndex: 1,
      expectedRevision: revision,
    });
    saved = readSaved(root);
    const section = (
      saved.groups as Array<{ groupId: string; children: unknown[] }>
    ).find((g) => g.groupId === 'section');
    expect(section?.children).toEqual([
      { type: 'item', id: 'item-b' },
      { type: 'item', id: 'group-middle' },
    ]);

    const emptyRoot = tempRoot();
    writeDescriptionFile(emptyRoot, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [],
      groups: [],
      items: {},
      excludedItems: {},
    });
    revision = readDescriptionRevision(emptyRoot, 'demo', 'demo-screen')!;
    await createDescriptionItem(ctx(emptyRoot), {
      itemId: 'only-item',
      name: 'Only',
      type: 'text',
      description: '',
      note: '',
      expectedRevision: revision,
    });
    expect(readSaved(emptyRoot).rootNodes).toEqual([
      { type: 'item', id: 'only-item' },
    ]);
  });

  it('createItem は ID 衝突 / invalid itemId / unknown parent / Item parent / insertIndex を拒否する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [
        { type: 'group', id: 'section' },
        { type: 'item', id: 'item-a' },
      ],
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
    const base = {
      name: 'X',
      type: 'text',
      description: '',
      note: '',
      expectedRevision: revision,
    };
    await expectDocErrorCode(
      () =>
        createDescriptionItem(ctx(root), {
          ...base,
          itemId: 'item-a',
        }),
      'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
    );
    await expectDocErrorCode(
      () =>
        createDescriptionItem(ctx(root), {
          ...base,
          itemId: 'excluded-a',
        }),
      'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
    );
    await expectDocErrorCode(
      () =>
        createDescriptionItem(ctx(root), {
          ...base,
          itemId: 'section',
        }),
      'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
    );
    await expectDocErrorCode(
      () =>
        createDescriptionItem(ctx(root), {
          ...base,
          itemId: 'Bad ID',
        }),
      'SPEC_DESCRIPTION_INVALID',
    );
    await expectDocErrorCode(
      () =>
        createDescriptionItem(ctx(root), {
          ...base,
          itemId: 'ghost-parent',
          parentGroupId: 'ghost',
        }),
      'SPEC_DESCRIPTION_GROUP_PARENT_NOT_FOUND',
    );
    await expectDocErrorCode(
      () =>
        createDescriptionItem(ctx(root), {
          ...base,
          itemId: 'child-of-item',
          parentGroupId: 'item-a',
        }),
      'SPEC_DESCRIPTION_GROUP_PARENT_NOT_FOUND',
    );
    for (const [itemId, insertIndex] of [
      ['bad-index-negative', -1],
      ['bad-index-fraction', 1.5],
      ['bad-index-range', 99],
    ] as const) {
      await expectDocErrorCode(
        () =>
          createDescriptionItem(ctx(root), {
            ...base,
            itemId,
            insertIndex,
          }),
        'SPEC_DESCRIPTION_ITEM_INSERT_INDEX_INVALID',
      );
    }
    await expectDocErrorCode(
      () =>
        createDescriptionItem(ctx(root), {
          ...base,
          itemId: 'bad-index-string',
          insertIndex: '0' as unknown as number,
        }),
      'SPEC_DESCRIPTION_ITEM_INSERT_INDEX_INVALID',
    );
  });

  it('createItem は definition と tree ref を同時に作成する', async () => {
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
    await createDescriptionItem(ctx(root), {
      itemId: 'manual-note',
      name: '備考',
      type: 'text',
      description: '',
      note: '',
      expectedRevision: revision,
    });
    const saved = readSaved(root);
    expect(saved.items).toHaveProperty('manual-note');
    expect(countItemRefs(saved, 'manual-note')).toBe(1);
  });

  it('schema migration: v1.0/v1.1/v1.2 update 実変更は v1.3、v1.2 unchanged は不変', async () => {
    const v10 = tempRoot();
    writeDescriptionFile(v10, {
      schemaVersion: '1.0',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      items: { 'item-a': itemFields({ name: 'A' }) },
    });
    let revision = readDescriptionRevision(v10, 'demo', 'demo-screen')!;
    await updateDescriptionItem(ctx(v10), {
      itemId: 'item-a',
      name: 'Changed',
      expectedRevision: revision,
    });
    expect(readSaved(v10).schemaVersion).toBe('1.3');

    const v11 = tempRoot();
    writeDescriptionFile(v11, {
      schemaVersion: '1.1',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      itemOrder: ['item-a'],
      items: { 'item-a': itemFields({ name: 'A' }) },
    });
    revision = readDescriptionRevision(v11, 'demo', 'demo-screen')!;
    await updateDescriptionItem(ctx(v11), {
      itemId: 'item-a',
      name: 'Changed',
      expectedRevision: revision,
    });
    expect(readSaved(v11).schemaVersion).toBe('1.3');

    const v12 = tempRoot();
    const original = writeDescriptionFile(v12, {
      schemaVersion: '1.2',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      itemOrder: ['item-a'],
      items: { 'item-a': itemFields({ name: 'Same' }) },
      excludedItems: {},
    });
    revision = readDescriptionRevision(v12, 'demo', 'demo-screen')!;
    const unchanged = await updateDescriptionItem(ctx(v12), {
      itemId: 'item-a',
      name: 'Same',
      expectedRevision: revision,
    });
    expect(unchanged.status).toBe('unchanged');
    expect(readSaved(v12).schemaVersion).toBe('1.2');
    expect(
      fs.readFileSync(
        path.join(v12, 'spec', 'demo', 'src', 'data', 'demo-screen.json'),
        'utf8',
      ),
    ).toBe(original);
  });

  it('schema migration: v1.0/v1.1/v1.2 create は v1.3', async () => {
    for (const schemaVersion of ['1.0', '1.1', '1.2'] as const) {
      const root = tempRoot();
      const doc: Record<string, unknown> = {
        schemaVersion,
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        items: { 'item-a': emptyItem() },
      };
      if (schemaVersion !== '1.0') {
        doc.itemOrder = ['item-a'];
      }
      if (schemaVersion === '1.2') {
        doc.excludedItems = {};
      }
      writeDescriptionFile(root, doc);
      const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
      await createDescriptionItem(ctx(root), {
        itemId: 'manual-new',
        name: 'New',
        type: 'text',
        description: '',
        note: '',
        expectedRevision: revision,
      });
      expect(readSaved(root).schemaVersion).toBe('1.3');
    }
  });

  it('v1.3 Group 構造を持つ document update で Group/rootNodes を維持する', async () => {
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
          children: [{ type: 'item', id: 'item-a' }],
        },
      ],
      items: { 'item-a': itemFields({ name: 'Old' }) },
      excludedItems: {},
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await updateDescriptionItem(ctx(root), {
      itemId: 'item-a',
      name: 'New',
      expectedRevision: revision,
    });
    const saved = readSaved(root);
    expect(saved.rootNodes).toEqual([{ type: 'group', id: 'section' }]);
    expect(
      (saved.groups as Array<{ groupId: string; children: unknown[] }>)[0],
    ).toMatchObject({
      groupId: 'section',
      children: [{ type: 'item', id: 'item-a' }],
    });
  });

  it('未対応 schema は変更せず fail-closed する', async () => {
    const root = tempRoot();
    const original = writeDescriptionFile(root, {
      schemaVersion: '9.9',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      items: { 'item-a': emptyItem() },
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await expectDocErrorCode(
      () =>
        updateDescriptionItem(ctx(root), {
          itemId: 'item-a',
          name: 'X',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_INVALID',
    );
    expect(
      fs.readFileSync(
        path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json'),
        'utf8',
      ),
    ).toBe(original);
  });

  it('stale revision / persist 失敗 / 並行同一 revision を処理する', async () => {
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
        createDescriptionItem(ctx(root), {
          itemId: 'manual-a',
          name: 'A',
          type: 'text',
          description: '',
          note: '',
          expectedRevision: 'sha256:deadbeef',
        }),
      'SPEC_DESCRIPTION_REVISION_CONFLICT',
    );

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
      createDescriptionItem(ctx(root), {
        itemId: 'manual-fail',
        name: 'Fail',
        type: 'text',
        description: '',
        note: '',
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
    expect(countItemRefs(readSaved(root), 'manual-fail')).toBe(0);
    expect(readSaved(root).items).not.toHaveProperty('manual-fail');

    const raceRoot = tempRoot();
    writeDescriptionFile(raceRoot, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [],
      groups: [],
      items: {},
      excludedItems: {},
    });
    const raceRevision = readDescriptionRevision(raceRoot, 'demo', 'demo-screen')!;
    const results = await Promise.allSettled([
      createDescriptionItem(ctx(raceRoot), {
        itemId: 'race-a',
        name: 'A',
        type: 'text',
        description: '',
        note: '',
        expectedRevision: raceRevision,
      }),
      createDescriptionItem(ctx(raceRoot), {
        itemId: 'race-b',
        name: 'B',
        type: 'text',
        description: '',
        note: '',
        expectedRevision: raceRevision,
      }),
    ]);
    const codes = results.map((result) =>
      result.status === 'fulfilled' ? 'ok' : docErrorCode(result.reason),
    );
    expect(codes.filter((c) => c === 'ok')).toHaveLength(1);
    expect(codes.filter((c) => c === 'SPEC_DESCRIPTION_REVISION_CONFLICT')).toHaveLength(
      1,
    );
  });

  it('create 後 flatten 順序は tree 配置を反映する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.1',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      itemOrder: ['item-a'],
      items: { 'item-a': emptyItem() },
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await createDescriptionItem(ctx(root), {
      itemId: 'manual-head',
      name: 'Head',
      type: 'text',
      description: '',
      note: '',
      insertIndex: 0,
      expectedRevision: revision,
    });
    const saved = readSaved(root);
    const state = readDescriptionTreeState(ctx(root));
    expect(state).not.toHaveProperty('error');
    if ('error' in state) {
      return;
    }
    expect(flattenItemTree(state.normalized)).toEqual(['manual-head', 'item-a']);
    expect(computeContentRevision(JSON.stringify(saved))).toMatch(/^sha256:/);
  });
});

describe('4B follow-up coverage', () => {
  for (const schemaVersion of ['1.0', '1.1'] as const) {
    it(`${schemaVersion} updateItem unchanged は bytes/mtime/revision/schema を維持する`, async () => {
      const root = tempRoot();
      const doc: Record<string, unknown> = {
        schemaVersion,
        screen: { id: 'demo-screen', name: 'Demo', description: '' },
        items: { 'item-a': itemFields({ name: 'Same' }) },
      };
      if (schemaVersion === '1.1') {
        doc.itemOrder = ['item-a'];
      }
      const original = writeDescriptionFile(root, doc);
      const filePath = path.join(
        root,
        'spec',
        'demo',
        'src',
        'data',
        'demo-screen.json',
      );
      const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
      const mtime = fs.statSync(filePath).mtimeMs;
      const result = await updateDescriptionItem(ctx(root), {
        itemId: 'item-a',
        name: 'Same',
        expectedRevision: revision,
      });
      expect(result.status).toBe('unchanged');
      expect(result.revision).toBe(revision);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(original);
      expect(fs.statSync(filePath).mtimeMs).toBe(mtime);
      expect(readSaved(root).schemaVersion).toBe(schemaVersion);
    });
  }

  it('createItem root middle insertIndex を配置する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [
        { type: 'item', id: 'item-a' },
        { type: 'item', id: 'item-c' },
      ],
      groups: [],
      items: {
        'item-a': emptyItem(),
        'item-c': emptyItem(),
      },
      excludedItems: {},
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await createDescriptionItem(ctx(root), {
      itemId: 'item-b',
      name: 'B',
      type: 'text',
      description: '',
      note: '',
      insertIndex: 1,
      expectedRevision: revision,
    });
    expect(readSaved(root).rootNodes).toEqual([
      { type: 'item', id: 'item-a' },
      { type: 'item', id: 'item-b' },
      { type: 'item', id: 'item-c' },
    ]);
  });

  it('createItem empty Group tail / index 0 を配置する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'group', id: 'section' }],
      groups: [
        {
          groupId: 'section',
          name: 'S',
          kind: 'SECTION',
          children: [],
        },
      ],
      items: {},
      excludedItems: {},
    });
    let revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await createDescriptionItem(ctx(root), {
      itemId: 'group-tail',
      name: 'Tail',
      type: 'text',
      description: '',
      note: '',
      parentGroupId: 'section',
      expectedRevision: revision,
    });
    let section = (
      readSaved(root).groups as Array<{ children: unknown[] }>
    )[0];
    expect(section.children).toEqual([{ type: 'item', id: 'group-tail' }]);

    revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await createDescriptionItem(ctx(root), {
      itemId: 'group-head',
      name: 'Head',
      type: 'text',
      description: '',
      note: '',
      parentGroupId: 'section',
      insertIndex: 0,
      expectedRevision: revision,
    });
    section = (readSaved(root).groups as Array<{ children: unknown[] }>)[0];
    expect(section.children).toEqual([
      { type: 'item', id: 'group-head' },
      { type: 'item', id: 'group-tail' },
    ]);
  });

  it('kebab-case 以外の itemId は validator で拒否される', () => {
    expect(isValidItemId('UPPER-case')).toBe(false);
  });
});
