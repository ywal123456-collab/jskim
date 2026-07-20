import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  VersionControlError,
  decodeVersionObjectBytes,
  encodeVersionObject,
  hashVersionObject,
  hasVersionObject,
  initVersionRepository,
  readVersionObject,
  writeVersionObject,
  type CommitObject,
  type TagObject,
  type TreeObject,
} from '../../src/version-control/index.js';
import {
  createDurableFileAtomic,
  type DurableCreateFs,
} from '../../src/version-control/durable-create.js';

const temps: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-vc-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function initDemo(root: string) {
  return initVersionRepository({ rootDir: root, projectName: 'demo' });
}

describe('version object store', () => {
  it('固定 golden hash と canonical UTF-8 payload を維持する', () => {
    const hello = Buffer.from('hello', 'utf8');
    const tree: TreeObject = {
      formatVersion: '1.0',
      entries: [
        {
          name: 'a.txt',
          objectType: 'blob',
          hash: '8aec4e4876f854f688d0ebfc8f37598f38e5fd6903cccc850ca36591175aeb60',
        },
      ],
    };
    const emptyTree: TreeObject = { formatVersion: '1.0', entries: [] };
    const commit: CommitObject = {
      formatVersion: '1.0',
      tree: '50a1a2195169190f4c63115d59d7d78f60272967755ac69625eadee1425edf18',
      parents: [],
      author: { name: '設計', email: 'a@example.com' },
      committer: { name: '設計', email: 'a@example.com' },
      committedAt: '2026-07-20T01:02:03.000Z',
      message: '初期',
    };
    const merge: CommitObject = {
      ...commit,
      parents: ['a'.repeat(64), 'b'.repeat(64)],
      message: 'merge',
    };
    const tag: TagObject = {
      formatVersion: '1.0',
      object: '8d1f0252e409f728beef3772a02f37de5e465e73111206e6f395a14a99d0416c',
      objectType: 'commit',
      name: 'v-golden',
      tagger: { name: '設計', email: 'a@example.com' },
      taggedAt: '2026-07-20T01:02:03.000Z',
      message: 'tag',
    };

    expect(hashVersionObject('blob', Buffer.alloc(0))).toBe('473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813');
    expect(hashVersionObject('blob', hello)).toBe('8aec4e4876f854f688d0ebfc8f37598f38e5fd6903cccc850ca36591175aeb60');
    expect(hashVersionObject('blob', Buffer.from('画面', 'utf8'))).toBe('b8218bc9e9740a2a33696fe022562e1428730a4dc658571ba543e67108c66c8d');
    expect(hashVersionObject('tree', tree)).toBe('8c858b0fda1979284508949b0f2ed32f958e42fa7fb23dab2df9c24f13f4d8df');
    expect(hashVersionObject('tree', emptyTree)).toBe('50a1a2195169190f4c63115d59d7d78f60272967755ac69625eadee1425edf18');
    expect(hashVersionObject('commit', commit)).toBe('8d1f0252e409f728beef3772a02f37de5e465e73111206e6f395a14a99d0416c');
    expect(hashVersionObject('commit', merge)).toBe('406e9ca653ebd9502f5a153127481d3c20b80a950ee8b4a647a55aa8de609631');
    expect(hashVersionObject('tag', tag)).toBe('bfa45f75da2e181a1ff0a1481b3f71d8db024ff28e6ba290ce61e58b7537c51a');

    expect(encodeVersionObject('tree', tree).payload.toString('utf8')).toBe(
      '{"entries":[{"hash":"8aec4e4876f854f688d0ebfc8f37598f38e5fd6903cccc850ca36591175aeb60","name":"a.txt","objectType":"blob"}],"formatVersion":"1.0"}',
    );
    expect(encodeVersionObject('commit', commit).payload.toString('utf8')).toBe(
      '{"author":{"email":"a@example.com","name":"設計"},"committedAt":"2026-07-20T01:02:03.000Z","committer":{"email":"a@example.com","name":"設計"},"formatVersion":"1.0","message":"初期","parents":[],"tree":"50a1a2195169190f4c63115d59d7d78f60272967755ac69625eadee1425edf18"}',
    );
    expect(encodeVersionObject('tag', tag).payload.toString('utf8')).toBe(
      '{"formatVersion":"1.0","message":"tag","name":"v-golden","object":"8d1f0252e409f728beef3772a02f37de5e465e73111206e6f395a14a99d0416c","objectType":"commit","taggedAt":"2026-07-20T01:02:03.000Z","tagger":{"email":"a@example.com","name":"設計"}}',
    );
  });

  it('非 canonical な header length を拒否する', () => {
    for (const header of ['blob 00', 'blob 01', 'blob +1', 'blob -1', 'blob 1 ', 'blob 1e0']) {
      expect(() =>
        decodeVersionObjectBytes(
          Buffer.concat([Buffer.from(`${header}\0`, 'utf8'), Buffer.from('x')]),
          'a'.repeat(64),
        ),
      ).toThrow(VersionControlError);
    }
  });

  it('破損済み object を自動削除または上書きしない', () => {
    const root = tempRoot();
    initDemo(root);
    const written = writeVersionObject({
      rootDir: root, projectName: 'demo', type: 'blob', payload: Buffer.from('same'),
    });
    const objectPath = path.join(root, 'spec', 'demo', '.jskim', 'version', 'objects', written.hash.slice(0, 2), written.hash.slice(2));
    fs.writeFileSync(objectPath, Buffer.from('garbage'));
    expect(() => writeVersionObject({
      rootDir: root, projectName: 'demo', type: 'blob', payload: Buffer.from('same'),
    })).toThrow(VersionControlError);
    expect(fs.readFileSync(objectPath).toString('utf8')).toBe('garbage');
    expect(fs.readdirSync(path.dirname(objectPath)).every((name) => !name.includes('.tmp'))).toBe(true);
  });

  it('durable create は link 前に file fd を fsync する', () => {
    const calls: string[] = [];
    const io: DurableCreateFs = {
      mkdirSync: () => undefined,
      openSync: () => 11,
      writeSync: (_fd, _buffer, _offset, length) => length ?? 0,
      fsyncSync: (fd) => calls.push(`fsync:${fd}`),
      closeSync: (fd) => calls.push(`close:${fd}`),
      unlinkSync: () => calls.push('unlink'),
      existsSync: () => true,
      linkSync: () => calls.push('link'),
    };
    expect(createDurableFileAtomic('/tmp/object', Buffer.from('x'), { fs: io, tempPath: '/tmp/.object.tmp' })).toEqual({ status: 'created' });
    expect(calls.indexOf('fsync:11')).toBeLessThan(calls.indexOf('link'));
  });

  it('durable create の fault injection は主エラーを維持する', () => {
    const failing = (phase: 'write' | 'fsync' | 'link', code?: string): DurableCreateFs => ({
      mkdirSync: () => undefined,
      openSync: () => 1,
      writeSync: (_fd, _buffer, _offset, length) => {
        if (phase === 'write') throw new Error('write');
        return length ?? 0;
      },
      fsyncSync: () => { if (phase === 'fsync') throw new Error('fsync'); },
      closeSync: () => undefined,
      unlinkSync: () => { throw new Error('cleanup'); },
      existsSync: () => true,
      linkSync: () => {
        if (phase === 'link') {
          const error = new Error('link') as NodeJS.ErrnoException;
          error.code = code;
          throw error;
        }
      },
    });
    expect(() => createDurableFileAtomic('/tmp/x', 'x', { fs: failing('write'), tempPath: '/tmp/x.tmp' })).toThrow('write');
    expect(() => createDurableFileAtomic('/tmp/x', 'x', { fs: failing('fsync'), tempPath: '/tmp/x.tmp' })).toThrow('fsync');
    expect(() => createDurableFileAtomic('/tmp/x', 'x', { fs: failing('link', 'EIO'), tempPath: '/tmp/x.tmp' })).toThrow('link');
    expect(createDurableFileAtomic('/tmp/x', 'x', { fs: failing('link', 'EEXIST'), tempPath: '/tmp/x.tmp' })).toEqual({ status: 'exists' });
  });

  it('tree の NFC および case-fold 衝突を拒否する', () => {
    const hash = 'a'.repeat(64);
    for (const names of [['café', 'cafe\u0301'], ['Foo', 'foo']]) {
      expect(() => hashVersionObject('tree', {
        formatVersion: '1.0',
        entries: names.map((name) => ({ name, objectType: 'blob' as const, hash })),
      })).toThrow(VersionControlError);
    }
  });

  it('object path の symlink を拒否する（Windows の権限不足時は skip）', (context) => {
    const root = tempRoot();
    initDemo(root);
    const written = writeVersionObject({
      rootDir: root, projectName: 'demo', type: 'blob', payload: Buffer.from('link'),
    });
    const objectPath = path.join(root, 'spec', 'demo', '.jskim', 'version', 'objects', written.hash.slice(0, 2), written.hash.slice(2));
    const target = `${objectPath}.target`;
    fs.renameSync(objectPath, target);
    try {
      fs.symlinkSync(target, objectPath, 'file');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') {
        context.skip();
        return;
      }
      throw error;
    }
    expect(() => readVersionObject({ rootDir: root, projectName: 'demo', hash: written.hash })).toThrow(/シンボリックリンク/);
    expect(() => writeVersionObject({
      rootDir: root, projectName: 'demo', type: 'blob', payload: Buffer.from('link'),
    })).toThrow(/シンボリックリンク/);
  });

  it('empty blob の golden hash', () => {
    const hash = hashVersionObject('blob', Buffer.alloc(0));
    const encoded = Buffer.concat([
      Buffer.from('blob 0\0', 'utf8'),
      Buffer.alloc(0),
    ]);
    expect(hash).toBe(crypto.createHash('sha256').update(encoded).digest('hex'));
    expect(hash).toBe(
      '473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813',
    );
  });

  it('type separation: 同じ payload でも type が違えば hash が違う', () => {
    const payload = Buffer.from('{"formatVersion":"1.0","entries":[]}', 'utf8');
    // tree は validate 経由なので正規オブジェクトを使う
    const treeHash = hashVersionObject('tree', {
      formatVersion: '1.0',
      entries: [],
    });
    const blobHash = hashVersionObject('blob', payload);
    expect(treeHash).not.toBe(blobHash);
  });

  it('tree / commit / tag の encode・write・read roundtrip', () => {
    const root = tempRoot();
    initDemo(root);
    const blob = writeVersionObject({
      rootDir: root,
      projectName: 'demo',
      type: 'blob',
      payload: Buffer.from('hello-画面', 'utf8'),
    });
    const tree: TreeObject = {
      formatVersion: '1.0',
      entries: [
        { name: 'b.txt', objectType: 'blob', hash: blob.hash },
        { name: 'a.txt', objectType: 'blob', hash: blob.hash },
      ],
    };
    const treeWrite = writeVersionObject({
      rootDir: root,
      projectName: 'demo',
      type: 'tree',
      payload: tree,
    });
    const commit: CommitObject = {
      formatVersion: '1.0',
      tree: treeWrite.hash,
      parents: [],
      author: { name: '設計', email: 'a@example.com' },
      committer: { name: '設計', email: 'a@example.com' },
      committedAt: '2026-07-20T01:02:03.000Z',
      message: '初期',
    };
    const commitWrite = writeVersionObject({
      rootDir: root,
      projectName: 'demo',
      type: 'commit',
      payload: commit,
    });
    const tag: TagObject = {
      formatVersion: '1.0',
      object: commitWrite.hash,
      objectType: 'commit',
      name: 'review-2026-07-20',
      tagger: { name: '設計', email: 'a@example.com' },
      taggedAt: '2026-07-20T01:02:03.000Z',
      message: 'レビュー',
    };
    const tagWrite = writeVersionObject({
      rootDir: root,
      projectName: 'demo',
      type: 'tag',
      payload: tag,
    });

    const readCommit = readVersionObject({
      rootDir: root,
      projectName: 'demo',
      hash: commitWrite.hash,
      expectedType: 'commit',
    });
    expect(JSON.parse(readCommit.payload.toString('utf8')).message).toBe('初期');
    expect(
      hasVersionObject({
        rootDir: root,
        projectName: 'demo',
        hash: tagWrite.hash,
      }),
    ).toBe(true);

    // tree entries は name 昇順で canonical
    const readTree = readVersionObject({
      rootDir: root,
      projectName: 'demo',
      hash: treeWrite.hash,
      expectedType: 'tree',
    });
    const treeJson = JSON.parse(readTree.payload.toString('utf8')) as TreeObject;
    expect(treeJson.entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt']);
  });

  it('deduplication と同時 write', async () => {
    const root = tempRoot();
    initDemo(root);
    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        Promise.resolve(
          writeVersionObject({
            rootDir: root,
            projectName: 'demo',
            type: 'blob',
            payload,
          }),
        ),
      ),
    );
    const hashes = new Set(results.map((r) => r.hash));
    expect(hashes.size).toBe(1);
    expect(results.some((r) => r.status === 'created')).toBe(true);
    expect(results.filter((r) => r.status === 'unchanged').length).toBeGreaterThan(
      0,
    );
  });

  it('無い object / invalid hash / tamper を検出する', () => {
    const root = tempRoot();
    initDemo(root);
    const written = writeVersionObject({
      rootDir: root,
      projectName: 'demo',
      type: 'blob',
      payload: Buffer.from('x'),
    });
    try {
      readVersionObject({
        rootDir: root,
        projectName: 'demo',
        hash: 'a'.repeat(64),
      });
      expect.fail('should throw');
    } catch (err) {
      expect((err as VersionControlError).code).toBe(
        'SPEC_VERSION_OBJECT_NOT_FOUND',
      );
    }
    try {
      readVersionObject({
        rootDir: root,
        projectName: 'demo',
        hash: 'ZZ',
      });
      expect.fail('should throw');
    } catch (err) {
      expect((err as VersionControlError).code).toBe('SPEC_VERSION_INVALID_HASH');
    }

    const objPath = path.join(
      root,
      'spec',
      'demo',
      '.jskim',
      'version',
      'objects',
      written.hash.slice(0, 2),
      written.hash.slice(2),
    );
    fs.writeFileSync(objPath, Buffer.from('blob 1\0y'));
    try {
      readVersionObject({
        rootDir: root,
        projectName: 'demo',
        hash: written.hash,
      });
      expect.fail('should throw');
    } catch (err) {
      expect((err as VersionControlError).code).toBe(
        'SPEC_VERSION_OBJECT_HASH_MISMATCH',
      );
    }
  });

  it('不正な tree name / commit parent / tag name を拒否する', () => {
    expect(() =>
      hashVersionObject('tree', {
        formatVersion: '1.0',
        entries: [
          {
            name: '../x',
            objectType: 'blob',
            hash: 'a'.repeat(64),
          },
        ],
      }),
    ).toThrow(VersionControlError);

    expect(() =>
      hashVersionObject('commit', {
        formatVersion: '1.0',
        tree: 'a'.repeat(64),
        parents: ['a'.repeat(64), 'a'.repeat(64)],
        author: { name: 'a', email: '' },
        committer: { name: 'a', email: '' },
        committedAt: '2026-07-20T00:00:00.000Z',
        message: 'm',
      }),
    ).toThrow(VersionControlError);

    expect(() =>
      hashVersionObject('tag', {
        formatVersion: '1.0',
        object: 'a'.repeat(64),
        objectType: 'commit',
        name: '../bad',
        tagger: { name: 'a', email: '' },
        taggedAt: '2026-07-20T00:00:00.000Z',
        message: 'm',
      }),
    ).toThrow(VersionControlError);
  });

  it('temp 残骸を残さない', () => {
    const root = tempRoot();
    initDemo(root);
    writeVersionObject({
      rootDir: root,
      projectName: 'demo',
      type: 'blob',
      payload: Buffer.from('clean'),
    });
    const objectsRoot = path.join(
      root,
      'spec',
      'demo',
      '.jskim',
      'version',
      'objects',
    );
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) out.push(...walk(p));
        else out.push(ent.name);
      }
      return out;
    };
    expect(walk(objectsRoot).every((n) => !n.includes('.tmp'))).toBe(true);
  });
});
