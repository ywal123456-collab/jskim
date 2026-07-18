import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computeContentRevision } from '../../src/util/write-file-atomic.js';
import {
  isSafeReferenceImageFileName,
  parseReferenceImageMetadata,
  serializeReferenceImageMetadata,
  validatePersistedReferenceImage,
} from '../../src/reference-image/validate-metadata.js';
import { buildPng, makeTempRoot } from './helpers.js';

function validMeta(png: Buffer) {
  const imageRevision = computeContentRevision(png);
  const hex = imageRevision.slice('sha256:'.length);
  return {
    schemaVersion: '1.0' as const,
    screenId: 'inquiry-input',
    viewport: { id: 'pc' as const, width: 1440, height: 900 },
    format: 'png' as const,
    imageFile: `reference-${hex}.png`,
    imageRevision,
    imageWidth: 10,
    imageHeight: 20,
    uploadedAt: '2026-07-18T00:00:00.000Z',
    source: { type: 'upload' as const },
  };
}

describe('Reference Image metadata 検証', () => {
  it('正常 metadata を受理する', () => {
    const png = buildPng(10, 20);
    const parsed = parseReferenceImageMetadata(validMeta(png));
    expect(parsed.ok).toBe(true);
  });

  it('unknown field を拒否する', () => {
    const png = buildPng(10, 20);
    const raw = { ...validMeta(png), extra: 1 };
    expect(parseReferenceImageMetadata(raw).ok).toBe(false);
  });

  it('path traversal imageFile を拒否する', () => {
    expect(isSafeReferenceImageFileName('../x.png')).toBe(false);
    expect(isSafeReferenceImageFileName('a/b.png')).toBe(false);
    expect(isSafeReferenceImageFileName('C:\\a.png')).toBe(false);
    expect(
      isSafeReferenceImageFileName(`reference-${'a'.repeat(64)}.png`),
    ).toBe(true);
  });

  it('screenId / viewport mismatch と hash mismatch を invalid にする', () => {
    const root = makeTempRoot();
    try {
      const png = buildPng(10, 20);
      const meta = validMeta(png);
      const dir = path.join(root, 'pc');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, meta.imageFile), png);
      fs.writeFileSync(
        path.join(dir, 'meta.json'),
        serializeReferenceImageMetadata(meta),
      );

      expect(
        validatePersistedReferenceImage({
          metaPath: path.join(dir, 'meta.json'),
          expectedScreenId: 'other',
          expectedViewport: 'pc',
        }).ok,
      ).toBe(false);

      expect(
        validatePersistedReferenceImage({
          metaPath: path.join(dir, 'meta.json'),
          expectedScreenId: 'inquiry-input',
          expectedViewport: 'sp',
        }).ok,
      ).toBe(false);

      fs.writeFileSync(path.join(dir, meta.imageFile), buildPng(10, 20, 3));
      expect(
        validatePersistedReferenceImage({
          metaPath: path.join(dir, 'meta.json'),
          expectedScreenId: 'inquiry-input',
          expectedViewport: 'pc',
        }).ok,
      ).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('dimension mismatch を invalid にする', () => {
    const root = makeTempRoot();
    try {
      const png = buildPng(10, 20);
      const meta = { ...validMeta(png), imageWidth: 99, imageHeight: 99 };
      const dir = path.join(root, 'pc');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, meta.imageFile), png);
      fs.writeFileSync(
        path.join(dir, 'meta.json'),
        serializeReferenceImageMetadata(meta),
      );
      expect(
        validatePersistedReferenceImage({
          metaPath: path.join(dir, 'meta.json'),
          expectedScreenId: 'inquiry-input',
          expectedViewport: 'pc',
        }).ok,
      ).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
