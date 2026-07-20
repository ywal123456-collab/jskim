import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  VersionControlError,
  initVersionRepository,
} from '../../src/version-control/index.js';

const temps: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-vc-init-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('initVersionRepository', () => {
  it('新規 repository を作成し unborn main にする', () => {
    const root = tempRoot();
    const result = initVersionRepository({
      rootDir: root,
      projectName: 'demo',
    });
    expect(result.status).toBe('created');
    expect(result.repositoryRelativePath).toBe(
      'spec/demo/.jskim/version',
    );
    expect(result.headRef).toBe('refs/heads/main');

    const repo = path.join(root, 'spec', 'demo', '.jskim', 'version');
    expect(fs.existsSync(path.join(repo, 'format.json'))).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'HEAD'), 'utf8').trim()).toBe(
      'ref: refs/heads/main',
    );
    for (const sub of ['objects', 'refs/heads', 'refs/tags', 'locks']) {
      expect(fs.existsSync(path.join(repo, ...sub.split('/')))).toBe(true);
    }
    expect(fs.existsSync(path.join(repo, 'refs', 'heads', 'main'))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(root, 'spec', 'demo', 'src', 'features.json'))).toBe(
      false,
    );
  });

  it('再実行は idempotent で existing', () => {
    const root = tempRoot();
    initVersionRepository({ rootDir: root, projectName: 'demo' });
    const second = initVersionRepository({
      rootDir: root,
      projectName: 'demo',
    });
    expect(second.status).toBe('existing');
  });

  it('同時 init でも壊さない', async () => {
    const root = tempRoot();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        Promise.resolve(
          initVersionRepository({ rootDir: root, projectName: 'demo' }),
        ),
      ),
    );
    expect(results.some((r) => r.status === 'created')).toBe(true);
    expect(results.every((r) => r.headRef === 'refs/heads/main')).toBe(true);
    const format = JSON.parse(
      fs.readFileSync(
        path.join(root, 'spec', 'demo', '.jskim', 'version', 'format.json'),
        'utf8',
      ),
    ) as { repositoryFormatVersion: string; hashAlgorithm: string };
    expect(format.repositoryFormatVersion).toBe('1.0');
    expect(format.hashAlgorithm).toBe('sha256');
  });

  it('unsupported format / corrupt format / path が file のときエラー', () => {
    const root = tempRoot();
    const repo = path.join(root, 'spec', 'demo', '.jskim', 'version');
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'format.json'),
      JSON.stringify({
        repositoryFormatVersion: '9.0',
        hashAlgorithm: 'sha256',
      }),
    );
    fs.writeFileSync(path.join(repo, 'HEAD'), 'ref: refs/heads/main\n');
    try {
      initVersionRepository({ rootDir: root, projectName: 'demo' });
      expect.fail('should throw');
    } catch (err) {
      expect((err as VersionControlError).code).toBe(
        'SPEC_VERSION_UNSUPPORTED_FORMAT',
      );
    }

    const root2 = tempRoot();
    const repo2 = path.join(root2, 'spec', 'demo', '.jskim', 'version');
    fs.mkdirSync(repo2, { recursive: true });
    fs.writeFileSync(path.join(repo2, 'format.json'), '{broken');
    fs.writeFileSync(path.join(repo2, 'HEAD'), 'ref: refs/heads/main\n');
    try {
      initVersionRepository({ rootDir: root2, projectName: 'demo' });
      expect.fail('should throw');
    } catch (err) {
      expect((err as VersionControlError).code).toBe(
        'SPEC_VERSION_REPOSITORY_CORRUPT',
      );
    }

    const root3 = tempRoot();
    const filePath = path.join(root3, 'spec', 'demo', '.jskim', 'version');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'not-a-dir');
    try {
      initVersionRepository({ rootDir: root3, projectName: 'demo' });
      expect.fail('should throw');
    } catch (err) {
      expect((err as VersionControlError).code).toBe('SPEC_VERSION_INIT_FAILED');
    }
  });

  it('既存 object を消さない', () => {
    const root = tempRoot();
    initVersionRepository({ rootDir: root, projectName: 'demo' });
    const marker = path.join(
      root,
      'spec',
      'demo',
      '.jskim',
      'version',
      'objects',
      'ab',
      'keep',
    );
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, 'x');
    initVersionRepository({ rootDir: root, projectName: 'demo' });
    expect(fs.existsSync(marker)).toBe(true);
  });

  it('directory のみから初期化を完了する', () => {
    const root = tempRoot();
    const repo = path.join(root, 'spec', 'demo', '.jskim', 'version');
    fs.mkdirSync(repo, { recursive: true });
    expect(initVersionRepository({ rootDir: root, projectName: 'demo' }).status).toBe('created');
    expect(fs.existsSync(path.join(repo, 'format.json'))).toBe(true);
    expect(fs.existsSync(path.join(repo, 'HEAD'))).toBe(true);
  });

  it('valid な format.json のみなら HEAD を補完する', () => {
    const root = tempRoot();
    const repo = path.join(root, 'spec', 'demo', '.jskim', 'version');
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, 'format.json'), JSON.stringify({
      repositoryFormatVersion: '1.0', hashAlgorithm: 'sha256',
    }));
    initVersionRepository({ rootDir: root, projectName: 'demo' });
    expect(fs.readFileSync(path.join(repo, 'HEAD'), 'utf8').trim()).toBe('ref: refs/heads/main');
  });

  it('unborn main の HEAD のみなら format.json を補完する', () => {
    const root = tempRoot();
    const repo = path.join(root, 'spec', 'demo', '.jskim', 'version');
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, 'HEAD'), 'ref: refs/heads/main\n');
    initVersionRepository({ rootDir: root, projectName: 'demo' });
    expect(JSON.parse(fs.readFileSync(path.join(repo, 'format.json'), 'utf8'))).toMatchObject({
      repositoryFormatVersion: '1.0', hashAlgorithm: 'sha256',
    });
  });

  it('metadata は正常で locks が無ければ directory を補完する', () => {
    const root = tempRoot();
    initVersionRepository({ rootDir: root, projectName: 'demo' });
    const locks = path.join(root, 'spec', 'demo', '.jskim', 'version', 'locks');
    fs.rmSync(locks, { recursive: true });
    expect(initVersionRepository({ rootDir: root, projectName: 'demo' }).status).toBe('existing');
    expect(fs.existsSync(locks)).toBe(true);
  });

  it('破損 format.json を上書きしない', () => {
    const root = tempRoot();
    const repo = path.join(root, 'spec', 'demo', '.jskim', 'version');
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, 'format.json'), '{broken');
    expect(() => initVersionRepository({ rootDir: root, projectName: 'demo' })).toThrow(VersionControlError);
    expect(fs.readFileSync(path.join(repo, 'format.json'), 'utf8')).toBe('{broken');
  });

  it('format.json のみで object があれば自動修復しない', () => {
    const root = tempRoot();
    const repo = path.join(root, 'spec', 'demo', '.jskim', 'version');
    fs.mkdirSync(path.join(repo, 'objects', 'ab'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'format.json'), JSON.stringify({
      repositoryFormatVersion: '1.0', hashAlgorithm: 'sha256',
    }));
    fs.writeFileSync(path.join(repo, 'objects', 'ab', 'object'), 'x');
    try {
      initVersionRepository({ rootDir: root, projectName: 'demo' });
      expect.fail('should throw');
    } catch (error) {
      expect((error as VersionControlError).code).toBe('SPEC_VERSION_REPOSITORY_CORRUPT');
    }
    expect(fs.existsSync(path.join(repo, 'HEAD'))).toBe(false);
  });
});
