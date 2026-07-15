import { describe, expect, it } from 'vitest';
import {
  createEmptyEditableDocument,
  toEditableDocument,
  validateEditableDescriptionDocument,
} from '../../src/editing/validate-description-document.js';
import {
  computeContentRevision,
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
});
