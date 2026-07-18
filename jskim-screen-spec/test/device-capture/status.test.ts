import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDeviceCaptureStatus } from '../../src/device-capture/status.js';
import { computeContentRevision } from '../../src/util/write-file-atomic.js';
import {
  computeInputRevision,
  loadDeviceCaptureInputContext,
} from '../../src/device-capture/input-revision.js';
import { serializeDeviceCaptureMetadata } from '../../src/device-capture/validate-metadata.js';

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

function setupProject(): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-status-'));
  const pagesDir = path.join(rootDir, 'src/demo/pages');
  const snapDir = path.join(rootDir, 'spec/demo/src/snapshots/demo');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.mkdirSync(snapDir, { recursive: true });
  fs.writeFileSync(
    path.join(pagesDir, 'demo.spec.json'),
    `${JSON.stringify(
      {
        schemaVersion: '1.0',
        screen: { id: 'demo', path: '/index.html' },
        states: [{ id: 'default', name: '初期', collect: { actions: [] } }],
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(path.join(snapDir, 'default.html'), '<html>v1</html>');
  return rootDir;
}

describe('getDeviceCaptureStatus', () => {
  it('missing / current / stale / invalid を返す', () => {
    const rootDir = setupProject();
    try {
      const base = {
        rootDir,
        projectName: 'demo',
        screenId: 'demo',
        stateId: 'default',
        viewport: 'pc' as const,
      };
      expect(getDeviceCaptureStatus(base).status).toBe('missing');

      const ctx = loadDeviceCaptureInputContext(base);
      const inputRevision = computeInputRevision(ctx);
      const png = buildPng(10, 20);
      const imageRevision = computeContentRevision(png);
      const hex = imageRevision.slice('sha256:'.length);
      const captureDir = path.join(
        rootDir,
        'spec/demo/src/captures/demo/default/pc',
      );
      fs.mkdirSync(captureDir, { recursive: true });
      const imageFile = `capture-${hex}.png`;
      fs.writeFileSync(path.join(captureDir, imageFile), png);
      const metadata = {
        schemaVersion: '1.0' as const,
        screenId: 'demo',
        stateId: 'default',
        viewport: { id: 'pc' as const, width: 1440, height: 900 },
        format: 'png' as const,
        fullPage: true,
        deviceScaleFactor: 1,
        inputRevision,
        imageFile,
        imageRevision,
        imageWidth: 10,
        imageHeight: 20,
        capturedAt: '2026-07-18T00:00:00.000Z',
      };
      fs.writeFileSync(
        path.join(captureDir, 'meta.json'),
        serializeDeviceCaptureMetadata(metadata),
      );
      expect(getDeviceCaptureStatus(base).status).toBe('current');

      fs.writeFileSync(
        path.join(rootDir, 'spec/demo/src/snapshots/demo/default.html'),
        '<html>v2</html>',
      );
      expect(getDeviceCaptureStatus(base).status).toBe('stale');

      fs.writeFileSync(path.join(captureDir, 'meta.json'), '{broken');
      expect(getDeviceCaptureStatus(base).status).toBe('invalid');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
