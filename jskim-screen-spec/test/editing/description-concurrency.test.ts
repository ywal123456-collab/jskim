import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileDescriptionStore } from '../../src/editing/file-description-store.js';
import { writeCollectedDescription } from '../../src/collector/write-collected-description.js';
import {
  computeContentRevision,
  writeFileAtomic,
  type WriteFileAtomicResult,
} from '../../src/util/write-file-atomic.js';

function makeDesc(overrides: {
  screenId: string;
  name?: string;
  description?: string;
  items?: Record<
    string,
    { name: string; type: string; description: string; note: string }
  >;
}) {
  return {
    schemaVersion: '1.0',
    screen: {
      id: overrides.screenId,
      name: overrides.name ?? 'Name',
      description: overrides.description ?? '',
    },
    items: overrides.items ?? {
      title: { name: 'Title', type: 'text', description: '', note: '' },
    },
  };
}

function writeDesc(filePath: string, doc: ReturnType<typeof makeDesc>) {
  const json = `${JSON.stringify(doc, null, 2)}\n`;
  writeFileAtomic(filePath, json);
  return json;
}

describe('Description 同時更新', () => {
  it('Case1: Viewer が先に保存 → Collector は再 merge して手動 field を保全', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-race1-'));
    try {
      const dataDir = path.join(root, 'spec', 'x', 'src', 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      const realPath = path.join(dataDir, 'demo.json');
      writeDesc(
        realPath,
        makeDesc({
          screenId: 'demo',
          description: '初期',
          items: {
            title: {
              name: 'Title',
              type: 'text',
              description: '手動説明',
              note: '手動備考',
            },
          },
        }),
      );

      const store = createFileDescriptionStore({
        rootDir: root,
        projectName: 'x',
        listScreenIds: () => ['demo'],
      });

      const before = store.read('demo');
      const viewerDoc = structuredClone(before.document);
      viewerDoc.screen.description = 'Viewer更新';
      viewerDoc.items.title.name = 'Viewer名称';
      store.write('demo', viewerDoc, before.revision);

      const result = writeCollectedDescription({
        filePath: realPath,
        screenId: 'demo',
        foundItemIds: ['title', 'new-item'],
      });
      expect(result.written).toBe(true);
      expect(result.addedItemIds).toContain('new-item');

      const saved = JSON.parse(fs.readFileSync(realPath, 'utf8'));
      expect(saved.screen.description).toBe('Viewer更新');
      expect(saved.items.title.name).toBe('Viewer名称');
      expect(saved.items.title.description).toBe('手動説明');
      expect(saved.items.title.note).toBe('手動備考');
      expect(saved.items['new-item']).toEqual({
        name: '',
        type: '',
        description: '',
        note: '',
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('Case2: Collector が先に保存 → Viewer は 409 で Collector 変更を保全', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-race2-'));
    try {
      const dataDir = path.join(root, 'spec', 'x', 'src', 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      const realPath = path.join(dataDir, 'demo.json');
      writeDesc(
        realPath,
        makeDesc({
          screenId: 'demo',
          description: '初期',
        }),
      );

      const store = createFileDescriptionStore({
        rootDir: root,
        projectName: 'x',
        listScreenIds: () => ['demo'],
      });
      const r1 = store.read('demo');

      writeCollectedDescription({
        filePath: realPath,
        screenId: 'demo',
        foundItemIds: ['title', 'extra'],
      });

      const stale = structuredClone(r1.document);
      stale.screen.description = 'Viewerの古い編集';
      expect(() => store.write('demo', stale, r1.revision)).toThrowError(
        /別の場所で変更/,
      );

      const saved = JSON.parse(fs.readFileSync(realPath, 'utf8'));
      expect(saved.screen.description).toBe('初期');
      expect(saved.items.extra).toBeTruthy();
      expect(saved.items.title.name).toBe('Title');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('Case3: 連続 conflict で最大 retry 後に失敗し最新を保全', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-race3-'));
    try {
      const filePath = path.join(root, 'demo.json');
      writeDesc(
        filePath,
        makeDesc({ screenId: 'demo', description: 'keep-me' }),
      );

      let calls = 0;
      const conflictingWrite = (
        ...args: Parameters<typeof writeFileAtomic>
      ): WriteFileAtomicResult => {
        calls += 1;
        return {
          status: 'conflict',
          expectedRevision: 'sha256:old',
          currentRevision: `sha256:new-${calls}`,
        };
      };

      expect(() =>
        writeCollectedDescription({
          filePath,
          screenId: 'demo',
          foundItemIds: ['title'],
          maxRetries: 3,
          writeFileAtomicFn: conflictingWrite,
        }),
      ).toThrowError(/衝突し続けた/);
      expect(calls).toBe(3);

      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(saved.screen.description).toBe('keep-me');
      expect(() => JSON.parse(fs.readFileSync(filePath, 'utf8'))).not.toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('Case5: Collector retry 時も excludedItems と手動 field を保全する', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-race5-excl-'));
    try {
      const dataDir = path.join(root, 'spec', 'x', 'src', 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      const realPath = path.join(dataDir, 'demo.json');
      const initial = {
        schemaVersion: '1.2',
        screen: {
          id: 'demo',
          name: 'Demo',
          description: '初期',
        },
        itemOrder: ['title'],
        items: {
          title: {
            name: 'Title',
            type: 'text',
            description: '手動説明',
            note: '備考',
          },
        },
        excludedItems: {
          layout: {
            name: '枠',
            type: 'container',
            description: '除外説明',
            note: '除外備考',
          },
        },
      };
      fs.writeFileSync(realPath, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');

      let calls = 0;
      const writeOnceConflict = (
        ...args: Parameters<typeof writeFileAtomic>
      ): WriteFileAtomicResult => {
        calls += 1;
        if (calls === 1) {
          // 1 回目は conflict。その間に Viewer が除外説明を更新した想定でディスクを書き換える
          const mid = structuredClone(initial);
          mid.screen.description = 'Viewer更新';
          mid.excludedItems.layout.description = '除外説明を更新';
          fs.writeFileSync(
            realPath,
            `${JSON.stringify(mid, null, 2)}\n`,
            'utf8',
          );
          return {
            status: 'conflict',
            expectedRevision: 'sha256:old',
            currentRevision: 'sha256:viewer',
          };
        }
        return writeFileAtomic(...args);
      };

      const result = writeCollectedDescription({
        filePath: realPath,
        screenId: 'demo',
        foundItemIds: ['title', 'layout', 'new-item'],
        writeFileAtomicFn: writeOnceConflict,
      });
      expect(result.written).toBe(true);
      expect(result.attempts).toBe(2);
      expect(result.addedItemIds).toContain('new-item');
      expect(result.addedItemIds).not.toContain('layout');

      const saved = JSON.parse(fs.readFileSync(realPath, 'utf8'));
      expect(saved.schemaVersion).toBe('1.2');
      expect(saved.screen.description).toBe('Viewer更新');
      expect(saved.excludedItems.layout).toEqual({
        name: '枠',
        type: 'container',
        description: '除外説明を更新',
        note: '除外備考',
      });
      expect(saved.items.layout).toBeUndefined();
      expect(saved.itemOrder).not.toContain('layout');
      expect(saved.items['new-item']).toEqual({
        name: '',
        type: '',
        description: '',
        note: '',
      });
      expect(saved.items.title.description).toBe('手動説明');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('Case4: 異なる screen は互いに遮断しない', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-race4-'));
    try {
      const a = path.join(root, 'crud-create.json');
      const b = path.join(root, 'wizard-input.json');
      writeDesc(a, makeDesc({ screenId: 'crud-create', description: 'A' }));
      writeDesc(b, makeDesc({ screenId: 'wizard-input', description: 'B' }));

      const r1 = writeCollectedDescription({
        filePath: a,
        screenId: 'crud-create',
        foundItemIds: ['title', 'a-new'],
      });
      const r2 = writeCollectedDescription({
        filePath: b,
        screenId: 'wizard-input',
        foundItemIds: ['title', 'b-new'],
      });
      expect(r1.written).toBe(true);
      expect(r2.written).toBe(true);

      const ja = JSON.parse(fs.readFileSync(a, 'utf8'));
      const jb = JSON.parse(fs.readFileSync(b, 'utf8'));
      expect(ja.screen.description).toBe('A');
      expect(jb.screen.description).toBe('B');
      expect(ja.items['a-new']).toBeTruthy();
      expect(jb.items['b-new']).toBeTruthy();
      expect(computeContentRevision(fs.readFileSync(a))).not.toBe(
        computeContentRevision(fs.readFileSync(b)),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
