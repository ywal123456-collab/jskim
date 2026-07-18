import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeInputRevision,
  loadDeviceCaptureInputContext,
  type DeviceCaptureInputContext,
} from '../../src/device-capture/input-revision.js';

function baseCtx(
  overrides: Partial<DeviceCaptureInputContext> = {},
): DeviceCaptureInputContext {
  return {
    screenId: 'demo',
    stateId: 'default',
    viewport: 'pc',
    route: '/index.html',
    actions: [],
    snapshotHtml: Buffer.from('<html></html>', 'utf8'),
    resourceHashes: [],
    ...overrides,
  };
}

describe('inputRevision', () => {
  it('canonical で安定した sha256 を返す', () => {
    const rev = computeInputRevision(baseCtx());
    expect(rev).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(computeInputRevision(baseCtx())).toBe(rev);
  });

  it('resource 順序が違っても同一 revision', () => {
    const a = computeInputRevision(
      baseCtx({
        resourceHashes: [
          { logicalPath: 'resources/files/a.css', hash: 'aaa' },
          { logicalPath: 'resources/files/b.css', hash: 'bbb' },
        ],
      }),
    );
    const b = computeInputRevision(
      baseCtx({
        resourceHashes: [
          { logicalPath: 'resources/files/b.css', hash: 'bbb' },
          { logicalPath: 'resources/files/a.css', hash: 'aaa' },
        ],
      }),
    );
    expect(a).toBe(b);
  });

  it('resource hash 変更で revision が変わる', () => {
    const a = computeInputRevision(
      baseCtx({
        resourceHashes: [
          { logicalPath: 'resources/files/a.css', hash: 'aaa' },
        ],
      }),
    );
    const b = computeInputRevision(
      baseCtx({
        resourceHashes: [
          { logicalPath: 'resources/files/a.css', hash: 'bbb' },
        ],
      }),
    );
    expect(a).not.toBe(b);
  });

  it('state action 変更で revision が変わる', () => {
    const a = computeInputRevision(baseCtx({ actions: [] }));
    const b = computeInputRevision(
      baseCtx({
        actions: [{ type: 'click', target: 'open-help' }],
      }),
    );
    expect(a).not.toBe(b);
  });

  it('viewport 変更で revision が変わる', () => {
    const a = computeInputRevision(baseCtx({ viewport: 'pc' }));
    const b = computeInputRevision(baseCtx({ viewport: 'sp' }));
    expect(a).not.toBe(b);
  });

  it('snapshot bytes 変更で revision が変わる', () => {
    const a = computeInputRevision(
      baseCtx({ snapshotHtml: Buffer.from('a', 'utf8') }),
    );
    const b = computeInputRevision(
      baseCtx({ snapshotHtml: Buffer.from('b', 'utf8') }),
    );
    expect(a).not.toBe(b);
  });

  it('loadDeviceCaptureInputContext は resource を昇順で正規化する', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-ir-'));
    try {
      const pagesDir = path.join(rootDir, 'src/demo/pages');
      const snapDir = path.join(rootDir, 'spec/demo/src/snapshots/demo');
      const resDir = path.join(rootDir, 'spec/demo/src/resources');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.mkdirSync(snapDir, { recursive: true });
      fs.mkdirSync(path.join(resDir, 'screens'), { recursive: true });
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
      fs.writeFileSync(path.join(snapDir, 'default.html'), '<html></html>');
      fs.writeFileSync(
        path.join(resDir, 'manifest.json'),
        `${JSON.stringify({
          files: {
            'bbbbbbbbbbbb.css': { hash: 'hash-b' },
            'aaaaaaaaaaaa.css': { hash: 'hash-a' },
          },
        })}\n`,
      );
      fs.writeFileSync(
        path.join(resDir, 'screens', 'demo.json'),
        `${JSON.stringify({
          states: {
            default: {
              styles: [
                { href: '/resources/files/bbbbbbbbbbbb.css' },
                { href: '/resources/files/aaaaaaaaaaaa.css' },
              ],
            },
          },
        })}\n`,
      );

      const ctx = loadDeviceCaptureInputContext({
        rootDir,
        projectName: 'demo',
        screenId: 'demo',
        stateId: 'default',
        viewport: 'pc',
      });
      expect(ctx.resourceHashes.map((r) => r.logicalPath)).toEqual([
        'resources/files/aaaaaaaaaaaa.css',
        'resources/files/bbbbbbbbbbbb.css',
      ]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
