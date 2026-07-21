import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyUpdateScreen,
  readDescriptionRevision,
  updateDescriptionScreen,
} from '../../src/editing/description-document/index.js';
import { resetDescriptionScreenLocksForTest } from '../../src/editing/description-screen-lock.js';

const temps: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-desc-screen-'));
  temps.push(dir);
  fs.mkdirSync(path.join(dir, 'spec', 'demo', 'src', 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'spec', 'demo', '.jskim', 'description-mutation'), {
    recursive: true,
  });
  return dir;
}

function ctx(root: string) {
  return { rootDir: root, projectName: 'demo', screenId: 'demo-screen' };
}

function writeDescriptionFile(root: string, doc: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json'),
    `${JSON.stringify(doc, null, 2)}\n`,
    'utf8',
  );
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

describe('updateScreen domain', () => {
  it('screen metadata を更新し unchanged を返せる', () => {
    const normalized = {
      sourceSchemaVersion: '1.3' as const,
      screen: { id: 'demo-screen', name: 'Old', description: 'd' },
      rootNodes: [{ type: 'item' as const, id: 'item-a' }],
      groups: [],
      items: { 'item-a': { name: '', type: '', description: '', note: '' } },
      excludedItems: {},
    };
    const updated = applyUpdateScreen(normalized, { name: 'New' });
    expect(updated.status).toBe('updated');
    expect(updated.normalized.screen.name).toBe('New');
    const unchanged = applyUpdateScreen(updated.normalized, { name: 'New' });
    expect(unchanged.status).toBe('unchanged');
  });
});

describe('updateDescriptionScreen persistence', () => {
  it('v1.2 screen 更新で v1.3 に migration する', async () => {
    const root = tempRoot();
    writeDescriptionFile(root, {
      schemaVersion: '1.2',
      screen: { id: 'demo-screen', name: 'Old', description: 'd' },
      itemOrder: ['item-a'],
      items: { 'item-a': { name: '', type: '', description: '', note: '' } },
      excludedItems: {},
    });
    const revision = readDescriptionRevision(root, 'demo', 'demo-screen')!;
    await updateDescriptionScreen(ctx(root), {
      expectedRevision: revision,
      name: 'New',
    });
    const saved = JSON.parse(
      fs.readFileSync(
        path.join(root, 'spec', 'demo', 'src', 'data', 'demo-screen.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(saved.schemaVersion).toBe('1.3');
    expect((saved.screen as { name: string }).name).toBe('New');
  });
});
