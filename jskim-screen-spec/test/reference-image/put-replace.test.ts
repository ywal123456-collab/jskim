import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { putReferenceImage } from '../../src/reference-image/put-reference-image.js';
import { getReferenceImageStatus } from '../../src/reference-image/status.js';
import { ReferenceImageError } from '../../src/reference-image/errors.js';
import { resetReferenceImageLocksForTest } from '../../src/reference-image/key-lock.js';
import { referenceMetaPath } from '../../src/reference-image/paths.js';
import {
  PROJECT,
  buildPng,
  makeTempRoot,
  referenceDir,
  writeDesignOnlyScreen,
  writeImplementationOnlyScreen,
  writeLinkedScreen,
} from './helpers.js';

afterEach(() => {
  resetReferenceImageLocksForTest();
});

describe('putReferenceImage', () => {
  it('DESIGN_ONLY 初回 PC/SP upload（expected omitted / null）', async () => {
    const root = makeTempRoot();
    try {
      writeDesignOnlyScreen(root, 'inquiry-input');
      const pngPc = buildPng(100, 200, 1);
      const created = await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
        imageBytes: pngPc,
      });
      expect(created.result).toBe('created');
      expect(fs.existsSync(referenceMetaPath({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
      }))).toBe(true);

      const pngSp = buildPng(50, 100, 2);
      const sp = await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'sp',
        imageBytes: pngSp,
        expectedImageRevision: null,
      });
      expect(sp.result).toBe('created');
      expect(getReferenceImageStatus({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
      }).status).toBe('current');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('IMPLEMENTATION_ONLY / LINKED upload を許可する', async () => {
    const root = makeTempRoot();
    try {
      writeImplementationOnlyScreen(root, 'impl-a');
      writeLinkedScreen(root, 'linked-a');
      await expect(
        putReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 'impl-a',
          viewport: 'pc',
          imageBytes: buildPng(10, 10, 1),
        }),
      ).resolves.toMatchObject({ result: 'created' });
      await expect(
        putReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 'linked-a',
          viewport: 'pc',
          imageBytes: buildPng(10, 10, 2),
        }),
      ).resolves.toMatchObject({ result: 'created' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('screen なし・invalid viewport を拒否する', async () => {
    const root = makeTempRoot();
    try {
      writeDesignOnlyScreen(root, 'exists');
      await expect(
        putReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 'ghost',
          viewport: 'pc',
          imageBytes: buildPng(10, 10),
        }),
      ).rejects.toMatchObject({ code: 'SPEC_REFERENCE_IMAGE_SCREEN_NOT_FOUND' });

      await expect(
        putReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 'exists',
          viewport: 'tablet' as 'pc',
          imageBytes: buildPng(10, 10),
        }),
      ).rejects.toMatchObject({ code: 'SPEC_REFERENCE_IMAGE_INVALID_VIEWPORT' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('既存画像で expected なしは conflict、正常 expected で replace', async () => {
    const root = makeTempRoot();
    try {
      writeDesignOnlyScreen(root, 's1');
      const first = await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        imageBytes: buildPng(10, 10, 1),
        hooks: { now: () => '2026-01-01T00:00:00.000Z' },
      });
      await expect(
        putReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 's1',
          viewport: 'pc',
          imageBytes: buildPng(10, 10, 2),
        }),
      ).rejects.toMatchObject({ code: 'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT' });

      const replaced = await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        imageBytes: buildPng(10, 10, 2),
        expectedImageRevision: first.imageRevision,
        hooks: { now: () => '2026-07-18T00:00:00.000Z' },
      });
      expect(replaced.result).toBe('updated');
      expect(replaced.uploadedAt).toBe('2026-07-18T00:00:00.000Z');
      expect(fs.readdirSync(referenceDir(root, 's1', 'pc')).filter((n) =>
        n.startsWith('reference-'),
      )).toHaveLength(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('stale expected は conflict、同一画像は unchanged で uploadedAt 維持', async () => {
    const root = makeTempRoot();
    try {
      writeDesignOnlyScreen(root, 's1');
      const png = buildPng(12, 12, 1);
      const first = await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        imageBytes: png,
        hooks: { now: () => '2026-01-01T00:00:00.000Z' },
      });
      await expect(
        putReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 's1',
          viewport: 'pc',
          imageBytes: buildPng(12, 12, 2),
          expectedImageRevision: `sha256:${'0'.repeat(64)}`,
        }),
      ).rejects.toBeInstanceOf(ReferenceImageError);

      const metaBefore = fs.readFileSync(
        referenceMetaPath({
          rootDir: root,
          projectName: PROJECT,
          screenId: 's1',
          viewport: 'pc',
        }),
        'utf8',
      );
      const same = await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        imageBytes: png,
        expectedImageRevision: first.imageRevision,
        hooks: { now: () => '2099-01-01T00:00:00.000Z' },
      });
      expect(same.result).toBe('unchanged');
      expect(same.uploadedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(
        fs.readFileSync(
          referenceMetaPath({
            rootDir: root,
            projectName: PROJECT,
            screenId: 's1',
            viewport: 'pc',
          }),
          'utf8',
        ),
      ).toBe(metaBefore);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('invalid 状態の上書きを拒否する', async () => {
    const root = makeTempRoot();
    try {
      writeDesignOnlyScreen(root, 's1');
      const dir = referenceDir(root, 's1', 'pc');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'meta.json'), '{broken');
      await expect(
        putReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 's1',
          viewport: 'pc',
          imageBytes: buildPng(10, 10),
        }),
      ).rejects.toMatchObject({ code: 'SPEC_REFERENCE_IMAGE_INVALID' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
