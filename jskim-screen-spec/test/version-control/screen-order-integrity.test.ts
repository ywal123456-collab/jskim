import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FeatureError } from '../../src/features/index.js';
import {
  VersionControlError,
  createWorkingSnapshot,
  getVersionStatus,
  initVersionRepository,
  readVersionIndex,
  stageFeature,
  stageProject,
  stageScreen,
  writeVersionObject,
} from '../../src/version-control/index.js';
import { flattenSnapshotTree } from '../../src/version-control/status.js';

const temps: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-7e2-fix-'));
  temps.push(root);
  return root;
}

afterEach(() => {
  while (temps.length > 0) {
    const root = temps.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeScreen(
  root: string,
  project: string,
  id: string,
  label = id,
): void {
  writeJson(path.join(root, 'src', project, 'pages', `${id}.spec.json`), {
    schemaVersion: '1.0',
    screen: { id, path: `/${id}` },
    states: [{ id: 'default', name: 'Default' }],
    interactions: [],
  });
  writeJson(path.join(root, 'spec', project, 'src', 'data', `${id}.json`), {
    schemaVersion: '1.2',
    screen: { id, name: label },
    itemOrder: [],
    excludedItems: {},
    items: {},
  });
}

function tinyPng(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

function writeReference(root: string, project: string, screenId: string): void {
  const png = tinyPng();
  const hex = crypto.createHash('sha256').update(png).digest('hex');
  const dir = path.join(
    root,
    'spec',
    project,
    'src',
    'references',
    screenId,
    'pc',
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `reference-${hex}.png`), png);
  writeJson(path.join(dir, 'meta.json'), {
    schemaVersion: '1.0',
    screenId,
    viewport: { id: 'pc', width: 1, height: 1 },
    format: 'png',
    imageFile: `reference-${hex}.png`,
    imageRevision: `sha256:${hex}`,
    imageWidth: 1,
    imageHeight: 1,
    uploadedAt: '2026-07-20T01:02:03.000Z',
    source: { type: 'upload' },
  });
}

function projectJson(
  snap: ReturnType<typeof createWorkingSnapshot>,
): { screenOrder: string[]; projectName: string } {
  const flat = flattenSnapshotTree(snap);
  const hash = flat.get('project.json')?.hash;
  if (!hash) throw new Error('no project.json');
  const obj = snap.objects.get(hash);
  if (!obj) throw new Error('no object');
  const nul = obj.encoded.indexOf(0);
  return JSON.parse(obj.encoded.subarray(nul + 1).toString('utf8')) as {
    screenOrder: string[];
    projectName: string;
  };
}

function build(options: {
  screens?: string[];
  features?: boolean;
  reference?: boolean;
} = {}) {
  const rootDir = tempRoot();
  const projectName = 'demo';
  const screens = options.screens ?? ['wizard-input', 'crud-create'];
  // 意図的に非 lexical な作成順
  for (const id of screens) writeScreen(rootDir, projectName, id);
  if (options.features) {
    writeJson(path.join(rootDir, 'spec', projectName, 'src', 'features.json'), {
      schemaVersion: '1.0',
      features: [
        {
          featureId: 'fa',
          name: 'A',
          displayOrder: 1,
          screenIds: [screens[0]],
        },
      ],
    });
  }
  if (options.reference) writeReference(rootDir, projectName, screens[0]);
  return { rootDir, projectName };
}

describe('project.json.screenOrder', () => {
  it('screenOrder は localeCompare en 順で保存され（作成順に依存しない）', () => {
    const first = build({
      screens: ['wizard-input', 'crud-create', 'alpha-screen'],
    });
    const secondRoot = tempRoot();
    for (const id of ['alpha-screen', 'crud-create', 'wizard-input']) {
      writeScreen(secondRoot, 'demo', id);
    }
    const a = createWorkingSnapshot(first);
    const b = createWorkingSnapshot({
      rootDir: secondRoot,
      projectName: 'demo',
    });
    expect(projectJson(a).screenOrder).toEqual([
      'alpha-screen',
      'crud-create',
      'wizard-input',
    ]);
    expect(a.rootTreeHash).toBe(b.rootTreeHash);
  });

  it('screenOrder 変更で root hash が変わる', () => {
    // screenOrder は canonical sort 固定のため、集合変更で hash 変化を見る
    const p = build({ screens: ['a', 'b'] });
    const before = createWorkingSnapshot(p).rootTreeHash;
    writeScreen(p.rootDir, p.projectName, 'c');
    expect(createWorkingSnapshot(p).rootTreeHash).not.toBe(before);
  });

  it('Feature 無しでも Ungrouped 順序を再現できる', () => {
    const p = build({ screens: ['z-screen', 'a-screen'] });
    const order = projectJson(createWorkingSnapshot(p)).screenOrder;
    expect(order).toEqual(['a-screen', 'z-screen']);
  });
});

describe('stageScreen と project.json', () => {
  it('新 screen stage で screenOrder に追加し他 screen 内容は触らない', () => {
    const p = build({ screens: ['a', 'c'] });
    initVersionRepository(p);
    stageProject(p);
    writeScreen(p.rootDir, p.projectName, 'b');
    writeScreen(p.rootDir, p.projectName, 'c', 'C-changed');
    stageScreen({ ...p, screenId: 'b' });
    const st = getVersionStatus(p);
    expect(
      st.unstagedChanges.some((c) => c.path.startsWith('screens/c/')),
    ).toBe(true);
    expect(
      st.unstagedChanges.some((c) => c.path.startsWith('screens/b/')),
    ).toBe(false);
    const snap = createWorkingSnapshot(p);
    // index 側 screenOrder は status の staged 経由で確認: working と index の project.json
    expect(projectJson(snap).screenOrder).toContain('b');
  });

  it('screen 削除は screenOrder から除去する', () => {
    const p = build({ screens: ['a', 'b'] });
    initVersionRepository(p);
    stageProject(p);
    fs.rmSync(path.join(p.rootDir, 'spec', 'demo', 'src', 'data', 'a.json'));
    fs.rmSync(path.join(p.rootDir, 'src', 'demo', 'pages', 'a.spec.json'));
    stageScreen({ ...p, screenId: 'a' });
    const st = getVersionStatus(p);
    expect(
      st.unstagedChanges.some((c) => c.path.startsWith('screens/a/')),
    ).toBe(false);
    expect(createWorkingSnapshot(p).screens).toEqual(['b']);
  });

  it('Feature membership が残る削除は拒否する', () => {
    const p = build({ screens: ['a', 'b'], features: true });
    initVersionRepository(p);
    stageProject(p);
    fs.rmSync(path.join(p.rootDir, 'spec', 'demo', 'src', 'data', 'a.json'));
    fs.rmSync(path.join(p.rootDir, 'src', 'demo', 'pages', 'a.spec.json'));
    // features.json は a を参照したまま → snapshot 検証で UNKNOWN_SCREEN
    try {
      stageScreen({ ...p, screenId: 'a' });
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(FeatureError);
      expect((e as FeatureError).code).toBe('SPEC_FEATURE_UNKNOWN_SCREEN');
    }
  });
});

describe('Feature と screenOrder', () => {
  it('Ungrouped→Feature でも screenOrder から欠落しない', () => {
    const p = build({ screens: ['a', 'b'] });
    initVersionRepository(p);
    stageProject(p);
    const before = projectJson(createWorkingSnapshot(p)).screenOrder;
    writeJson(path.join(p.rootDir, 'spec', 'demo', 'src', 'features.json'), {
      schemaVersion: '1.0',
      features: [
        {
          featureId: 'fa',
          name: 'A',
          displayOrder: 1,
          screenIds: ['a'],
        },
      ],
    });
    stageFeature({ ...p, featureId: 'fa' });
    const after = projectJson(createWorkingSnapshot(p)).screenOrder;
    expect(after).toEqual(before);
    expect(
      getVersionStatus(p).unstagedChanges.some(
        (c) => c.path === 'project.json',
      ),
    ).toBe(false);
  });
});

describe('index reachable integrity', () => {
  it('root tree object 欠落は INDEX_CORRUPT', () => {
    const p = build();
    initVersionRepository(p);
    stageProject(p);
    const idx = readVersionIndex(p);
    const objPath = path.join(
      p.rootDir,
      'spec',
      'demo',
      '.jskim',
      'version',
      'objects',
      idx.tree.slice(0, 2),
      idx.tree.slice(2),
    );
    fs.unlinkSync(objPath);
    try {
      readVersionIndex(p);
      expect.fail('should throw');
    } catch (e) {
      expect((e as VersionControlError).code).toBe('SPEC_VERSION_INDEX_CORRUPT');
    }
  });

  it('child blob 欠落は INDEX_CORRUPT', () => {
    const p = build();
    initVersionRepository(p);
    stageProject(p);
    const idx = readVersionIndex(p);
    const snap = createWorkingSnapshot(p);
    const flat = flattenSnapshotTree(snap);
    const desc = flat.get('screens/crud-create/description.json')
      || flat.get('screens/wizard-input/description.json');
    if (!desc) throw new Error('no description');
    // persist 済み hash のファイルを消す
    const objPath = path.join(
      p.rootDir,
      'spec',
      'demo',
      '.jskim',
      'version',
      'objects',
      desc.hash.slice(0, 2),
      desc.hash.slice(2),
    );
    if (fs.existsSync(objPath)) fs.unlinkSync(objPath);
    try {
      readVersionIndex(p);
      expect.fail('should throw');
    } catch (e) {
      expect((e as VersionControlError).code).toBe('SPEC_VERSION_INDEX_CORRUPT');
    }
  });

  it('正常 index は読める', () => {
    const p = build();
    initVersionRepository(p);
    stageProject(p);
    expect(readVersionIndex(p).virtual).toBe(false);
  });
});

describe('HEAD 変更時の stage 拒否', () => {
  it('baseCommit 以降に HEAD が進むと stage を拒否し index を維持する', () => {
    const p = build();
    initVersionRepository(p);
    stageProject(p);
    const idxPath = path.join(
      p.rootDir,
      'spec',
      'demo',
      '.jskim',
      'version',
      'index.json',
    );
    const before = fs.readFileSync(idxPath);
    const idx = readVersionIndex(p);

    const commit = {
      formatVersion: '1.0' as const,
      tree: idx.tree,
      parents: [] as string[],
      author: { name: 't', email: 't@example.com' },
      committer: { name: 't', email: 't@example.com' },
      committedAt: '2026-07-20T01:02:03.000Z',
      message: 'x',
    };
    const written = writeVersionObject({
      ...p,
      type: 'commit',
      payload: commit,
    });
    const refPath = path.join(
      p.rootDir,
      'spec',
      'demo',
      '.jskim',
      'version',
      'refs',
      'heads',
      'main',
    );
    fs.mkdirSync(path.dirname(refPath), { recursive: true });
    fs.writeFileSync(refPath, `${written.hash}\n`);

    try {
      stageProject(p);
      expect.fail('should throw');
    } catch (e) {
      expect((e as VersionControlError).code).toBe('SPEC_VERSION_HEAD_CHANGED');
    }
    expect(Buffer.compare(before, fs.readFileSync(idxPath))).toBe(0);
    const locks = path.join(
      p.rootDir,
      'spec',
      'demo',
      '.jskim',
      'version',
      'locks',
    );
    expect(
      fs.readdirSync(locks).filter((n) => n.includes('index')).length,
    ).toBe(0);
  });
});

describe('PNG signature', () => {
  it('正常 Reference PNG を受け入れる', () => {
    const p = build({ screens: ['a'], reference: true });
    expect(() => createWorkingSnapshot(p)).not.toThrow();
  });

  it('revision 一致でも non-PNG は拒否する', () => {
    const p = build({ screens: ['a'] });
    const fake = Buffer.from('not-a-png-but-stable-bytes!!');
    const hex = crypto.createHash('sha256').update(fake).digest('hex');
    const dir = path.join(
      p.rootDir,
      'spec',
      'demo',
      'src',
      'references',
      'a',
      'pc',
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `reference-${hex}.png`), fake);
    writeJson(path.join(dir, 'meta.json'), {
      schemaVersion: '1.0',
      screenId: 'a',
      viewport: { id: 'pc', width: 1, height: 1 },
      format: 'png',
      imageFile: `reference-${hex}.png`,
      imageRevision: `sha256:${hex}`,
      imageWidth: 1,
      imageHeight: 1,
      uploadedAt: '2026-07-20T01:02:03.000Z',
      source: { type: 'upload' },
    });
    expect(() => createWorkingSnapshot(p)).toThrow(VersionControlError);
  });

  it('短すぎる bytes は拒否する', () => {
    const p = build({ screens: ['a'] });
    const fake = Buffer.from([0x89, 0x50]);
    const hex = crypto.createHash('sha256').update(fake).digest('hex');
    const dir = path.join(
      p.rootDir,
      'spec',
      'demo',
      'src',
      'references',
      'a',
      'pc',
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `reference-${hex}.png`), fake);
    writeJson(path.join(dir, 'meta.json'), {
      schemaVersion: '1.0',
      screenId: 'a',
      viewport: { id: 'pc', width: 1, height: 1 },
      format: 'png',
      imageFile: `reference-${hex}.png`,
      imageRevision: `sha256:${hex}`,
      imageWidth: 1,
      imageHeight: 1,
      uploadedAt: '2026-07-20T01:02:03.000Z',
      source: { type: 'upload' },
    });
    expect(() => createWorkingSnapshot(p)).toThrow(VersionControlError);
  });
});
