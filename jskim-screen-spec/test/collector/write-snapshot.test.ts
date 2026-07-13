import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isSnapshotUnchanged,
  writeSnapshot,
} from '../../src/collector/write-snapshot.js';

describe('write-snapshot', () => {
  it('同一内容なら unchanged を返し、異なる内容なら更新する', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-snap-'));
    const filePath = path.join(dir, 'default.html');
    const html = '<main>hello</main>';

    expect(writeSnapshot(filePath, html)).toBe('updated');
    expect(fs.readFileSync(filePath, 'utf8')).toBe(`${html}\n`);
    expect(isSnapshotUnchanged(filePath, html)).toBe(true);
    expect(writeSnapshot(filePath, html)).toBe('unchanged');

    const mtime1 = fs.statSync(filePath).mtimeMs;
    expect(writeSnapshot(filePath, '<main>changed</main>')).toBe('updated');
    const mtime2 = fs.statSync(filePath).mtimeMs;
    expect(mtime2).toBeGreaterThanOrEqual(mtime1);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('<main>changed</main>\n');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
