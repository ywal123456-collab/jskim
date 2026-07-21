import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeCollectedDescription } from '../../src/collector/write-collected-description.js';
import {
  createDescriptionGroup,
  descriptionScreenMutationLockPath,
  readDescriptionRevision,
} from '../../src/editing/description-document/index.js';
import { createFileDescriptionStore } from '../../src/editing/file-description-store.js';
import {
  bindDescriptionScreenLock,
  resetDescriptionScreenLocksForTest,
  withDescriptionScreenLock,
} from '../../src/editing/description-screen-lock.js';
import {
  computeContentRevision,
  writeFileAtomic,
  type WriteFileAtomicFs,
} from '../../src/util/write-file-atomic.js';

const TIMEOUT_MS = 5000;
const temps: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-lock-audit-'));
  temps.push(dir);
  fs.mkdirSync(path.join(dir, 'spec', 'demo', 'src', 'data'), {
    recursive: true,
  });
  return dir;
}

function ctx(root: string) {
  return { rootDir: root, projectName: 'demo', screenId: 'demo-screen' };
}

function writeDescriptionFile(root: string, doc: Record<string, unknown>): string {
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

function docErrorCode(err: unknown): string | undefined {
  return err instanceof Error && 'code' in err
    ? String((err as { code: string }).code)
    : undefined;
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

function listTempFiles(root: string, dataDir: string): string[] {
  const lockDir = path.join(root, 'spec', 'demo', '.jskim', 'description-mutation');
  const names: string[] = [];
  if (fs.existsSync(lockDir)) {
    for (const name of fs.readdirSync(lockDir)) {
      names.push(path.join(lockDir, name));
    }
  }
  if (fs.existsSync(dataDir)) {
    for (const name of fs.readdirSync(dataDir)) {
      if (name.includes('.tmp') || name.includes('.bak')) {
        names.push(path.join(dataDir, name));
      }
    }
  }
  return names;
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label}: timeout ${TIMEOUT_MS}ms`)),
      TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
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

describe('Description mutation lock audit', () => {
  it('lock 待機中の外部 revision 変更は取得後 REVISION_CONFLICT', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [],
      groups: [],
      items: {},
      excludedItems: {},
    });
    const r1 = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    let releaseBlock!: () => void;
    const block = new Promise<void>((resolve) => {
      releaseBlock = resolve;
    });

    const blocker = withDescriptionScreenLock(ctx(root), 'block', () => block);
    await new Promise((resolve) => setTimeout(resolve, 20));

    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: 'external' },
      rootNodes: [],
      groups: [],
      items: {},
      excludedItems: {},
    });
    const r2 = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    expect(r2).not.toBe(r1);

    const stalePromise = createDescriptionGroup(ctx(root), {
      groupId: 'second',
      name: 'Second',
      kind: 'SECTION',
      expectedRevision: r1,
    });

    releaseBlock();
    await blocker;
    await expect(stalePromise).rejects.toMatchObject({
      code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
    });
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json'),
          'utf8',
        ),
      ).screen.description,
    ).toBe('external');
  });

  it('Group mutation + legacy PUT は deadlock なく直列化する', async () => {
    const root = tempRoot();
    const filePath = path.join(
      root,
      'spec',
      'demo',
      'src',
      'data',
      'demo-screen.json',
    );
    writeDescriptionFile(root, {
      schemaVersion: '1.2',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      itemOrder: [],
      items: {},
      excludedItems: {},
    });
    const store = createFileDescriptionStore({
      rootDir: root,
      projectName: 'demo',
      listScreenIds: () => ['demo-screen'],
    });
    const withLock = bindDescriptionScreenLock(root, 'demo');
    let releasePut!: () => void;
    const putGate = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;

    const putPromise = withLock('demo-screen', async () => {
      await putGate;
      const before = store.read('demo-screen');
      const next = structuredClone(before.document);
      next.screen.description = 'put';
      return store.write('demo-screen', next, before.revision);
    });
    const groupPromise = createDescriptionGroup(ctx(root), {
      groupId: 'section',
      name: 'Section',
      kind: 'SECTION',
      expectedRevision: revision,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    releasePut();
    await withTimeout(Promise.allSettled([putPromise, groupPromise]), 'put+group');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(
      fs.existsSync(descriptionScreenMutationLockPath(root, 'demo', 'demo-screen')),
    ).toBe(false);
  });

  it('Group mutation + Collector は deadlock なく終了する', async () => {
    const root = tempRoot();
    const filePath = path.join(
      root,
      'spec',
      'demo',
      'src',
      'data',
      'demo-screen.json',
    );
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [],
      groups: [],
      items: {},
      excludedItems: {},
    });
    let releaseCollect!: () => void;
    const collectGate = new Promise<void>((resolve) => {
      releaseCollect = resolve;
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;

    const collectPromise = withDescriptionScreenLock(
      ctx(root),
      'collector-write',
      async () => {
        await collectGate;
        try {
          writeCollectedDescription({
            filePath,
            screenId: 'demo-screen',
            foundItemIds: ['item-a'],
          });
          return { ok: true as const };
        } catch (err) {
          return { ok: false as const, code: docErrorCode(err) };
        }
      },
    );
    const groupPromise = createDescriptionGroup(ctx(root), {
      groupId: 'section',
      name: 'Section',
      kind: 'SECTION',
      expectedRevision: revision,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseCollect();
    const results = await withTimeout(
      Promise.allSettled([collectPromise, groupPromise]),
      'collect+group',
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const collectResult = (results[0] as PromiseFulfilledResult<{ ok: boolean; code?: string }>).value;
    expect(collectResult.ok).toBe(false);
    expect(collectResult.code).toBe('SPEC_DESCRIPTION_UNSUPPORTED_SCHEMA');
    expect(
      fs.existsSync(descriptionScreenMutationLockPath(root, 'demo', 'demo-screen')),
    ).toBe(false);
  });

  it('final replace 失敗時は既存 bytes / revision を維持し lock を解放する', async () => {
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
    const dataDir = path.dirname(filePath);
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    const { io, failOn } = createMemoryFs({
      [filePath]: Buffer.from(original),
    });
    let tmpToDestAttempts = 0;
    const originalRename = io.renameSync;
    io.renameSync = (from, to) => {
      if (from.includes('.tmp') && to === filePath) {
        tmpToDestAttempts += 1;
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      }
      return originalRename(from, to);
    };

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
    ).rejects.toThrow(/EPERM/);
    expect(tmpToDestAttempts).toBeGreaterThan(0);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(original);
    expect(readDescriptionRevision(root, 'demo', 'demo-screen')).toBe(revision);
    expect(listTempFiles(root, dataDir)).toEqual([]);

    const retry = await createDescriptionGroup(ctx(root), {
      groupId: 'section',
      name: 'Section',
      kind: 'SECTION',
      expectedRevision: revision,
    });
    expect(retry.status).toBe('updated');
    expect(
      fs.existsSync(descriptionScreenMutationLockPath(root, 'demo', 'demo-screen')),
    ).toBe(false);
  });

  it('TEMP write 失敗後も lock 解放と後続 mutation が可能', async () => {
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
    const dataDir = path.dirname(filePath);
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    const { io, failOn } = createMemoryFs({
      [filePath]: Buffer.from(original),
    });
    failOn.writeFileSync = Object.assign(new Error('ENOSPC'), {
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
    ).rejects.toThrow(/ENOSPC/);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(original);
    expect(listTempFiles(root, dataDir)).toEqual([]);
    expect(
      fs.existsSync(descriptionScreenMutationLockPath(root, 'demo', 'demo-screen')),
    ).toBe(false);

    failOn.writeFileSync = null;
    const retry = await createDescriptionGroup(ctx(root), {
      groupId: 'section',
      name: 'Section',
      kind: 'SECTION',
      expectedRevision: revision,
    });
    expect(retry.status).toBe('updated');
  });

  it('revision conflict / validation 失敗でも lock と TEMP を残さない', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
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
    const dataDir = path.dirname(filePath);
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;

    await expect(
      createDescriptionGroup(ctx(root), {
        groupId: 'section',
        name: 'Section',
        kind: 'SECTION',
        expectedRevision: 'sha256:stale',
      }),
    ).rejects.toMatchObject({ code: 'SPEC_DESCRIPTION_REVISION_CONFLICT' });

    await expect(
      createDescriptionGroup(ctx(root), {
        groupId: 'BAD ID',
        name: 'Section',
        kind: 'SECTION',
        expectedRevision: revision,
      }),
    ).rejects.toMatchObject({ code: 'SPEC_DESCRIPTION_INVALID' });

    expect(listTempFiles(root, dataDir)).toEqual([]);
    expect(
      fs.existsSync(descriptionScreenMutationLockPath(root, 'demo', 'demo-screen')),
    ).toBe(false);
  });

  it('成功後も lock / TEMP を残さない', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.3',
      screen: { id: 'demo-screen', name: 'Demo', description: '' },
      rootNodes: [],
      groups: [],
      items: {},
      excludedItems: {},
    });
    const dataDir = path.join(root, 'spec', 'demo', 'src', 'data');
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await createDescriptionGroup(ctx(root), {
      groupId: 'section',
      name: 'Section',
      kind: 'SECTION',
      expectedRevision: revision,
    });
    expect(listTempFiles(root, dataDir)).toEqual([]);
    expect(
      fs.existsSync(descriptionScreenMutationLockPath(root, 'demo', 'demo-screen')),
    ).toBe(false);
  });
});
