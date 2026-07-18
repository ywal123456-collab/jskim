import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileDescriptionStore } from '../../src/editing/file-description-store.js';
import {
  computeContentRevision,
  writeFileAtomic,
} from '../../src/util/write-file-atomic.js';
import {
  resetDescriptionScreenLocksForTest,
  withDescriptionScreenLock,
} from '../../src/editing/description-screen-lock.js';
import { writeCollectedDescription } from '../../src/collector/write-collected-description.js';

function writeDesc(filePath: string, doc: Record<string, unknown>) {
  const json = `${JSON.stringify(doc, null, 2)}\n`;
  writeFileAtomic(filePath, json);
  return { json, revision: computeContentRevision(json) };
}

describe('FileDescriptionStore.delete', () => {
  afterEach(() => {
    resetDescriptionScreenLocksForTest();
  });

  it('正常削除: Description だけ消し source/snapshot は残す', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-del-ok-'));
    try {
      const dataDir = path.join(root, 'spec', 'x', 'src', 'data');
      const pagesDir = path.join(root, 'src', 'x', 'pages');
      const snapDir = path.join(root, 'spec', 'x', 'src', 'snapshots', 'demo');
      const resDir = path.join(root, 'spec', 'x', 'src', 'resources');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.mkdirSync(snapDir, { recursive: true });
      fs.mkdirSync(resDir, { recursive: true });

      const sourcePath = path.join(pagesDir, 'demo.spec.json');
      const snapPath = path.join(snapDir, 'default.html');
      const resPath = path.join(resDir, 'manifest.json');
      fs.writeFileSync(sourcePath, '{"schemaVersion":"1.0"}\n');
      fs.writeFileSync(snapPath, '<div>snap</div>\n');
      fs.writeFileSync(resPath, '{"files":[]}\n');

      const descPath = path.join(dataDir, 'demo.json');
      const { revision } = writeDesc(descPath, {
        schemaVersion: '1.2',
        screen: { id: 'demo', name: 'Demo', description: '' },
        itemOrder: ['title'],
        excludedItems: {},
        items: {
          title: { name: 'T', type: 'text', description: '', note: '' },
        },
      });

      const store = createFileDescriptionStore({
        rootDir: root,
        projectName: 'x',
        listScreenIds: () => ['demo'],
      });

      const result = store.delete('demo', revision);
      expect(result).toEqual({ screenId: 'demo', deleted: true });
      expect(fs.existsSync(descPath)).toBe(false);
      expect(fs.existsSync(sourcePath)).toBe(true);
      expect(fs.existsSync(snapPath)).toBe(true);
      expect(fs.existsSync(resPath)).toBe(true);

      const after = store.read('demo');
      expect(after.exists).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('ファイル無し / IMPLEMENTATION_ONLY は NOT_FOUND', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-del-miss-'));
    try {
      const store = createFileDescriptionStore({
        rootDir: root,
        projectName: 'x',
        listScreenIds: () => ['impl-only'],
      });
      try {
        store.delete('impl-only', 'sha256:deadbeef');
        expect.unreachable('should throw');
      } catch (err) {
        expect((err as { code?: string }).code).toBe(
          'SPEC_DESCRIPTION_NOT_FOUND',
        );
        expect((err as { statusCode?: number }).statusCode).toBe(404);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('revision 不一致は 409 でファイルを残す', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-del-409-'));
    try {
      const dataDir = path.join(root, 'spec', 'x', 'src', 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      const descPath = path.join(dataDir, 'demo.json');
      writeDesc(descPath, {
        schemaVersion: '1.2',
        screen: { id: 'demo', name: 'Demo', description: '' },
        itemOrder: [],
        excludedItems: {},
        items: {},
      });
      const store = createFileDescriptionStore({
        rootDir: root,
        projectName: 'x',
        listScreenIds: () => ['demo'],
      });
      try {
        store.delete('demo', 'sha256:stale');
        expect.unreachable('should throw');
      } catch (err) {
        expect((err as { code?: string }).code).toBe(
          'SPEC_DESCRIPTION_REVISION_CONFLICT',
        );
        expect((err as { statusCode?: number }).statusCode).toBe(409);
      }
      expect(fs.existsSync(descPath)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('expectedRevision 欠落・形式不正は 400', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-del-400-'));
    try {
      const dataDir = path.join(root, 'spec', 'x', 'src', 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      const descPath = path.join(dataDir, 'demo.json');
      const { revision } = writeDesc(descPath, {
        schemaVersion: '1.2',
        screen: { id: 'demo', name: 'Demo', description: '' },
        itemOrder: [],
        excludedItems: {},
        items: {},
      });
      const store = createFileDescriptionStore({
        rootDir: root,
        projectName: 'x',
        listScreenIds: () => ['demo'],
      });
      for (const bad of [null, '', 'md5:abc', 'sha256:']) {
        try {
          store.delete('demo', bad as string);
          expect.unreachable('should throw');
        } catch (err) {
          expect((err as { code?: string }).code).toBe(
            'SPEC_DESCRIPTION_INVALID_REVISION',
          );
        }
      }
      expect(fs.existsSync(descPath)).toBe(true);
      store.delete('demo', revision);
      expect(fs.existsSync(descPath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('DESIGN_ONLY 削除後は read が SCREEN_NOT_FOUND', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-del-do-'));
    try {
      const dataDir = path.join(root, 'spec', 'x', 'src', 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      const descPath = path.join(dataDir, 'design-only.json');
      const { revision } = writeDesc(descPath, {
        schemaVersion: '1.2',
        screen: { id: 'design-only', name: '設計のみ', description: '' },
        itemOrder: [],
        excludedItems: {},
        items: {},
      });

      let ids = ['design-only'];
      const store = createFileDescriptionStore({
        rootDir: root,
        projectName: 'x',
        listScreenIds: () => ids,
      });
      store.delete('design-only', revision);
      ids = [];
      try {
        store.read('design-only');
        expect.unreachable('should throw');
      } catch (err) {
        expect((err as { code?: string }).code).toBe(
          'SPEC_DESCRIPTION_SCREEN_NOT_FOUND',
        );
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('DELETE vs PUT / Collector（screen lock）', () => {
  afterEach(() => {
    resetDescriptionScreenLocksForTest();
  });

  it('Case A: PUT 成功後の DELETE は 409', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-race-put-'));
    try {
      const dataDir = path.join(root, 'spec', 'x', 'src', 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      const descPath = path.join(dataDir, 'demo.json');
      const { revision: r1 } = writeDesc(descPath, {
        schemaVersion: '1.2',
        screen: { id: 'demo', name: 'Demo', description: 'old' },
        itemOrder: ['title'],
        excludedItems: {},
        items: {
          title: { name: 'T', type: 'text', description: '', note: '' },
        },
      });
      const store = createFileDescriptionStore({
        rootDir: root,
        projectName: 'x',
        listScreenIds: () => ['demo'],
      });

      let releasePut!: () => void;
      const putGate = new Promise<void>((resolve) => {
        releasePut = resolve;
      });

      const putPromise = withDescriptionScreenLock('demo', async () => {
        await putGate;
        const before = store.read('demo');
        const next = structuredClone(before.document);
        next.screen.description = 'put-first';
        return store.write('demo', next, before.revision);
      });

      const deletePromise = (async () => {
        await Promise.resolve();
        return withDescriptionScreenLock('demo', () => {
          try {
            store.delete('demo', r1);
            return { ok: true as const };
          } catch (err) {
            return {
              ok: false as const,
              code: (err as { code?: string }).code,
            };
          }
        });
      })();

      releasePut();
      const putResult = await putPromise;
      const delResult = await deletePromise;
      expect(putResult.written).toBe(true);
      expect(delResult.ok).toBe(false);
      expect(delResult.code).toBe('SPEC_DESCRIPTION_REVISION_CONFLICT');
      expect(fs.existsSync(descPath)).toBe(true);
      expect(store.read('demo').document.screen.description).toBe('put-first');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('Case B: DELETE 成功後の PUT は 409 で再生成しない', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-race-del-'));
    try {
      const dataDir = path.join(root, 'spec', 'x', 'src', 'data');
      const snapDir = path.join(root, 'spec', 'x', 'src', 'snapshots', 'demo');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.mkdirSync(snapDir, { recursive: true });
      fs.writeFileSync(
        path.join(snapDir, 'default.html'),
        '<main data-jskim-spec-screen="demo"><span data-jskim-spec-item="title">t</span></main>\n',
      );
      const descPath = path.join(dataDir, 'demo.json');
      const { revision: r1 } = writeDesc(descPath, {
        schemaVersion: '1.2',
        screen: { id: 'demo', name: 'Demo', description: 'old' },
        itemOrder: ['title'],
        excludedItems: {},
        items: {
          title: { name: 'T', type: 'text', description: '', note: '' },
        },
      });
      const store = createFileDescriptionStore({
        rootDir: root,
        projectName: 'x',
        listScreenIds: () => ['demo'],
      });

      let releaseDelete!: () => void;
      const deleteGate = new Promise<void>((resolve) => {
        releaseDelete = resolve;
      });

      const deletePromise = withDescriptionScreenLock('demo', async () => {
        await deleteGate;
        return store.delete('demo', r1);
      });

      const putPromise = (async () => {
        await Promise.resolve();
        return withDescriptionScreenLock('demo', () => {
          try {
            const doc = {
              schemaVersion: '1.2' as const,
              screen: { id: 'demo', name: 'Demo', description: 'late-put' },
              itemOrder: ['title'],
              excludedItems: {},
              items: {
                title: {
                  name: 'T',
                  type: 'text',
                  description: '',
                  note: '',
                },
              },
            };
            store.write('demo', doc, r1);
            return { ok: true as const };
          } catch (err) {
            return {
              ok: false as const,
              code: (err as { code?: string }).code,
            };
          }
        });
      })();

      releaseDelete();
      await deletePromise;
      const putResult = await putPromise;
      expect(putResult.ok).toBe(false);
      expect(putResult.code).toBe('SPEC_DESCRIPTION_REVISION_CONFLICT');
      expect(fs.existsSync(descPath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('Case C: 同じ revision の二重 DELETE は 1 成功 1 失敗', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-race-2del-'));
    try {
      const dataDir = path.join(root, 'spec', 'x', 'src', 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      const descPath = path.join(dataDir, 'demo.json');
      const { revision } = writeDesc(descPath, {
        schemaVersion: '1.2',
        screen: { id: 'demo', name: 'Demo', description: '' },
        itemOrder: [],
        excludedItems: {},
        items: {},
      });
      const store = createFileDescriptionStore({
        rootDir: root,
        projectName: 'x',
        listScreenIds: () => ['demo'],
      });

      const results = await Promise.all([
        withDescriptionScreenLock('demo', () => {
          try {
            return { ok: true as const, ...store.delete('demo', revision) };
          } catch (err) {
            return {
              ok: false as const,
              code: (err as { code?: string }).code,
            };
          }
        }),
        withDescriptionScreenLock('demo', () => {
          try {
            return { ok: true as const, ...store.delete('demo', revision) };
          } catch (err) {
            return {
              ok: false as const,
              code: (err as { code?: string }).code,
            };
          }
        }),
      ]);

      const oks = results.filter((r) => r.ok);
      const fails = results.filter((r) => !r.ok);
      expect(oks).toHaveLength(1);
      expect(fails).toHaveLength(1);
      expect(fails[0]?.code).toBe('SPEC_DESCRIPTION_NOT_FOUND');
      expect(fs.existsSync(descPath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('Collector 先成功 → DELETE old revision は 409', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-race-col-'));
    try {
      const dataDir = path.join(root, 'spec', 'x', 'src', 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      const descPath = path.join(dataDir, 'demo.json');
      const { revision: r1 } = writeDesc(descPath, {
        schemaVersion: '1.2',
        screen: { id: 'demo', name: 'Demo', description: 'manual' },
        itemOrder: ['title'],
        excludedItems: {},
        items: {
          title: { name: 'T', type: 'text', description: 'keep', note: '' },
        },
      });
      const store = createFileDescriptionStore({
        rootDir: root,
        projectName: 'x',
        listScreenIds: () => ['demo'],
      });

      let releaseCollect!: () => void;
      const collectGate = new Promise<void>((resolve) => {
        releaseCollect = resolve;
      });

      const collectPromise = withDescriptionScreenLock('demo', async () => {
        await collectGate;
        return writeCollectedDescription({
          filePath: descPath,
          screenId: 'demo',
          foundItemIds: ['title', 'new-item'],
        });
      });

      const deletePromise = (async () => {
        await Promise.resolve();
        return withDescriptionScreenLock('demo', () => {
          try {
            store.delete('demo', r1);
            return { ok: true as const };
          } catch (err) {
            return {
              ok: false as const,
              code: (err as { code?: string }).code,
            };
          }
        });
      })();

      releaseCollect();
      const collectResult = await collectPromise;
      const delResult = await deletePromise;
      expect(collectResult.written).toBe(true);
      expect(delResult.ok).toBe(false);
      expect(delResult.code).toBe('SPEC_DESCRIPTION_REVISION_CONFLICT');
      expect(fs.existsSync(descPath)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(descPath, 'utf8'));
      expect(saved.items.title.description).toBe('keep');
      expect(saved.items['new-item']).toBeTruthy();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('DELETE 先成功 → Collector は再生成しない', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-race-dcol-'));
    try {
      const dataDir = path.join(root, 'spec', 'x', 'src', 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      const descPath = path.join(dataDir, 'demo.json');
      const { revision } = writeDesc(descPath, {
        schemaVersion: '1.2',
        screen: { id: 'demo', name: 'Demo', description: '' },
        itemOrder: ['title'],
        excludedItems: {},
        items: {
          title: { name: 'T', type: 'text', description: '', note: '' },
        },
      });
      const store = createFileDescriptionStore({
        rootDir: root,
        projectName: 'x',
        listScreenIds: () => ['demo'],
      });

      let releaseDelete!: () => void;
      const deleteGate = new Promise<void>((resolve) => {
        releaseDelete = resolve;
      });

      const deletePromise = withDescriptionScreenLock('demo', async () => {
        await deleteGate;
        return store.delete('demo', revision);
      });

      const collectPromise = (async () => {
        await Promise.resolve();
        return withDescriptionScreenLock('demo', () =>
          writeCollectedDescription({
            filePath: descPath,
            screenId: 'demo',
            foundItemIds: ['title', 'extra'],
          }),
        );
      })();

      releaseDelete();
      await deletePromise;
      const collectResult = await collectPromise;
      expect(collectResult.written).toBe(false);
      expect(fs.existsSync(descPath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('異なる screenId は並列できる', async () => {
    const order: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const a = withDescriptionScreenLock('a', async () => {
      order.push('a-start');
      await gateA;
      order.push('a-end');
    });
    const b = withDescriptionScreenLock('b', async () => {
      order.push('b');
    });

    await waitForOrder(order, ['a-start', 'b']);
    releaseA();
    await Promise.all([a, b]);
    expect(order[order.length - 1]).toBe('a-end');
    expect(order).toContain('a-start');
    expect(order).toContain('b');
  });
});

async function waitForOrder(order: string[], required: string[]) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (required.every((item) => order.includes(item))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`order timeout: ${JSON.stringify(order)}`);
}
