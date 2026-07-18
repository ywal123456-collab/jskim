import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadScreenSpecProject } from '../../src/builder/load-screen-spec-project.js';

function createTempProject() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-union-'));
  const pagesDir = path.join(rootDir, 'src', 'demo', 'pages');
  const dataDir = path.join(rootDir, 'spec', 'demo', 'src', 'data');
  const snapshotsRoot = path.join(rootDir, 'spec', 'demo', 'src', 'snapshots');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(snapshotsRoot, { recursive: true });
  return { rootDir, pagesDir, dataDir, snapshotsRoot };
}

function writeSource(pagesDir: string, screenId: string) {
  fs.writeFileSync(
    path.join(pagesDir, `${screenId}.spec.json`),
    JSON.stringify({
      schemaVersion: '1.0',
      screen: { id: screenId, path: `/${screenId}/` },
      states: [{ id: 'default', name: 'default' }],
      interactions: [],
    }),
  );
}

function writeDescription(
  dataDir: string,
  screenId: string,
  overrides: Record<string, unknown> = {},
) {
  const doc = {
    schemaVersion: '1.0',
    screen: { id: screenId, name: screenId, description: '' },
    items: {},
    ...overrides,
  };
  fs.writeFileSync(path.join(dataDir, `${screenId}.json`), JSON.stringify(doc));
}

