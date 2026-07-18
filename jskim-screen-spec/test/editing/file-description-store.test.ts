import { describe, expect, it } from 'vitest';
import {
  createEmptyEditableDocument,
  toEditableDocument,
  validateEditableDescriptionDocument,
} from '../../src/editing/validate-description-document.js';
import {
  computeContentRevision,
  computeEmptyDescriptionRevision,
  writeFileAtomic,
} from '../../src/util/write-file-atomic.js';
import { createFileDescriptionStore } from '../../src/editing/file-description-store.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Description editing store', () => {
  it('editable document の基本検証に通る', () => {
    const doc = createEmptyEditableDocument('crud-create');
    doc.screen.name = '商品登録';
    doc.items = {
      'product-name': {
        name: '商品名',
        type: 'テキスト',
        description: '説明',
        note: '',
      },
    };
    doc.itemOrder = ['product-name'];
    expect(
      validateEditableDescriptionDocument({
        screenId: 'crud-create',
        document: doc,
        existing: null,
      }),
    ).toBeNull();
  });

  it('screenId 不一致を拒否する', () => {
    const doc = createEmptyEditableDocument('crud-create');
    doc.screen.id = 'other';
    const err = validateEditableDescriptionDocument({
      screenId: 'crud-create',
      document: doc,
      existing: null,
    });
    expect(err?.code).toBe('SPEC_DESCRIPTION_INVALID');
  });

  it('collected item ID の削除を拒否する', () => {
    const existing = {
      schemaVersion: '1.2',
      screen: { id: 'crud-create', name: 'A', description: '' },
      itemOrder: ['a', 'manual'],
      excludedItems: {},
      items: {
        a: { name: 'A', type: '', description: '', note: '' },
        manual: { name: 'M', type: '', description: '', note: '' },
      },
    };
    const doc = toEditableDocument(existing);
    delete doc.items.a;
    doc.itemOrder = ['manual'];
    const err = validateEditableDescriptionDocument({
      screenId: 'crud-create',
      document: doc,
      existing,
      requiredItemIds: ['a'],
    });
    expect(err?.code).toBe(
      'SPEC_DESCRIPTION_COLLECTED_ITEM_DELETE_NOT_ALLOWED',
    );
    expect(err?.message).toMatch(/実装画面と連携された項目は削除できません/);
  });

  it('collected item を excludedItems へ移す除外は許可する', () => {
    const existing = {
      schemaVersion: '1.2',
      screen: { id: 'crud-create', name: 'A', description: '' },
      itemOrder: ['a', 'manual'],
      excludedItems: {},
      items: {
        a: { name: 'A', type: 'text', description: '説明', note: '' },
        manual: { name: 'M', type: '', description: '', note: '' },
      },
    };
    const doc = toEditableDocument(existing);
    doc.excludedItems.a = doc.items.a;
    delete doc.items.a;
    doc.itemOrder = ['manual'];
    const err = validateEditableDescriptionDocument({
      screenId: 'crud-create',
      document: doc,
      existing,
      requiredItemIds: ['a'],
    });
    expect(err).toBeNull();
  });

  it('manual-only 項目の除外は拒否する', () => {
    const existing = {
      schemaVersion: '1.2',
      screen: { id: 'crud-create', name: 'A', description: '' },
      itemOrder: ['a', 'manual'],
      excludedItems: {},
      items: {
        a: { name: 'A', type: '', description: '', note: '' },
        manual: { name: 'M', type: '', description: '', note: '' },
      },
    };
    const doc = toEditableDocument(existing);
    doc.excludedItems.manual = doc.items.manual;
    delete doc.items.manual;
    doc.itemOrder = ['a'];
    const err = validateEditableDescriptionDocument({
      screenId: 'crud-create',
      document: doc,
      existing,
      requiredItemIds: ['a'],
    });
    expect(err?.code).toBe(
      'SPEC_DESCRIPTION_MANUAL_ITEM_EXCLUDE_NOT_ALLOWED',
    );
    expect(err?.message).toMatch(/実装画面と連携していない項目は設計対象から除外できません/);
  });

  it('除外 entry の直接削除は拒否する（復元してから削除）', () => {
    const existing = {
      schemaVersion: '1.2',
      screen: { id: 'crud-create', name: 'A', description: '' },
      itemOrder: ['a'],
      excludedItems: {
        layout: { name: '枠', type: '', description: '', note: '' },
      },
      items: {
        a: { name: 'A', type: '', description: '', note: '' },
      },
    };
    const doc = toEditableDocument(existing);
    delete doc.excludedItems.layout;
    const err = validateEditableDescriptionDocument({
      screenId: 'crud-create',
      document: doc,
      existing,
      requiredItemIds: ['a'],
    });
    expect(err?.code).toBe(
      'SPEC_DESCRIPTION_EXCLUDED_ITEM_REMOVE_NOT_ALLOWED',
    );
    expect(err?.message).toMatch(/除外した項目を直接削除できません/);
  });

  it('除外項目の復元（items へ戻す）は許可する', () => {
    const existing = {
      schemaVersion: '1.2',
      screen: { id: 'crud-create', name: 'A', description: '' },
      itemOrder: ['a'],
      excludedItems: {
        layout: { name: '枠', type: 'container', description: 'd', note: '' },
      },
      items: {
        a: { name: 'A', type: '', description: '', note: '' },
      },
    };
    const doc = toEditableDocument(existing);
    doc.items.layout = doc.excludedItems.layout;
    delete doc.excludedItems.layout;
    doc.itemOrder = ['a', 'layout'];
    const err = validateEditableDescriptionDocument({
      screenId: 'crud-create',
      document: doc,
      existing,
      requiredItemIds: ['a'],
    });
    expect(err).toBeNull();
  });

  it('items と excludedItems の重複は拒否する', () => {
    const doc = createEmptyEditableDocument('crud-create');
    doc.items = {
      a: { name: '', type: '', description: '', note: '' },
    };
    doc.excludedItems = {
      a: { name: '', type: '', description: '', note: '' },
    };
    doc.itemOrder = ['a'];
    const err = validateEditableDescriptionDocument({
      screenId: 'crud-create',
      document: doc,
      existing: null,
    });
    expect(err?.message).toMatch(/items と excludedItems/);
  });

  it('manual-only 項目の削除は許可する（collected に無い ID）', () => {
    const existing = {
      schemaVersion: '1.2',
      screen: { id: 'crud-create', name: 'A', description: '' },
      itemOrder: ['a', 'manual'],
      excludedItems: {},
      items: {
        a: { name: 'A', type: '', description: '', note: '' },
        manual: { name: 'M', type: '', description: '', note: '' },
      },
    };
    const doc = toEditableDocument(existing);
    delete doc.items.manual;
    doc.itemOrder = ['a'];
    const err = validateEditableDescriptionDocument({
      screenId: 'crud-create',
      document: doc,
      existing,
      requiredItemIds: ['a'],
    });
    expect(err).toBeNull();
  });

  it('既存 item ID を維持したまま新規 item ID の追加は許可する', () => {
    const existing = {
      schemaVersion: '1.2',
      screen: { id: 'crud-create', name: 'A', description: '' },
      itemOrder: ['a'],
      excludedItems: {},
      items: {
        a: { name: 'A', type: '', description: '', note: '' },
      },
    };
    const doc = toEditableDocument(existing);
    doc.items.b = { name: '', type: '', description: '', note: '' };
    doc.itemOrder = [...doc.itemOrder, 'b'];
    const err = validateEditableDescriptionDocument({
      screenId: 'crud-create',
      document: doc,
      existing,
    });
    expect(err).toBeNull();
  });

  it('itemOrder が items のキー集合と一致しない場合は拒否する', () => {
    const doc = createEmptyEditableDocument('crud-create');
    doc.items = {
      a: { name: '', type: '', description: '', note: '' },
    };
    doc.itemOrder = ['a', 'b'];
    const err = validateEditableDescriptionDocument({
      screenId: 'crud-create',
      document: doc,
      existing: null,
    });
    expect(err?.message).toMatch(/itemOrder/);
  });

  it('schemaVersion が 1.2 以外の場合は拒否する', () => {
    const doc = createEmptyEditableDocument('crud-create') as Record<
      string,
      unknown
    >;
    doc.schemaVersion = '1.1';
    const err = validateEditableDescriptionDocument({
      screenId: 'crud-create',
      document: doc,
      existing: null,
    });
    expect(err?.message).toMatch(/schemaVersion/);
  });

  it('toEditableDocument は 1.0/1.1 を 1.2 + excludedItems に正規化する（読込 rewrite ではない）', () => {
    const editable = toEditableDocument({
      schemaVersion: '1.0',
      screen: { id: 'demo', name: 'D', description: '' },
      items: {
        title: { name: 'T', type: '', description: '', note: '' },
      },
    });
    expect(editable.schemaVersion).toBe('1.2');
    expect(editable.excludedItems).toEqual({});
    expect(editable.itemOrder).toEqual(['title']);
  });

  it('revision が内容に応じて変わる', () => {
    const a = computeContentRevision('{"a":1}\n');
    const b = computeContentRevision('{"a":2}\n');
    expect(a.startsWith('sha256:')).toBe(true);
    expect(a).not.toBe(b);
  });

  it('atomic write と revision conflict を扱う', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-desc-store-'));
    try {
      const dataDir = path.join(root, 'spec', 'sample', 'src', 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      const filePath = path.join(dataDir, 'demo.json');
      const initial = `${JSON.stringify(
        {
          schemaVersion: '1.0',
          screen: { id: 'demo', name: 'Demo', description: '' },
          items: {
            title: { name: 'Title', type: 'text', description: '', note: '' },
          },
        },
        null,
        2,
      )}\n`;
      writeFileAtomic(filePath, initial);

      const store = createFileDescriptionStore({
        rootDir: root,
        projectName: 'sample',
        listScreenIds: () => ['demo'],
      });

      const read1 = store.read('demo');
      expect(read1.exists).toBe(true);

      // 元ファイルは 1.0（itemOrder 無し）。GET は 1.2 に正規化して返す（lazy migration）
      expect(read1.document.schemaVersion).toBe('1.2');
      expect(read1.document.itemOrder).toEqual(['title']);
      expect(read1.document.excludedItems).toEqual({});

      const next = structuredClone(read1.document);
      next.screen.description = '更新';
      const written = store.write('demo', next, read1.revision);
      expect(written.saved).toBe(true);
      expect(written.written).toBe(true);
      expect(written.revision).not.toBe(read1.revision);

      // 保存時に実ファイルも 1.2 へ upgrade される
      const savedRaw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(savedRaw.schemaVersion).toBe('1.2');
      expect(savedRaw.itemOrder).toEqual(['title']);
      expect(savedRaw.excludedItems).toEqual({});
      expect(savedRaw.$schema).toMatch(/v1\.2\.schema\.json$/);

      expect(() =>
        store.write('demo', next, read1.revision),
      ).toThrowError(/別の場所で変更/);

      const same = store.write('demo', store.read('demo').document, written.revision);
      expect(same.written).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('未登録 screen は 404', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-desc-404-'));
    try {
      const store = createFileDescriptionStore({
        rootDir: root,
        projectName: 'sample',
        listScreenIds: () => ['demo'],
      });
      expect(() => store.read('missing')).toThrowError(/登録されていません/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  describe('create()（design-only 新規作成）', () => {
    function makeStore(root: string, listScreenIds: () => string[] = () => []) {
      return createFileDescriptionStore({
        rootDir: root,
        projectName: 'sample',
        listScreenIds,
      });
    }

    it('screenId が listScreenIds に無くても新規作成できる', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-desc-create-'));
      try {
        const store = makeStore(root, () => []);
        const result = store.create({
          screenId: 'brand-new',
          name: '新規画面',
          description: '説明',
        });
        expect(result.created).toBe(true);
        expect(result.screenId).toBe('brand-new');
        expect(result.document.items).toEqual({});
        expect(result.document.screen.name).toBe('新規画面');

        const filePath = path.join(
          root,
          'spec',
          'sample',
          'src',
          'data',
          'brand-new.json',
        );
        const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        expect(saved.$schema).toMatch(/^https:\/\//);
        expect(saved.$schema).toMatch(/v1\.2\.schema\.json$/);
        expect(saved.schemaVersion).toBe('1.2');
        expect(saved.itemOrder).toEqual([]);
        expect(saved.excludedItems).toEqual({});
        expect(saved.screen).toEqual({
          id: 'brand-new',
          name: '新規画面',
          description: '説明',
        });
        expect(result.document.schemaVersion).toBe('1.2');
        expect(result.document.itemOrder).toEqual([]);
        expect(result.document.excludedItems).toEqual({});
        expect(result.revision).toBe(
          computeContentRevision(fs.readFileSync(filePath)),
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('既に Description が存在する場合は 409', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-desc-create-'));
      try {
        const store = makeStore(root, () => []);
        store.create({ screenId: 'dup', name: 'A', description: '' });
        expect(() =>
          store.create({ screenId: 'dup', name: 'B', description: '' }),
        ).toThrowError(/既に存在します/);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('IMPLEMENTATION_ONLY の screenId は snapshot の item を placeholder として seed する', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-desc-create-'));
      try {
        const snapDir = path.join(
          root,
          'spec',
          'sample',
          'src',
          'snapshots',
          'impl-only',
        );
        fs.mkdirSync(snapDir, { recursive: true });
        fs.writeFileSync(
          path.join(snapDir, 'default.html'),
          '<div data-jskim-spec-item="submit">送信</div>',
          'utf8',
        );

        const store = makeStore(root, () => ['impl-only']);
        const result = store.create({
          screenId: 'impl-only',
          name: '実装済み画面',
          description: '',
        });
        expect(result.document.items).toEqual({
          submit: { name: '', type: '', description: '', note: '' },
        });
        expect(result.document.itemOrder).toEqual(['submit']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('screenId の形式が不正・予約語の場合は 400', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-desc-create-'));
      try {
        const store = makeStore(root, () => []);
        expect(() =>
          store.create({ screenId: 'CON', name: 'A', description: '' }),
        ).toThrowError(/画面 ID/);
        expect(() =>
          store.create({ screenId: 'con', name: 'A', description: '' }),
        ).toThrowError(/画面 ID/);
        expect(() =>
          store.create({ screenId: '_empty', name: 'A', description: '' }),
        ).toThrowError(/画面 ID/);
        expect(() =>
          store.create({ screenId: 'Invalid_ID', name: 'A', description: '' }),
        ).toThrowError(/画面 ID/);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('name が空・過長の場合は 400', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-desc-create-'));
      try {
        const store = makeStore(root, () => []);
        expect(() =>
          store.create({ screenId: 'demo1', name: '   ', description: '' }),
        ).toThrowError(/name/);
        expect(() =>
          store.create({
            screenId: 'demo2',
            name: 'a'.repeat(201),
            description: '',
          }),
        ).toThrowError(/name/);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('IMPLEMENTATION_ONLY の GET/PUT draft', () => {
    function setupImplOnlyWorkspace(itemIds: string[]) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-desc-impl-'));
      const snapDir = path.join(
        root,
        'spec',
        'sample',
        'src',
        'snapshots',
        'impl-only',
      );
      fs.mkdirSync(snapDir, { recursive: true });
      const html = itemIds
        .map((id) => `<div data-jskim-spec-item="${id}">${id}</div>`)
        .join('');
      fs.writeFileSync(path.join(snapDir, 'default.html'), html, 'utf8');
      const store = createFileDescriptionStore({
        rootDir: root,
        projectName: 'sample',
        listScreenIds: () => ['impl-only'],
      });
      return { root, store };
    }

    it('GET は snapshot から集めた item を空欄で seed し revision もその内容に一致する', () => {
      const { root, store } = setupImplOnlyWorkspace(['title', 'submit']);
      try {
        const result = store.read('impl-only');
        expect(result.exists).toBe(false);
        expect(result.document.items).toEqual({
          title: { name: '', type: '', description: '', note: '' },
          submit: { name: '', type: '', description: '', note: '' },
        });
        expect(result.document.itemOrder).toEqual(['title', 'submit']);
        expect(result.document.schemaVersion).toBe('1.2');
        expect(result.document.excludedItems).toEqual({});
        expect(result.revision).not.toBe(
          computeEmptyDescriptionRevision('impl-only'),
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('item が無い場合は revision が empty document と一致する', () => {
      const { root, store } = setupImplOnlyWorkspace([]);
      try {
        const result = store.read('impl-only');
        expect(result.document.items).toEqual({});
        expect(result.revision).toBe(
          computeEmptyDescriptionRevision('impl-only'),
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('初回 PUT は collected item ID 集合と一致すれば保存できる', () => {
      const { root, store } = setupImplOnlyWorkspace(['title']);
      try {
        const before = store.read('impl-only');
        const next = structuredClone(before.document);
        next.screen.name = '画面名';
        next.items.title.name = 'タイトル';

        const written = store.write('impl-only', next, before.revision);
        expect(written.saved).toBe(true);
        expect(written.written).toBe(true);

        const after = store.read('impl-only');
        expect(after.exists).toBe(true);
        expect(after.document.screen.name).toBe('画面名');
        expect(after.document.items.title.name).toBe('タイトル');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('初回 PUT で collected item ID に加えて手動追加した項目も許可する（追加は許可）', () => {
      const { root, store } = setupImplOnlyWorkspace(['title']);
      try {
        const before = store.read('impl-only');
        const next = structuredClone(before.document);
        next.items['extra-item'] = {
          name: '',
          type: '',
          description: '',
          note: '',
        };
        next.itemOrder = [...next.itemOrder, 'extra-item'];

        const written = store.write('impl-only', next, before.revision);
        expect(written.saved).toBe(true);

        const after = store.read('impl-only');
        expect(after.document.items['extra-item']).toBeDefined();
        expect(after.document.itemOrder).toEqual(['title', 'extra-item']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('初回 PUT で collected item ID を削除すると 400（削除は拒否）', () => {
      const { root, store } = setupImplOnlyWorkspace(['title', 'submit']);
      try {
        const before = store.read('impl-only');
        const next = structuredClone(before.document);
        delete next.items.submit;
        next.itemOrder = next.itemOrder.filter(
          (id: string) => id !== 'submit',
        );

        expect(() => store.write('impl-only', next, before.revision)).toThrowError(
          /実装画面と連携された項目は削除できません/,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('保存後に manual-only 項目だけ削除できる（collected は維持）', () => {
      const { root, store } = setupImplOnlyWorkspace(['title']);
      try {
        const before = store.read('impl-only');
        expect(before.collectedItemIds).toEqual(['title']);
        const seeded = structuredClone(before.document);
        seeded.screen.name = '連携';
        seeded.items.extra = {
          name: '手動',
          type: 'text',
          description: '',
          note: '',
        };
        seeded.itemOrder = ['title', 'extra'];
        const written = store.write('impl-only', seeded, before.revision);
        expect(written.saved).toBe(true);

        const mid = store.read('impl-only');
        const removed = structuredClone(mid.document);
        delete removed.items.extra;
        removed.itemOrder = ['title'];
        const deleted = store.write('impl-only', removed, mid.revision);
        expect(deleted.saved).toBe(true);
        expect(store.read('impl-only').document.itemOrder).toEqual(['title']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('GET 後に snapshot へ同じ ID が追加されると削除 PUT は拒否する（race）', () => {
      const { root, store } = setupImplOnlyWorkspace([]);
      try {
        // Description だけ先に作る（manual-only）
        const dataDir = path.join(root, 'spec', 'sample', 'src', 'data');
        fs.mkdirSync(dataDir, { recursive: true });
        const filePath = path.join(dataDir, 'impl-only.json');
        fs.writeFileSync(
          filePath,
          `${JSON.stringify(
            {
              schemaVersion: '1.1',
              screen: { id: 'impl-only', name: 'race', description: '' },
              itemOrder: ['item-x'],
              items: {
                'item-x': {
                  name: 'X',
                  type: 'text',
                  description: '',
                  note: '',
                },
              },
            },
            null,
            2,
          )}\n`,
          'utf8',
        );

        const before = store.read('impl-only');
        expect(before.collectedItemIds).toEqual([]);

        const snapDir = path.join(
          root,
          'spec',
          'sample',
          'src',
          'snapshots',
          'impl-only',
        );
        fs.mkdirSync(snapDir, { recursive: true });
        fs.writeFileSync(
          path.join(snapDir, 'default.html'),
          '<div data-jskim-spec-item="item-x">x</div>\n',
          'utf8',
        );

        const removed = structuredClone(before.document);
        delete removed.items['item-x'];
        removed.itemOrder = [];
        expect(() =>
          store.write('impl-only', removed, before.revision),
        ).toThrowError(/実装画面と連携された項目は削除できません/);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('GET 時 collected → PUT 直前に snapshot から消えた項目の新規除外は拒否する（race）', () => {
      const { root, store } = setupImplOnlyWorkspace(['item-x']);
      try {
        const before = store.read('impl-only');
        expect(before.collectedItemIds).toEqual(['item-x']);
        const seeded = structuredClone(before.document);
        seeded.screen.name = '除外 race';
        const written = store.write('impl-only', seeded, before.revision);
        expect(written.saved).toBe(true);

        const snapPath = path.join(
          root,
          'spec',
          'sample',
          'src',
          'snapshots',
          'impl-only',
          'default.html',
        );
        fs.writeFileSync(snapPath, '<!-- empty -->\n', 'utf8');

        const mid = store.read('impl-only');
        expect(mid.collectedItemIds).toEqual([]);
        const excluded = structuredClone(mid.document);
        excluded.excludedItems['item-x'] = excluded.items['item-x'];
        delete excluded.items['item-x'];
        excluded.itemOrder = [];

        expect(() =>
          store.write('impl-only', excluded, mid.revision),
        ).toThrowError(/実装画面と連携していない項目は設計対象から除外できません/);

        const saved = JSON.parse(
          fs.readFileSync(
            path.join(root, 'spec', 'sample', 'src', 'data', 'impl-only.json'),
            'utf8',
          ),
        );
        expect(saved.items['item-x']).toBeTruthy();
        expect(saved.excludedItems || {}).toEqual({});
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
