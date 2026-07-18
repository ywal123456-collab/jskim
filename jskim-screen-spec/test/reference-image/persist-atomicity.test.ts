import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computeContentRevision } from '../../src/util/write-file-atomic.js';
import {
  commitReferenceImage,
  cleanupOrphanReferenceGenerationImages,
} from '../../src/reference-image/persist-reference.js';
import { serializeReferenceImageMetadata } from '../../src/reference-image/validate-metadata.js';
import type { ReferenceImageMetadata } from '../../src/reference-image/types.js';
import { makeTempRoot, buildPng } from './helpers.js';

function metaFor(
  png: Buffer,
  overrides: Partial<ReferenceImageMetadata> = {},
): ReferenceImageMetadata {
  const imageRevision = computeContentRevision(png);
  const hex = imageRevision.slice('sha256:'.length);
  return {
    schemaVersion: '1.0',
    screenId: 'demo',
    viewport: { id: 'pc', width: 1440, height: 900 },
    format: 'png',
    imageFile: `reference-${hex}.png`,
    imageRevision,
    imageWidth: 10,
    imageHeight: 20,
    uploadedAt: '2026-07-18T00:00:00.000Z',
    source: { type: 'upload' },
    ...overrides,
  };
}

describe('Reference Image atomic persist', () => {
  it('成功時は meta + generation を書き orphan を掃除', () => {
    const dir = makeTempRoot();
    try {
      const oldPng = buildPng(10, 20, 1);
      const oldMeta = metaFor(oldPng, {
        uploadedAt: '2026-01-01T00:00:00.000Z',
      });
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, oldMeta.imageFile), oldPng);
      fs.writeFileSync(
        path.join(dir, 'meta.json'),
        serializeReferenceImageMetadata(oldMeta),
      );
      fs.writeFileSync(path.join(dir, 'user-notes.png'), Buffer.from('x'));

      const newPng = buildPng(10, 20, 2);
      const newMeta = metaFor(newPng);
      const result = commitReferenceImage({
        referenceDir: dir,
        metadata: newMeta,
        pngBytes: newPng,
      });
      expect(result.status).toBe('updated');
      expect(fs.existsSync(path.join(dir, newMeta.imageFile))).toBe(true);
      expect(fs.existsSync(path.join(dir, oldMeta.imageFile))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'user-notes.png'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('image publish / meta write 失敗時は既存を維持', () => {
    const dir = makeTempRoot();
    try {
      const oldPng = buildPng(10, 20, 1);
      const oldMeta = metaFor(oldPng);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, oldMeta.imageFile), oldPng);
      const oldJson = serializeReferenceImageMetadata(oldMeta);
      fs.writeFileSync(path.join(dir, 'meta.json'), oldJson);

      const newPng = buildPng(10, 20, 2);
      const newMeta = metaFor(newPng);
      expect(() =>
        commitReferenceImage({
          referenceDir: dir,
          metadata: newMeta,
          pngBytes: newPng,
          hooks: { failImagePublish: true },
        }),
      ).toThrow(/公開に失敗/);
      expect(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).toBe(oldJson);
      expect(fs.existsSync(path.join(dir, oldMeta.imageFile))).toBe(true);

      expect(() =>
        commitReferenceImage({
          referenceDir: dir,
          metadata: newMeta,
          pngBytes: newPng,
          hooks: { failMetaAtomicReplace: true },
        }),
      ).toThrow(/atomic 置換/);
      expect(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).toBe(oldJson);
      expect(fs.existsSync(path.join(dir, newMeta.imageFile))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('cleanup 失敗は commit 成功を戻さない', () => {
    const dir = makeTempRoot();
    try {
      const png = buildPng(10, 20, 1);
      const meta = metaFor(png);
      const result = commitReferenceImage({
        referenceDir: dir,
        metadata: meta,
        pngBytes: png,
        hooks: { failCleanup: true },
      });
      expect(result.status).toBe('created');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(dir, 'meta.json'))).toBe(true);
      cleanupOrphanReferenceGenerationImages({
        referenceDir: dir,
        keepImageFile: meta.imageFile,
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
