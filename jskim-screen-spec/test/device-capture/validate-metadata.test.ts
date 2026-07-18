import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isSafeImageFileName,
  parseDeviceCaptureMetadata,
  validatePersistedCapture,
} from '../../src/device-capture/validate-metadata.js';
import { computeContentRevision } from '../../src/util/write-file-atomic.js';

function buildPng(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const type = Buffer.from('IHDR');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(13, 0);
  return Buffer.concat([sig, len, type, ihdrData, Buffer.alloc(4)]);
}

function validMeta(overrides: Record<string, unknown> = {}) {
  const png = buildPng(10, 20);
  const imageRevision = computeContentRevision(png);
  const hex = imageRevision.slice('sha256:'.length);
  return {
    meta: {
      schemaVersion: '1.0',
      screenId: 'demo',
      stateId: 'default',
      viewport: { id: 'pc', width: 1440, height: 900 },
      format: 'png',
      fullPage: true,
      deviceScaleFactor: 1,
      inputRevision: `sha256:${'a'.repeat(64)}`,
      imageFile: `capture-${hex}.png`,
      imageRevision,
      imageWidth: 10,
      imageHeight: 20,
      capturedAt: '2026-07-18T00:00:00.000Z',
      ...overrides,
    },
    png,
  };
}

describe('metadata validation', () => {
  it('正常 metadata を受理する', () => {
    const { meta } = validMeta();
    const r = parseDeviceCaptureMetadata(meta);
    expect(r.ok).toBe(true);
  });

  it('未知フィールドを拒否する', () => {
    const { meta } = validMeta({ extra: 1 });
    expect(parseDeviceCaptureMetadata(meta).ok).toBe(false);
  });

  it('imageFile path traversal を拒否する', () => {
    expect(isSafeImageFileName('../evil.png')).toBe(false);
    expect(isSafeImageFileName('/abs/path.png')).toBe(false);
    expect(isSafeImageFileName('http://x/y.png')).toBe(false);
    expect(isSafeImageFileName('capture-nothex.png')).toBe(false);
    const hex = 'a'.repeat(64);
    expect(isSafeImageFileName(`capture-${hex}.png`)).toBe(true);
  });

  it('image hash mismatch を invalid にする', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-meta-'));
    try {
      const { meta, png } = validMeta();
      const imagePath = path.join(dir, meta.imageFile as string);
      fs.writeFileSync(imagePath, png);
      // 別内容に差し替え
      fs.writeFileSync(imagePath, Buffer.concat([png, Buffer.from([0])]));
      fs.writeFileSync(
        path.join(dir, 'meta.json'),
        `${JSON.stringify(meta, null, 2)}\n`,
      );
      const r = validatePersistedCapture({
        metaPath: path.join(dir, 'meta.json'),
        expectedScreenId: 'demo',
        expectedStateId: 'default',
        expectedViewport: 'pc',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toMatch(/imageRevision|PNG|寸法/);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('screenId 不一致は invalid', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-meta-'));
    try {
      const { meta, png } = validMeta();
      fs.writeFileSync(path.join(dir, meta.imageFile as string), png);
      fs.writeFileSync(
        path.join(dir, 'meta.json'),
        `${JSON.stringify(meta, null, 2)}\n`,
      );
      const r = validatePersistedCapture({
        metaPath: path.join(dir, 'meta.json'),
        expectedScreenId: 'other',
        expectedStateId: 'default',
        expectedViewport: 'pc',
      });
      expect(r.ok).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
