import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeContentRevision,
  createFileAtomic,
  writeFileAtomic,
  type WriteFileAtomicFs,
} from '../../src/util/write-file-atomic.js';

const MEMORY_COPYFILE_EXCL = 1;

function createMemoryFs(initial: Record<string, Buffer> = {}) {
  const files = new Map<string, Buffer>(
    Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)]),
  );
  const failOn = {
    writeFileSync: null as null | Error,
    renameSync: [] as Array<{ fromIncludes?: string; toIncludes?: string; error: Error }>,
    unlinkSync: null as null | Error,
  };

  const io: WriteFileAtomicFs = {
    existsSync: (p) => files.has(p),
    mkdirSync: () => undefined,
    readFileSync: (p) => {
      const buf = files.get(p);
      if (!buf) {
        throw new Error(`ENOENT: ${p}`);
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
        throw new Error(`ENOENT rename from ${from}`);
      }
      files.set(to, Buffer.from(buf));
      files.delete(from);
    },
    unlinkSync: (p) => {
      if (failOn.unlinkSync) {
        throw failOn.unlinkSync;
      }
      files.delete(p);
    },
    copyFileSync: (src, dest, mode) => {
      const buf = files.get(src);
      if (!buf) {
        throw new Error(`ENOENT copyFileSync from ${src}`);
      }
      const exclusive =
        typeof mode === 'number' && (mode & MEMORY_COPYFILE_EXCL) !== 0;
      if (exclusive && files.has(dest)) {
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      }
      files.set(dest, Buffer.from(buf));
    },
    constants: { COPYFILE_EXCL: MEMORY_COPYFILE_EXCL },
  };

  return { io, files, failOn };
}

