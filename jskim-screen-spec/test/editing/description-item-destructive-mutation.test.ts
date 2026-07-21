import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isValidItemId } from '../../src/util/screen-id.js';
import {
  collectCollectedItemIdsForDestructiveMutation,
  collectCollectedItemIdsForScreen,
} from '../../src/editing/collect-collected-item-ids.js';
import {
  DescriptionDocumentError,
  applyDeleteItem,
  applyExcludeItem,
  applyRestoreItem,
  deleteDescriptionItem,
  excludeDescriptionItem,
  readDescriptionRevision,
  restoreDescriptionItem,
  type NormalizedDescription,
} from '../../src/editing/description-document/index.js';
import { resetDescriptionScreenLocksForTest } from '../../src/editing/description-screen-lock.js';
import {
  writeFileAtomic,
  type WriteFileAtomicFs,
} from '../../src/util/write-file-atomic.js';

const temps: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-desc-item-life-'));
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

function createMemoryFs(initial: Record<string, Buffer> = {}) {
  const files = new Map<string, Buffer>(
    Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)]),
  );
  const failOn = { writeFileSync: null as null | Error };

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

describe('collected Item 判定', () => {
  it('snapshot HTML から collected ID を収集する', () => {
    const root = tempRoot();
    writeSnapshot(
      root,
      '<div data-jskim-spec-item="item-a"></div><div data-jskim-spec-item="item-b"></div>',
    );
    expect(collectCollectedItemIdsForScreen(ctx(root))).toEqual(['item-a', 'item-b']);
  });

  it('snapshot 無しは通常収集で空配列、destructive では fail-closed', () => {
    const root = tempRoot();
    expect(collectCollectedItemIdsForScreen(ctx(root))).toEqual([]);
    expect(() => collectCollectedItemIdsForDestructiveMutation(ctx(root))).toThrow(
      expect.objectContaining({ code: 'SPEC_DESCRIPTION_COLLECTED_STATE_UNAVAILABLE' }),
    );
  });

  it('snapshot ディレクトリはあるが HTML が無い場合も destructive では fail-closed', () => {
    const root = tempRoot();
    fs.mkdirSync(
      path.join(root, 'spec', 'demo', 'src', 'snapshots', 'demo-screen'),
      { recursive: true },
    );
    expect(() => collectCollectedItemIdsForDestructiveMutation(ctx(root))).toThrow(
      expect.objectContaining({ code: 'SPEC_DESCRIPTION_COLLECTED_STATE_UNAVAILABLE' }),
    );
  });
});