function writeSnapshot(snapshotsRoot: string, screenId: string, stateId: string) {
  const dir = path.join(snapshotsRoot, screenId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${stateId}.html`),
    '<html><body><div data-jskim-spec-item="item-a"></div></body></html>',
  );
}

describe('loadScreenSpecProject（Description∪Source union）', () => {
  it('Description のみの画面は design-only になる', () => {
    const { rootDir, dataDir } = createTempProject();
    try {
      writeDescription(dataDir, 'design-only-screen');
      const project = loadScreenSpecProject({ rootDir, projectName: 'demo' });

      expect(project.screens).toHaveLength(1);
      const screen = project.screens[0];
      expect(screen.screenId).toBe('design-only-screen');
      expect(screen.status).toBe('design-only');
      expect(screen.hasDescription).toBe(true);
      expect(screen.hasImplementation).toBe(false);
      expect(screen.hasPreview).toBe(false);
      expect(screen.source).toBeNull();
      expect(screen.sourcePath).toBeNull();
      expect(screen.description).not.toBeNull();
      expect(screen.snapshots).toEqual([]);
      expect(project.allDescriptionScreenIds.has('design-only-screen')).toBe(true);
      expect(project.allSourceScreenIds.has('design-only-screen')).toBe(false);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('Source のみの画面は implementation-only になる', () => {
    const { rootDir, pagesDir, snapshotsRoot } = createTempProject();
    try {
      writeSource(pagesDir, 'impl-only-screen');
      writeSnapshot(snapshotsRoot, 'impl-only-screen', 'default');
      const project = loadScreenSpecProject({ rootDir, projectName: 'demo' });

      expect(project.screens).toHaveLength(1);
      const screen = project.screens[0];
      expect(screen.status).toBe('implementation-only');
      expect(screen.hasDescription).toBe(false);
      expect(screen.hasImplementation).toBe(true);
      expect(screen.hasPreview).toBe(true);
      expect(screen.description).toBeNull();
      expect(screen.descriptionPath).toBeNull();
      expect(screen.source).not.toBeNull();
      expect(screen.snapshots).toHaveLength(1);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('Source と Description の両方がある画面は linked になる', () => {
    const { rootDir, pagesDir, dataDir, snapshotsRoot } = createTempProject();
    try {
      writeSource(pagesDir, 'linked-screen');
      writeDescription(dataDir, 'linked-screen');
      writeSnapshot(snapshotsRoot, 'linked-screen', 'default');
      const project = loadScreenSpecProject({ rootDir, projectName: 'demo' });

      expect(project.screens).toHaveLength(1);
      const screen = project.screens[0];
      expect(screen.status).toBe('linked');
      expect(screen.hasDescription).toBe(true);
      expect(screen.hasImplementation).toBe(true);
      expect(screen.hasPreview).toBe(true);
      expect(screen.source).not.toBeNull();
      expect(screen.description).not.toBeNull();
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('画面が 1 つも無くても throw せず空配列を返す', () => {
    const { rootDir } = createTempProject();
    try {
      const project = loadScreenSpecProject({ rootDir, projectName: 'demo' });
      expect(project.screens).toEqual([]);
      expect(project.allDescriptionScreenIds.size).toBe(0);
      expect(project.allSourceScreenIds.size).toBe(0);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('screenId 昇順（en locale）でソートされる', () => {
    const { rootDir, dataDir } = createTempProject();
    try {
      writeDescription(dataDir, 'zebra-screen');
      writeDescription(dataDir, 'alpha-screen');
      const project = loadScreenSpecProject({ rootDir, projectName: 'demo' });
      expect(project.screens.map((s) => s.screenId)).toEqual([
        'alpha-screen',
        'zebra-screen',
      ]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('隠しファイル・.tmp・.bak の Description は無視される', () => {
    const { rootDir, dataDir } = createTempProject();
    try {
      writeDescription(dataDir, 'visible-screen');
      fs.writeFileSync(path.join(dataDir, '.hidden-screen.json'), '{}');
      fs.writeFileSync(path.join(dataDir, 'backup-screen.json.bak'), '{}');
      fs.writeFileSync(
        path.join(dataDir, `.visible-screen.${process.pid}.123.tmp.json`),
        '{}',
      );
      const project = loadScreenSpecProject({ rootDir, projectName: 'demo' });
      expect(project.screens.map((s) => s.screenId)).toEqual(['visible-screen']);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('壊れた JSON は日本語エラーで throw する', () => {
    const { rootDir, dataDir } = createTempProject();
    try {
      fs.writeFileSync(path.join(dataDir, 'broken-screen.json'), '{ invalid json');
      expect(() => loadScreenSpecProject({ rootDir, projectName: 'demo' })).toThrow(
        /JSON の形式が不正です/,
      );
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('schemaVersion が "1.0" / "1.1" / "1.2" 以外なら throw する', () => {
    const { rootDir, dataDir } = createTempProject();
    try {
      writeDescription(dataDir, 'bad-version-screen', { schemaVersion: '2.0' });
      expect(() => loadScreenSpecProject({ rootDir, projectName: 'demo' })).toThrow(
        /schemaVersion/,
      );
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('schemaVersion "1.1"（itemOrder あり）を読み込める', () => {
    const { rootDir, dataDir } = createTempProject();
    try {
      writeDescription(dataDir, 'v11-screen', {
        schemaVersion: '1.1',
        itemOrder: ['b', 'a'],
        items: {
          a: { name: 'A', type: '', description: '', note: '' },
          b: { name: 'B', type: '', description: '', note: '' },
        },
      });
      const project = loadScreenSpecProject({ rootDir, projectName: 'demo' });
      const screen = project.screens.find((s) => s.screenId === 'v11-screen');
      expect(screen?.description?.schemaVersion).toBe('1.1');
      expect(screen?.description?.itemOrder).toEqual(['b', 'a']);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('schemaVersion "1.2"（excludedItems あり）を読み込める', () => {
    const { rootDir, dataDir } = createTempProject();
    try {
      writeDescription(dataDir, 'v12-screen', {
        schemaVersion: '1.2',
        itemOrder: ['a'],
        excludedItems: {
          layout: { name: '枠', type: '', description: '', note: '' },
        },
        items: {
          a: { name: 'A', type: '', description: '', note: '' },
        },
      });
      const project = loadScreenSpecProject({ rootDir, projectName: 'demo' });
      const screen = project.screens.find((s) => s.screenId === 'v12-screen');
      expect(screen?.description?.schemaVersion).toBe('1.2');
      expect(screen?.description?.excludedItems?.layout?.name).toBe('枠');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('screen.id がファイル名と一致しない場合は throw する', () => {
    const { rootDir, dataDir } = createTempProject();
    try {
      writeDescription(dataDir, 'file-name-screen', {
        screen: { id: 'different-id', name: 'x' },
      });
      expect(() => loadScreenSpecProject({ rootDir, projectName: 'demo' })).toThrow(
        /screen\.id はファイル名と一致する必要があります/,
      );
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('screenId が重複する Description が複数ある場合は throw する', () => {
    const { rootDir, dataDir } = createTempProject();
    try {
      const subDir = path.join(dataDir, 'nested');
      fs.mkdirSync(subDir, { recursive: true });
      writeDescription(dataDir, 'dup-screen');
      fs.writeFileSync(
        path.join(subDir, 'dup-screen.json'),
        JSON.stringify({
          schemaVersion: '1.0',
          screen: { id: 'dup-screen', name: 'dup' },
          items: {},
        }),
      );
      expect(() => loadScreenSpecProject({ rootDir, projectName: 'demo' })).toThrow(
        /screenId が重複しています/,
      );
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