describe('writeFileAtomic', () => {
  it('既存なし: TEMP → destination rename', () => {
    const { io, files } = createMemoryFs();
    const dest = '/data/demo.json';
    const result = writeFileAtomic(dest, '{"ok":1}\n', {
      fs: io,
      tempPath: '/data/.demo.json.tmp',
    });
    expect(result.status).toBe('updated');
    expect(files.get(dest)?.toString('utf8')).toBe('{"ok":1}\n');
    expect(files.has('/data/.demo.json.tmp')).toBe(false);
  });

  it('同一内容は unchanged', () => {
    const dest = '/data/demo.json';
    const body = '{"ok":1}\n';
    const { io } = createMemoryFs({ [dest]: Buffer.from(body) });
    const result = writeFileAtomic(dest, body, { fs: io });
    expect(result.status).toBe('unchanged');
  });

  it('直接 rename 失敗時は backup swap で完全置換', () => {
    const dest = '/data/demo.json';
    const { io, files } = createMemoryFs({
      [dest]: Buffer.from('{"old":1}\n'),
    });
    // 最初の TEMP→dest rename だけ失敗させ、backup swap 後の 2 回目は成功
    let tmpToDestAttempts = 0;
    const originalRename = io.renameSync;
    io.renameSync = (from, to) => {
      if (from.includes('.tmp') && to === dest) {
        tmpToDestAttempts += 1;
        if (tmpToDestAttempts === 1) {
          throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
        }
      }
      return originalRename(from, to);
    };

    const result = writeFileAtomic(dest, '{"new":2}\n', {
      fs: io,
      tempPath: '/data/.demo.json.tmp',
      backupPath: '/data/.demo.json.bak',
    });
    expect(result.status).toBe('updated');
    expect(tmpToDestAttempts).toBe(2);
    expect(files.get(dest)?.toString('utf8')).toBe('{"new":2}\n');
    expect(files.has('/data/.demo.json.tmp')).toBe(false);
    expect(files.has('/data/.demo.json.bak')).toBe(false);
  });

  it('TEMP write 失敗でも destination を壊さない', () => {
    const dest = '/data/demo.json';
    const original = '{"old":1}\n';
    const { io, files, failOn } = createMemoryFs({
      [dest]: Buffer.from(original),
    });
    failOn.writeFileSync = new Error('ENOSPC');
    expect(() =>
      writeFileAtomic(dest, '{"new":2}\n', {
        fs: io,
        tempPath: '/data/.demo.json.tmp',
      }),
    ).toThrow(/ENOSPC/);
    expect(files.get(dest)?.toString('utf8')).toBe(original);
    expect(files.has('/data/.demo.json.tmp')).toBe(false);
  });

  it('backup rename 失敗で destination を保全', () => {
    const dest = '/data/demo.json';
    const original = '{"old":1}\n';
    const { io, files } = createMemoryFs({
      [dest]: Buffer.from(original),
    });
    const originalRename = io.renameSync;
    io.renameSync = (from, to) => {
      // 直接 TEMP→dest は失敗
      if (from.includes('.tmp') && to === dest) {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      }
      // dest→backup も失敗
      if (from === dest && to.includes('.bak')) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      }
      return originalRename(from, to);
    };

    expect(() =>
      writeFileAtomic(dest, '{"new":2}\n', {
        fs: io,
        tempPath: '/data/.demo.json.tmp',
        backupPath: '/data/.demo.json.bak',
      }),
    ).toThrow(/EACCES/);
    expect(files.get(dest)?.toString('utf8')).toBe(original);
    expect(files.has('/data/.demo.json.tmp')).toBe(false);
  });

  it('TEMP→destination rename 失敗時は backup から復元', () => {
    const dest = '/data/demo.json';
    const original = '{"old":1}\n';
    const { io, files } = createMemoryFs({
      [dest]: Buffer.from(original),
    });
    const originalRename = io.renameSync;
    io.renameSync = (from, to) => {
      if (from.includes('.tmp') && to === dest) {
        // 1回目（直接）も 2回目（swap 後）も失敗させる
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      }
      return originalRename(from, to);
    };

    expect(() =>
      writeFileAtomic(dest, '{"new":2}\n', {
        fs: io,
        tempPath: '/data/.demo.json.tmp',
        backupPath: '/data/.demo.json.bak',
      }),
    ).toThrow(/EPERM/);
    expect(files.get(dest)?.toString('utf8')).toBe(original);
    expect(files.has('/data/.demo.json.tmp')).toBe(false);
    expect(files.has('/data/.demo.json.bak')).toBe(false);
  });

  it('expectedRevision 不一致は conflict で元を復元', () => {
    const dest = '/data/demo.json';
    const original = '{"old":1}\n';
    const { io, files } = createMemoryFs({
      [dest]: Buffer.from(original),
    });
    const result = writeFileAtomic(dest, '{"new":2}\n', {
      fs: io,
      expectedRevision: 'sha256:stale',
      tempPath: '/data/.demo.json.tmp',
      backupPath: '/data/.demo.json.bak',
    });
    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') {
      expect(result.currentRevision).toBe(computeContentRevision(original));
    }
    expect(files.get(dest)?.toString('utf8')).toBe(original);
    expect(files.has('/data/.demo.json.tmp')).toBe(false);
    expect(files.has('/data/.demo.json.bak')).toBe(false);
  });

  it('createFileAtomic: 新規作成は created を返す', () => {
    const { io, files } = createMemoryFs();
    const dest = '/data/demo.json';
    const result = createFileAtomic(dest, '{"ok":1}\n', {
      fs: io,
      tempPath: '/data/.demo.json.tmp',
    });
    expect(result.status).toBe('created');
    expect(files.get(dest)?.toString('utf8')).toBe('{"ok":1}\n');
    expect(files.has('/data/.demo.json.tmp')).toBe(false);
  });

  it('createFileAtomic: 既存ファイルは上書きせず exists を返す', () => {
    const dest = '/data/demo.json';
    const original = '{"old":1}\n';
    const { io, files } = createMemoryFs({ [dest]: Buffer.from(original) });
    const result = createFileAtomic(dest, '{"new":2}\n', {
      fs: io,
      tempPath: '/data/.demo.json.tmp',
    });
    expect(result.status).toBe('exists');
    expect(files.get(dest)?.toString('utf8')).toBe(original);
    expect(files.has('/data/.demo.json.tmp')).toBe(false);
  });

  it('createFileAtomic: 実ファイルでも create-if-absent が成立する', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-create-atomic-'));
    try {
      const dest = path.join(root, 'demo.json');
      const first = createFileAtomic(dest, '{"a":1}\n');
      expect(first.status).toBe('created');
      expect(JSON.parse(fs.readFileSync(dest, 'utf8'))).toEqual({ a: 1 });

      const second = createFileAtomic(dest, '{"b":2}\n');
      expect(second.status).toBe('exists');
      // 上書きされていないこと
      expect(JSON.parse(fs.readFileSync(dest, 'utf8'))).toEqual({ a: 1 });

      const leftovers = fs
        .readdirSync(root)
        .filter((n) => n.includes('.tmp') || n.includes('.bak'));
      expect(leftovers).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('実ファイルでも backup swap 後に完全 JSON を残す', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-atomic-'));
    try {
      const dest = path.join(root, 'demo.json');
      fs.writeFileSync(dest, '{"old":true}\n');
      const result = writeFileAtomic(dest, '{"new":true}\n');
      expect(result.status).toBe('updated');
      expect(JSON.parse(fs.readFileSync(dest, 'utf8'))).toEqual({ new: true });
      const leftovers = fs.readdirSync(root).filter((n) => n.includes('.tmp') || n.includes('.bak'));
      expect(leftovers).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
