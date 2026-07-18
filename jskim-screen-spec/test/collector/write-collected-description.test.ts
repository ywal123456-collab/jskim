import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeCollectedDescription } from '../../src/collector/write-collected-description.js';
import { writeFileAtomic } from '../../src/util/write-file-atomic.js';
import { loadScreenSpecProject } from '../../src/builder/load-screen-spec-project.js';

function writeDesc(
  filePath: string,
  doc: Record<string, unknown>,
): void {
  writeFileAtomic(filePath, `${JSON.stringify(doc, null, 2)}\n`);
}

describe('writeCollectedDescription: missing Description は作成しない', () => {
  it('Description ファイルが無い場合は written:false でファイルを作らない', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-wcd-miss-'));
    try {
      const filePath = path.join(root, 'impl-only.json');
      const result = writeCollectedDescription({
        filePath,
        screenId: 'impl-only',
        foundItemIds: ['a', 'b'],
      });
      expect(result.written).toBe(false);
      expect(result.attempts).toBe(0);
      expect(result.addedItemIds).toEqual([]);
      expect(fs.existsSync(filePath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('既存 Description がある場合は新規 item を merge し manual field を保全する', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-wcd-merge-'));
    try {
      const filePath = path.join(root, 'demo.json');
      writeDesc(filePath, {
        schemaVersion: '1.2',
        screen: { id: 'demo', name: '手動名', description: '手動説明' },
        itemOrder: ['title'],
        excludedItems: {},
        items: {
          title: {
            name: 'Title',
            type: 'text',
            description: '保持',
            note: '備考',
          },
        },
      });

      const result = writeCollectedDescription({
        filePath,
        screenId: 'demo',
        foundItemIds: ['title', 'new-item'],
      });
      expect(result.written).toBe(true);
      expect(result.addedItemIds).toEqual(['new-item']);

      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(saved.screen.name).toBe('手動名');
      expect(saved.screen.description).toBe('手動説明');
      expect(saved.items.title.description).toBe('保持');
      expect(saved.items.title.note).toBe('備考');
      expect(saved.itemOrder).toEqual(['title', 'new-item']);
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

  it('excludedItems の ID は再追加しない', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-wcd-ex-'));
    try {
      const filePath = path.join(root, 'demo.json');
      writeDesc(filePath, {
        schemaVersion: '1.2',
        screen: { id: 'demo', name: 'Demo', description: '' },
        itemOrder: ['title'],
        excludedItems: {
          layout: {
            name: '枠',
            type: 'container',
            description: '除外',
            note: '',
          },
        },
        items: {
          title: { name: 'T', type: 'text', description: '', note: '' },
        },
      });

      // 書式正規化後の再 collect（意味変更なし）でも layout は戻さない
      writeCollectedDescription({
        filePath,
        screenId: 'demo',
        foundItemIds: ['title', 'layout'],
      });
      const before = fs.readFileSync(filePath);
      const result = writeCollectedDescription({
        filePath,
        screenId: 'demo',
        foundItemIds: ['title', 'layout'],
      });
      expect(result.written).toBe(false);
      expect(result.addedItemIds).toEqual([]);
      expect(fs.readFileSync(filePath).equals(before)).toBe(true);

      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(saved.items.layout).toBeUndefined();
      expect(saved.itemOrder).not.toContain('layout');
      expect(saved.excludedItems.layout.name).toBe('枠');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('変更が無い場合は write しない', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-wcd-same-'));
    try {
      const filePath = path.join(root, 'demo.json');
      writeDesc(filePath, {
        schemaVersion: '1.2',
        screen: { id: 'demo', name: 'Demo', description: '' },
        itemOrder: ['title'],
        excludedItems: {},
        items: {
          title: { name: 'T', type: 'text', description: '', note: '' },
        },
      });
      // 初回で collector 書式へ揃えたあと、再実行は unchanged
      writeCollectedDescription({
        filePath,
        screenId: 'demo',
        foundItemIds: ['title'],
      });
      const before = fs.readFileSync(filePath);

      const result = writeCollectedDescription({
        filePath,
        screenId: 'demo',
        foundItemIds: ['title'],
      });
      expect(result.written).toBe(false);
      expect(fs.readFileSync(filePath).equals(before)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('1.0 で item 追加がある場合のみ 1.2 へ upgrade する', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-wcd-v10-'));
    try {
      const filePath = path.join(root, 'demo.json');
      writeDesc(filePath, {
        schemaVersion: '1.0',
        screen: { id: 'demo', name: 'Demo', description: '' },
        items: {
          title: { name: 'T', type: 'text', description: '', note: '' },
        },
      });

      const noChange = writeCollectedDescription({
        filePath,
        screenId: 'demo',
        foundItemIds: ['title'],
      });
      expect(noChange.written).toBe(false);
      expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).schemaVersion).toBe(
        '1.0',
      );

      const withAdd = writeCollectedDescription({
        filePath,
        screenId: 'demo',
        foundItemIds: ['title', 'extra'],
      });
      expect(withAdd.written).toBe(true);
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(saved.schemaVersion).toBe('1.2');
      expect(saved.itemOrder).toContain('extra');
      expect(saved.excludedItems).toEqual({});
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('LINKED Description を消したあと write しても再作成しない', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-wcd-rm-'));
    try {
      const filePath = path.join(root, 'demo.json');
      writeDesc(filePath, {
        schemaVersion: '1.2',
        screen: { id: 'demo', name: 'Demo', description: '' },
        itemOrder: ['title'],
        excludedItems: {},
        items: {
          title: { name: 'T', type: 'text', description: '', note: '' },
        },
      });
      fs.unlinkSync(filePath);

      const result = writeCollectedDescription({
        filePath,
        screenId: 'demo',
        foundItemIds: ['title'],
      });
      expect(result.written).toBe(false);
      expect(fs.existsSync(filePath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('missing Description の project 状態', () => {
  it('Source のみなら implementation-only のままである', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-wcd-status-'));
    try {
      const pagesDir = path.join(root, 'src', 'demo', 'pages');
      const dataDir = path.join(root, 'spec', 'demo', 'src', 'data');
      const snapDir = path.join(
        root,
        'spec',
        'demo',
        'src',
        'snapshots',
        'impl-only',
      );
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.mkdirSync(dataDir, { recursive: true });
      fs.mkdirSync(snapDir, { recursive: true });
      fs.writeFileSync(
        path.join(pagesDir, 'impl-only.spec.json'),
        `${JSON.stringify(
          {
            schemaVersion: '1.0',
            screen: { id: 'impl-only', path: '/' },
            states: [{ id: 'default', name: '初期' }],
            interactions: [],
          },
          null,
          2,
        )}\n`,
      );
      fs.writeFileSync(
        path.join(snapDir, 'default.html'),
        '<main data-jskim-spec-screen="impl-only"><span data-jskim-spec-item="title">t</span></main>\n',
      );

      const loaded = loadScreenSpecProject({
        rootDir: root,
        projectName: 'demo',
      });
      const screen = loaded.screens.find((s) => s.screenId === 'impl-only');
      expect(screen?.status).toBe('implementation-only');
      expect(fs.existsSync(path.join(dataDir, 'impl-only.json'))).toBe(false);

      // collect 経路相当の write を繰り返してもファイルは生まれない
      const descPath = path.join(dataDir, 'impl-only.json');
      writeCollectedDescription({
        filePath: descPath,
        screenId: 'impl-only',
        foundItemIds: ['title'],
      });
      writeCollectedDescription({
        filePath: descPath,
        screenId: 'impl-only',
        foundItemIds: ['title'],
      });
      expect(fs.existsSync(descPath)).toBe(false);

      const again = loadScreenSpecProject({
        rootDir: root,
        projectName: 'demo',
      });
      expect(
        again.screens.find((s) => s.screenId === 'impl-only')?.status,
      ).toBe('implementation-only');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
