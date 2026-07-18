import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROJECT = 'demo';

/** 最小有効 PNG（IHDR のみ。CRC は検証しない） */
export function buildPng(width: number, height: number, pad = 0): Buffer {
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

export function makeTempRoot(prefix = 'jskim-ref-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeDesignOnlyScreen(
  rootDir: string,
  screenId: string,
  name = screenId,
): void {
  const dataDir = path.join(rootDir, 'spec', PROJECT, 'src', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, `${screenId}.json`),
    `${JSON.stringify(
      {
        schemaVersion: '1.2',
        screen: { id: screenId, name, description: '' },
        itemOrder: [],
        items: {},
        excludedItems: {},
      },
      null,
      2,
    )}\n`,
  );
}

export function writeImplementationOnlyScreen(
  rootDir: string,
  screenId: string,
): void {
  const pagesDir = path.join(rootDir, 'src', PROJECT, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(
    path.join(pagesDir, `${screenId}.spec.json`),
    `${JSON.stringify(
      {
        schemaVersion: '1.0',
        screen: { id: screenId, path: `/${screenId}.html` },
        states: [
          {
            id: 'default',
            name: '初期',
            viewer: { visible: true, order: 0 },
            collect: { actions: [] },
          },
        ],
        interactions: [],
      },
      null,
      2,
    )}\n`,
  );
  const snapDir = path.join(
    rootDir,
    'spec',
    PROJECT,
    'src',
    'snapshots',
    screenId,
  );
  fs.mkdirSync(snapDir, { recursive: true });
  fs.writeFileSync(
    path.join(snapDir, 'default.html'),
    `<div data-jskim-spec-screen="${screenId}"></div>\n`,
  );
}

export function writeLinkedScreen(rootDir: string, screenId: string): void {
  writeDesignOnlyScreen(rootDir, screenId);
  writeImplementationOnlyScreen(rootDir, screenId);
}

export function referenceDir(
  rootDir: string,
  screenId: string,
  viewport: 'pc' | 'sp',
): string {
  return path.join(
    rootDir,
    'spec',
    PROJECT,
    'src',
    'references',
    screenId,
    viewport,
  );
}
