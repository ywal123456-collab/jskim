import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  VersionControlError,
  createWorkingSnapshot,
  getVersionStatus,
  initVersionRepository,
  stageFeature,
  stageProject,
  stageScreen,
} from '../../src/version-control/index.js';

const temps: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-snapshot-'));
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

function writeReference(root: string, project: string, screenId: string): void {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
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

type ProjectCtx = { rootDir: string; projectName: string };

function buildProject(
  options: {
    root?: string;
    project?: string;
    screens?: string[];
    features?: boolean;
    reference?: boolean;
  } = {},
): ProjectCtx {
  const rootDir = options.root ?? tempRoot();
  const projectName = options.project ?? 'demo';
  const screens = options.screens ?? ['a'];
  for (const id of screens) writeScreen(rootDir, projectName, id);
  if (options.features) {
    writeJson(path.join(rootDir, 'spec', projectName, 'src', 'features.json'), {
      schemaVersion: '1.0',
      features: [
        {
          featureId: 'main',
          name: 'メイン',
          displayOrder: 1,
          screenIds: [screens[0]],
        },
      ],
    });
  }
  if (options.reference) writeReference(rootDir, projectName, screens[0]);
  return { rootDir, projectName };
}

function objectCount(rootDir: string, projectName: string): number {
  const objects = path.join(
    rootDir,
    'spec',
    projectName,
    '.jskim',
    'version',
    'objects',
  );
  if (!fs.existsSync(objects)) return 0;
  const walk = (dir: string): number =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .reduce(
        (count, entry) =>
          count +
          (entry.isDirectory() ? walk(path.join(dir, entry.name)) : 1),
        0,
      );
  return walk(objects);
}

describe('working snapshot and staging', () => {
  it('同一 project copy は同じ rootTreeHash になる', () => {
    const first = buildProject({ reference: true });
    const second = buildProject({ reference: true });
    expect(createWorkingSnapshot(first).rootTreeHash).toBe(
      createWorkingSnapshot(second).rootTreeHash,
    );
  });

  it('createWorkingSnapshot は objects と index を作成しない', () => {
    const project = buildProject();
    createWorkingSnapshot(project);
    const version = path.join(
      project.rootDir,
      'spec',
      project.projectName,
      '.jskim',
      'version',
    );
    expect(fs.existsSync(path.join(version, 'objects'))).toBe(false);
    expect(fs.existsSync(path.join(version, 'index.json'))).toBe(false);
  });

  it('mtime だけの変更は hash を変えない', () => {
    const project = buildProject();
    const file = path.join(
      project.rootDir,
      'spec',
      project.projectName,
      'src',
      'data',
      'a.json',
    );
    const before = createWorkingSnapshot(project).rootTreeHash;
    const content = fs.readFileSync(file);
    fs.writeFileSync(file, content);
    try {
      fs.utimesSync(file, new Date(), new Date(Date.now() + 10_000));
    } catch {
      /* platform best effort */
    }
    expect(createWorkingSnapshot(project).rootTreeHash).toBe(before);
  });

  it('screen と features の内容変更は hash を変える', () => {
    const project = buildProject({ features: true });
    const before = createWorkingSnapshot(project).rootTreeHash;
    writeScreen(project.rootDir, project.projectName, 'a', '変更後');
    expect(createWorkingSnapshot(project).rootTreeHash).not.toBe(before);
    const afterScreen = createWorkingSnapshot(project).rootTreeHash;
    writeJson(
      path.join(
        project.rootDir,
        'spec',
        project.projectName,
        'src',
        'features.json',
      ),
      {
        schemaVersion: '1.0',
        features: [
          {
            featureId: 'main',
            name: '更新',
            displayOrder: 1,
            screenIds: ['a'],
          },
        ],
      },
    );
    expect(createWorkingSnapshot(project).rootTreeHash).not.toBe(afterScreen);
  });

  it('init 後 status は unborn・unstaged additions で object を書かない', () => {
    const project = buildProject();
    initVersionRepository(project);
    const before = objectCount(project.rootDir, project.projectName);
    const status = getVersionStatus(project);
    expect(status.unborn).toBe(true);
    expect(status.stagedChanges).toEqual([]);
    expect(status.unstagedChanges.length).toBeGreaterThan(0);
    expect(objectCount(project.rootDir, project.projectName)).toBe(before);
  });

  it('stageProject 後は index と working が一致する', () => {
    const project = buildProject();
    initVersionRepository(project);
    stageProject(project);
    const status = getVersionStatus(project);
    expect(
      fs.existsSync(
        path.join(
          project.rootDir,
          'spec',
          project.projectName,
          '.jskim',
          'version',
          'index.json',
        ),
      ),
    ).toBe(true);
    expect(status.workingTree).toBe(status.indexTree);
    expect(status.unstagedChanges).toEqual([]);
    // unborn HEAD では staged に全追加が残るため clean ではない
    expect(status.clean).toBe(false);
    expect(status.stagedChanges.length).toBeGreaterThan(0);
  });

  it('stageScreen は選択画面だけを stage する', () => {
    const project = buildProject({ screens: ['a', 'b'] });
    initVersionRepository(project);
    stageProject(project);
    writeScreen(project.rootDir, project.projectName, 'a', 'A変更');
    writeScreen(project.rootDir, project.projectName, 'b', 'B変更');
    stageScreen({ ...project, screenId: 'a' });
    const status = getVersionStatus(project);
    expect(
      status.unstagedChanges.some((change) =>
        change.path.startsWith('screens/b/'),
      ),
    ).toBe(true);
    expect(
      status.unstagedChanges.some((change) =>
        change.path.startsWith('screens/a/'),
      ),
    ).toBe(false);
  });

  it('stageFeature は features.json 全体を stage する', () => {
    const project = buildProject({ features: true });
    initVersionRepository(project);
    const result = stageFeature({ ...project, featureId: 'main' });
    expect(result.featuresJsonFullyStaged).toBe(true);
    expect(
      getVersionStatus(project).unstagedChanges.some(
        (change) => change.path === 'features.json',
      ),
    ).toBe(false);
  });

  it('expectedIndexRevision の競合を検出する', () => {
    const project = buildProject();
    initVersionRepository(project);
    stageProject(project);
    try {
      stageProject({ ...project, expectedIndexRevision: '0'.repeat(64) });
      expect.fail('should throw');
    } catch (error) {
      expect((error as VersionControlError).code).toBe(
        'SPEC_VERSION_INDEX_CONFLICT',
      );
    }
  });

  it('同時 stage は破損せず lock を残さない', async () => {
    const project = buildProject();
    initVersionRepository(project);
    const results = await Promise.allSettled([
      Promise.resolve().then(() => stageProject(project)),
      Promise.resolve().then(() => stageProject(project)),
    ]);
    expect(
      results.every(
        (result) =>
          result.status === 'fulfilled' ||
          (result.reason as VersionControlError).code ===
            'SPEC_VERSION_INDEX_IN_PROGRESS',
      ),
    ).toBe(true);
    const locks = path.join(
      project.rootDir,
      'spec',
      project.projectName,
      '.jskim',
      'version',
      'locks',
    );
    expect(
      fs.readdirSync(locks).filter((name) => name.includes('index')).length,
    ).toBe(0);
    expect(getVersionStatus(project).workingTree).toBe(
      getVersionStatus(project).indexTree,
    );
  });

  it('getVersionStatus は object file count を増やさない', () => {
    const project = buildProject();
    initVersionRepository(project);
    stageProject(project);
    const before = objectCount(project.rootDir, project.projectName);
    getVersionStatus(project);
    expect(objectCount(project.rootDir, project.projectName)).toBe(before);
  });
});
