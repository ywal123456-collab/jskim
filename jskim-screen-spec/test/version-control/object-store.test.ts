import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  VersionControlError,
  hashVersionObject,
  hasVersionObject,
  initVersionRepository,
  readVersionObject,
  writeVersionObject,
  type CommitObject,
  type TagObject,
  type TreeObject,
} from '../../src/version-control/index.js';

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
