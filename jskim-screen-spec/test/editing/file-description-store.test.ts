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

  it('既存 item ID の変更を拒否する', () => {
    const existing = {
      schemaVersion: '1.0',
      screen: { id: 'crud-create', name: 'A', description: '' },
      items: {
        a: { name: 'A', type: '', description: '', note: '' },
      },
    };
    const doc = toEditableDocument(existing);
    doc.items = {
      b: { name: 'B', type: '', description: '', note: '' },
    };
    const err = validateEditableDescriptionDocument({
      screenId: 'crud-create',
      document: doc,
      existing,
    });
    expect(err?.message).toMatch(/item ID/);
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

      const next = structuredClone(read1.document);
      next.screen.description = '更新';
      const written = store.write('demo', next, read1.revision);
      expect(written.saved).toBe(true);
      expect(written.written).toBe(true);
      expect(written.revision).not.toBe(read1.revision);

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
        expect(saved.schemaVersion).toBe('1.0');
        expect(saved.screen).toEqual({
          id: 'brand-new',
          name: '新規画面',
          description: '説明',
        });
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

    it('初回 PUT で item ID 集合が collected と不一致なら 400', () => {
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

        expect(() => store.write('impl-only', next, before.revision)).toThrowError(
          /項目 ID/,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
