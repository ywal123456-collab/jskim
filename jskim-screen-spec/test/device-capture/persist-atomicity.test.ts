import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeContentRevision } from '../../src/util/write-file-atomic.js';
import {
  commitDeviceCapture,
  cleanupOrphanGenerationImages,
} from '../../src/device-capture/persist-capture.js';
import { serializeDeviceCaptureMetadata } from '../../src/device-capture/validate-metadata.js';
import type { DeviceCaptureMetadata } from '../../src/device-capture/types.js';
import { DeviceCaptureError } from '../../src/device-capture/errors.js';

function buildPng(width: number, height: number, pad = 0): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const type = Buffer.from('IHDR');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(13, 0);
  const body = Buffer.concat([sig, len, type, ihdrData, Buffer.alloc(4)]);
  if (pad > 0) {
    return Buffer.concat([body, Buffer.alloc(pad, 1)]);
  }
  return body;
}

function metaFor(png: Buffer, overrides: Partial<DeviceCaptureMetadata> = {}): DeviceCaptureMetadata {
  const imageRevision = computeContentRevision(png);
  const hex = imageRevision.slice('sha256:'.length);
  return {
    schemaVersion: '1.0',
    screenId: 'demo',
    stateId: 'default',
    viewport: { id: 'pc', width: 1440, height: 900 },
    format: 'png',
    fullPage: true,
    deviceScaleFactor: 1,
    inputRevision: `sha256:${'b'.repeat(64)}`,
    imageFile: `capture-${hex}.png`,
    imageRevision,
    imageWidth: 10,
    imageHeight: 20,
    capturedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('persist atomicity', () => {
  it('成功時は meta + generation image を書き、orphan を掃除', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-persist-'));
    try {
      const oldPng = buildPng(10, 20, 1);
      const oldMeta = metaFor(oldPng, {
        inputRevision: `sha256:${'a'.repeat(64)}`,
        capturedAt: '2026-01-01T00:00:00.000Z',
      });
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, oldMeta.imageFile), oldPng);
      fs.writeFileSync(
        path.join(dir, 'meta.json'),
        serializeDeviceCaptureMetadata(oldMeta),
      );
      // ユーザー任意 PNG（掃除しない）
      fs.writeFileSync(path.join(dir, 'user-notes.png'), Buffer.from('x'));

      const newPng = buildPng(10, 20, 2);
      const newMeta = metaFor(newPng, {
        inputRevision: `sha256:${'c'.repeat(64)}`,
        capturedAt: '2026-07-18T12:00:00.000Z',
      });
      const result = commitDeviceCapture({
        captureDir: dir,
        metadata: newMeta,
        pngBytes: newPng,
      });
      expect(result.status).toBe('updated');
      expect(fs.existsSync(path.join(dir, newMeta.imageFile))).toBe(true);
      expect(fs.existsSync(path.join(dir, oldMeta.imageFile))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'user-notes.png'))).toBe(true);
      expect(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).toBe(
        serializeDeviceCaptureMetadata(newMeta),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('image publish 失敗時は既存 Capture を維持', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-persist-'));
    try {
      const oldPng = buildPng(10, 20, 1);
      const oldMeta = metaFor(oldPng);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, oldMeta.imageFile), oldPng);
      const oldJson = serializeDeviceCaptureMetadata(oldMeta);
      fs.writeFileSync(path.join(dir, 'meta.json'), oldJson);

      const newPng = buildPng(10, 20, 3);
      const newMeta = metaFor(newPng, {
        inputRevision: `sha256:${'d'.repeat(64)}`,
      });
      expect(() =>
        commitDeviceCapture({
          captureDir: dir,
          metadata: newMeta,
          pngBytes: newPng,
          hooks: { failImagePublish: true },
        }),
      ).toThrow(DeviceCaptureError);

      expect(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).toBe(oldJson);
      expect(fs.existsSync(path.join(dir, oldMeta.imageFile))).toBe(true);
      expect(fs.existsSync(path.join(dir, newMeta.imageFile))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('metadata atomic 失敗時は新 image を消し既存を維持', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-persist-'));
    try {
      const oldPng = buildPng(10, 20, 1);
      const oldMeta = metaFor(oldPng);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, oldMeta.imageFile), oldPng);
      const oldJson = serializeDeviceCaptureMetadata(oldMeta);
      fs.writeFileSync(path.join(dir, 'meta.json'), oldJson);

      const newPng = buildPng(10, 20, 4);
      const newMeta = metaFor(newPng, {
        inputRevision: `sha256:${'e'.repeat(64)}`,
      });
      expect(() =>
        commitDeviceCapture({
          captureDir: dir,
          metadata: newMeta,
          pngBytes: newPng,
          hooks: { failMetaAtomicReplace: true },
        }),
      ).toThrow(DeviceCaptureError);

      expect(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).toBe(oldJson);
      expect(fs.existsSync(path.join(dir, oldMeta.imageFile))).toBe(true);
      expect(fs.existsSync(path.join(dir, newMeta.imageFile))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('同一 metadata bytes なら unchanged（no-op）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-persist-'));
    try {
      const png = buildPng(10, 20);
      const metadata = metaFor(png);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, metadata.imageFile), png);
      const json = serializeDeviceCaptureMetadata(metadata);
      fs.writeFileSync(path.join(dir, 'meta.json'), json);
      const beforeMtime = fs.statSync(path.join(dir, 'meta.json')).mtimeMs;

      const result = commitDeviceCapture({
        captureDir: dir,
        metadata,
        pngBytes: png,
        previousMetaJson: json,
      });
      expect(result.status).toBe('unchanged');
      expect(fs.statSync(path.join(dir, 'meta.json')).mtimeMs).toBe(beforeMtime);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('orphan cleanup は generation 名のみ', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-persist-'));
    try {
      const keep = `capture-${'1'.repeat(64)}.png`;
      const orphan = `capture-${'2'.repeat(64)}.png`;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, keep), Buffer.from('a'));
      fs.writeFileSync(path.join(dir, orphan), Buffer.from('b'));
      fs.writeFileSync(path.join(dir, 'readme.png'), Buffer.from('c'));
      const removed = cleanupOrphanGenerationImages({
        captureDir: dir,
        keepImageFile: keep,
      });
      expect(removed).toContain(orphan);
      expect(fs.existsSync(path.join(dir, keep))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'readme.png'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