describe('deleteItem domain', () => {
  it('manual root / Group child を削除し空 Group を維持する', async () => {
    const root = tempRoot();
    writeSnapshot(root, '<div data-jskim-spec-item="collected-a"></div>');
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [
        { type: 'item', id: 'manual-root' },
        { type: 'group', id: 'section' },
      ],
      groups: [
        {
          groupId: 'section',
          name: 'S',
          kind: 'SECTION',
          children: [{ type: 'item', id: 'manual-child' }],
        },
      ],
      items: {
        'manual-root': emptyItem(),
        'manual-child': emptyItem(),
      },
      excludedItems: {},
    });
    let revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await deleteDescriptionItem(ctx(root), {
      itemId: 'manual-root',
      expectedRevision: revision,
    });
    let saved = readSaved(root);
    expect(saved.rootNodes).toEqual([{ type: 'group', id: 'section' }]);
    expect(saved.items).not.toHaveProperty('manual-root');

    revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await deleteDescriptionItem(ctx(root), {
      itemId: 'manual-child',
      expectedRevision: revision,
    });
    saved = readSaved(root);
    expect(
      (saved.groups as Array<{ children: unknown[] }>)[0].children,
    ).toEqual([]);
    expect(saved.items).not.toHaveProperty('manual-child');
  });

  it('collected / excluded / unknown / Group ID を拒否する', async () => {
    const root = tempRoot();
    writeSnapshot(root, '<div data-jskim-spec-item="collected-a"></div>');
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [
        { type: 'item', id: 'manual-a' },
        { type: 'item', id: 'collected-a' },
        { type: 'group', id: 'section' },
      ],
      groups: [
        {
          groupId: 'section',
          name: 'S',
          kind: 'SECTION',
          children: [],
        },
      ],
      items: {
        'manual-a': emptyItem(),
        'collected-a': emptyItem(),
      },
      excludedItems: { 'excluded-a': emptyItem() },
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await expectDocErrorCode(
      () =>
        deleteDescriptionItem(ctx(root), {
          itemId: 'collected-a',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_COLLECTED_ITEM_DELETE_NOT_ALLOWED',
    );
    await expectDocErrorCode(
      () =>
        deleteDescriptionItem(ctx(root), {
          itemId: 'excluded-a',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_NODE_NOT_FOUND',
    );
    await expectDocErrorCode(
      () =>
        deleteDescriptionItem(ctx(root), {
          itemId: 'missing',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_NODE_NOT_FOUND',
    );
    await expectDocErrorCode(
      () =>
        deleteDescriptionItem(ctx(root), {
          itemId: 'section',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_NODE_NOT_FOUND',
    );
  });

  it('snapshot 無し delete は fail-closed で bytes 不変', async () => {
    const root = tempRoot();
    const original = writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'item', id: 'manual-a' }],
      groups: [],
      items: { 'manual-a': emptyItem() },
      excludedItems: {},
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await expectDocErrorCode(
      () =>
        deleteDescriptionItem(ctx(root), {
          itemId: 'manual-a',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_COLLECTED_STATE_UNAVAILABLE',
    );
    expect(
      fs.readFileSync(
        path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json'),
        'utf8',
      ),
    ).toBe(original);
  });

  it('applyDeleteItem は入力 normalized を mutate しない', () => {
    const normalized = {
      sourceSchemaVersion: '1.3' as const,
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'item' as const, id: 'manual-a' }],
      groups: [] as [],
      items: { 'manual-a': emptyItem() },
      excludedItems: {},
    };
    const snapshot = JSON.stringify(normalized);
    applyDeleteItem(normalized, { itemId: 'manual-a' }, []);
    expect(JSON.stringify(normalized)).toBe(snapshot);
  });

  it('persist 失敗時は bytes を維持する', async () => {
    const root = tempRoot();
    writeSnapshot(root, '');
    const original = writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'item', id: 'manual-a' }],
      groups: [],
      items: { 'manual-a': emptyItem() },
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
      deleteDescriptionItem(ctx(root), {
        itemId: 'manual-a',
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
});

describe('excludeItem domain', () => {
  it('collected Item を excludedItems へ移動する', async () => {
    const root = tempRoot();
    writeSnapshot(root, '<div data-jskim-spec-item="collected-a"></div>');
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'item', id: 'collected-a' }],
      groups: [],
      items: {
        'collected-a': itemFields({ name: 'A', type: 'text', description: 'd', note: 'n' }),
      },
      excludedItems: {},
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await excludeDescriptionItem(ctx(root), {
      itemId: 'collected-a',
      expectedRevision: revision,
    });
    const saved = readSaved(root);
    expect(saved.rootNodes).toEqual([]);
    expect(saved.items).not.toHaveProperty('collected-a');
    expect(
      (saved.excludedItems as Record<string, Record<string, string>>)['collected-a'],
    ).toMatchObject({ name: 'A', type: 'text', description: 'd', note: 'n' });
  });

  it('manual Item exclude を拒否する', async () => {
    const root = tempRoot();
    writeSnapshot(root, '');
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'item', id: 'manual-a' }],
      groups: [],
      items: { 'manual-a': emptyItem() },
      excludedItems: {},
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await expectDocErrorCode(
      () =>
        excludeDescriptionItem(ctx(root), {
          itemId: 'manual-a',
          expectedRevision: revision,
        }),
      'SPEC_DESCRIPTION_MANUAL_ITEM_EXCLUDE_NOT_ALLOWED',
    );
  });
});

describe('restoreItem domain', () => {
  it('excluded Item を root tail に復元し snapshot 無しでも成功する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'item', id: 'item-a' }],
      groups: [],
      items: { 'item-a': emptyItem() },
      excludedItems: {
        'restored-a': itemFields({ name: 'R', type: 'text' }),
      },
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await restoreDescriptionItem(ctx(root), {
      itemId: 'restored-a',
      expectedRevision: revision,
    });
    const saved = readSaved(root);
    expect(saved.rootNodes).toEqual([
      { type: 'item', id: 'item-a' },
      { type: 'item', id: 'restored-a' },
    ]);
    expect(saved.items).toHaveProperty('restored-a');
    expect(saved.excludedItems).not.toHaveProperty('restored-a');
  });

  it('active / Group / tree ref 衝突を拒否する', () => {
    const normalized: NormalizedDescription = {
      sourceSchemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [{ type: 'item', id: 'active-a' }],
      groups: [{ groupId: 'section', name: 'S', kind: 'SECTION', children: [] }],
      items: { 'active-a': emptyItem() },
      excludedItems: {
        'dup-active': emptyItem(),
        section: emptyItem(),
        'tree-dup': emptyItem(),
      },
    };

    expectDocErrorCode(
      () =>
        applyRestoreItem(
          {
            ...normalized,
            items: { ...normalized.items, 'dup-active': emptyItem() },
          },
          { itemId: 'dup-active' },
        ),
      'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
    );
    expectDocErrorCode(
      () => applyRestoreItem(normalized, { itemId: 'section' }),
      'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
    );
    expectDocErrorCode(
      () =>
        applyRestoreItem(
          {
            ...normalized,
            rootNodes: [
              ...normalized.rootNodes,
              { type: 'item', id: 'tree-dup' },
            ],
          },
          { itemId: 'tree-dup' },
        ),
      'SPEC_DESCRIPTION_NODE_ID_CONFLICT',
    );
    expectDocErrorCode(
      () => applyRestoreItem(normalized, { itemId: 'missing' }),
      'SPEC_DESCRIPTION_NODE_NOT_FOUND',
    );
  });
});

describe('destructive Item mutation lazy migration', () => {
  it('v1.2 delete で v1.3 に migration する', async () => {
    const root = tempRoot();
    writeSnapshot(root, '');
    writeDescriptionFile(root, {
      schemaVersion: '1.2',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      itemOrder: ['manual-a', 'item-b'],
      items: { 'manual-a': emptyItem(), 'item-b': emptyItem() },
      excludedItems: {},
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await deleteDescriptionItem(ctx(root), {
      itemId: 'manual-a',
      expectedRevision: revision,
    });
    const saved = readSaved(root);
    expect(saved.schemaVersion).toBe('1.3');
    expect(saved.itemOrder).toBeUndefined();
    expect(saved.rootNodes).toEqual([{ type: 'item', id: 'item-b' }]);
  });
});

describe('deleteItem concurrency', () => {
  it('同一 revision の並行 delete は 1 成功 1 conflict', async () => {
    const root = tempRoot();
    writeSnapshot(root, '');
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [
        { type: 'item', id: 'manual-a' },
        { type: 'item', id: 'manual-b' },
      ],
      groups: [],
      items: { 'manual-a': emptyItem(), 'manual-b': emptyItem() },
      excludedItems: {},
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    const results = await Promise.allSettled([
      deleteDescriptionItem(ctx(root), {
        itemId: 'manual-a',
        expectedRevision: revision,
      }),
      deleteDescriptionItem(ctx(root), {
        itemId: 'manual-b',
        expectedRevision: revision,
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
});

describe('Item ID namespace', () => {
  it('kebab-case 以外は invalid で NFC/case-fold collision は構造的に不可', () => {
    expect(isValidItemId('valid-item')).toBe(true);
    expect(isValidItemId('Invalid-Item')).toBe(false);
    expect(isValidItemId('UPPER-case')).toBe(false);
    expect(isValidItemId('valid-item')).toBe(isValidItemId('valid-item'.normalize('NFC')));
  });
});
