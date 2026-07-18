import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createViewerManifest } from '../../src/builder/create-viewer-manifest.js';
import type { LoadedScreen } from '../../src/builder/load-screen-spec-project.js';
import {
  computeInputRevision,
  loadDeviceCaptureInputContext,
} from '../../src/device-capture/input-revision.js';
import { serializeDeviceCaptureMetadata } from '../../src/device-capture/validate-metadata.js';
import { computeContentRevision } from '../../src/util/write-file-atomic.js';

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
  return pad > 0 ? Buffer.concat([body, Buffer.alloc(pad, 1)]) : body;
}

function writeCapture(options: {
  rootDir: string;
  screenId: string;
  stateId: string;
  viewport: 'pc' | 'sp';
  inputRevision: string;
  png: Buffer;
}) {
  const imageRevision = computeContentRevision(options.png);
  const hex = imageRevision.slice('sha256:'.length);
  const imageFile = `capture-${hex}.png`;
  const dir = path.join(
    options.rootDir,
    'spec/demo/src/captures',
    options.screenId,
    options.stateId,
    options.viewport,
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, imageFile), options.png);
  fs.writeFileSync(
    path.join(dir, `capture-${'f'.repeat(64)}.png`),
    Buffer.from('orphan'),
  );
  fs.writeFileSync(path.join(dir, '.temp.png.tmp'), Buffer.from('tmp'));
  const meta = {
    schemaVersion: '1.0' as const,
    screenId: options.screenId,
    stateId: options.stateId,
    viewport: {
      id: options.viewport,
      width: options.viewport === 'pc' ? 1440 : 375,
      height: options.viewport === 'pc' ? 900 : 812,
    },
    format: 'png' as const,
    fullPage: true,
    deviceScaleFactor: 1,
    inputRevision: options.inputRevision,
    imageFile,
    imageRevision,
    imageWidth: 10,
    imageHeight: 20,
    capturedAt: '2026-07-18T00:00:00.000Z',
  };
  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    serializeDeviceCaptureMetadata(meta),
  );
}

function linkedScreen(): LoadedScreen {
  return {
    screenId: 'demo',
    sourcePath: 'src/demo/pages/demo.spec.json',
    descriptionPath: 'spec/demo/src/data/demo.json',
    source: {
      schemaVersion: '1.0',
      screen: { id: 'demo', path: '/index.html' },
      states: [
        {
          id: 'default',
          name: '初期',
          viewer: { visible: true, order: 10 },
          collect: { actions: [] },
        },
      ],
      interactions: [],
    },
    description: {
      schemaVersion: '1.2',
      screen: { id: 'demo', name: 'Demo', description: '' },
      itemOrder: [],
      items: {},
      excludedItems: {},
    },
    snapshots: [
      {
        stateId: 'default',
        html: '<div data-jskim-spec-screen="demo"></div>',
        filePath: 'x',
      },
    ],
    stateStyles: {},
    stateDocumentContexts: {},
    hasDescription: true,
    hasImplementation: true,
    hasPreview: true,
    status: 'linked',
  };
}

describe('manifest deviceCaptures', () => {
  it('PC current / SP invalid / orphan 非出力', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-mf-cap-'));
    try {
      const png = buildPng(10, 20);
      const snapDir = path.join(rootDir, 'spec/demo/src/snapshots/demo');
      const pagesDir = path.join(rootDir, 'src/demo/pages');
      fs.mkdirSync(snapDir, { recursive: true });
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.writeFileSync(path.join(snapDir, 'default.html'), '<html></html>');
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

      const ctx = loadDeviceCaptureInputContext({
        rootDir,
        projectName: 'demo',
        screenId: 'demo',
        stateId: 'default',
        viewport: 'pc',
      });
      const realRev = computeInputRevision(ctx);
      writeCapture({
        rootDir,
        screenId: 'demo',
        stateId: 'default',
        viewport: 'pc',
        inputRevision: realRev,
        png,
      });

      const spDir = path.join(
        rootDir,
        'spec/demo/src/captures/demo/default/sp',
      );
      fs.mkdirSync(spDir, { recursive: true });
      fs.writeFileSync(
        path.join(spDir, 'meta.json'),
        serializeDeviceCaptureMetadata({
          schemaVersion: '1.0',
          screenId: 'demo',
          stateId: 'default',
          viewport: { id: 'sp', width: 375, height: 812 },
          format: 'png',
          fullPage: true,
          deviceScaleFactor: 1,
          inputRevision: realRev,
          imageFile: `capture-${'b'.repeat(64)}.png`,
          imageRevision: `sha256:${'b'.repeat(64)}`,
          imageWidth: 10,
          imageHeight: 20,
          capturedAt: '2026-07-18T00:00:00.000Z',
        }),
      );

      const payload = createViewerManifest({
        projectName: 'demo',
        base: '/spec/',
        screens: [linkedScreen()],
        registeredScreenIds: new Set(['demo']),
        rootDir,
      });

      const state = payload.screens[0].states[0];
      expect(state.deviceCaptures?.pc.status).toBe('current');
      if (
        state.deviceCaptures?.pc.status === 'current' ||
        state.deviceCaptures?.pc.status === 'stale'
      ) {
        expect(state.deviceCaptures.pc.imagePath).toMatch(
          /^device-captures\/demo\/default\/pc\/capture-[0-9a-f]{64}\.png$/,
        );
      }
      expect(state.deviceCaptures?.sp.status).toBe('invalid');
      expect(payload.deviceCaptureFiles).toHaveLength(1);
      expect(
        payload.deviceCaptureFiles.some((f) => f.relativePath.includes('/sp/')),
      ).toBe(false);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('DESIGN_ONLY には deviceCaptures を付けない', () => {
    const base = linkedScreen();
    const screen: LoadedScreen = {
      ...base,
      source: null,
      sourcePath: null,
      snapshots: [],
      hasImplementation: false,
      hasPreview: false,
      status: 'design-only',
    };
    const payload = createViewerManifest({
      projectName: 'demo',
      base: '/spec/',
      screens: [screen],
      registeredScreenIds: new Set(['demo']),
      rootDir: os.tmpdir(),
    });
    expect(payload.screens[0].states).toEqual([]);
    expect(payload.deviceCaptureFiles).toEqual([]);
  });
});
