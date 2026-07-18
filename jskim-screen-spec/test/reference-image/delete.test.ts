import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { putReferenceImage } from '../../src/reference-image/put-reference-image.js';
import { deleteReferenceImage } from '../../src/reference-image/delete-reference-image.js';
import { getReferenceImageStatus } from '../../src/reference-image/status.js';
import { resetReferenceImageLocksForTest } from '../../src/reference-image/key-lock.js';
import { referenceMetaPath } from '../../src/reference-image/paths.js';
import {
  PROJECT,
  buildPng,
  makeTempRoot,
  referenceDir,
  writeDesignOnlyScreen,
} from './helpers.js';

afterEach(() => {
  resetReferenceImageLocksForTest();
});

describe('deleteReferenceImage', () => {
  it('正常 expected で削除し他 viewport を維持する', async () => {
    const root = makeTempRoot();
    try {
      writeDesignOnlyScreen(root, 's1');
      const pc = await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        imageBytes: buildPng(10, 10, 1),
      });
      await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'sp',
        imageBytes: buildPng(10, 10, 2),
      });
      const deleted = await deleteReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        expectedImageRevision: pc.imageRevision,
      });
      expect(deleted.result).toBe('deleted');
      expect(
        getReferenceImageStatus({
          rootDir: root,
          projectName: PROJECT,
          screenId: 's1',
          viewport: 'pc',
        }).status,
      ).toBe('missing');
      expect(
        getReferenceImageStatus({
          rootDir: root,
          projectName: PROJECT,
          screenId: 's1',
          viewport: 'sp',
        }).status,
      ).toBe('current');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('missing / stale / invalid を拒否する', async () => {
    const root = makeTempRoot();
    try {
      writeDesignOnlyScreen(root, 's1');
      await expect(
        deleteReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 's1',
          viewport: 'pc',
          expectedImageRevision: `sha256:${'a'.repeat(64)}`,
        }),
      ).rejects.toMatchObject({ code: 'SPEC_REFERENCE_IMAGE_NOT_FOUND' });

      const created = await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        imageBytes: buildPng(10, 10, 1),
      });
      await expect(
        deleteReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 's1',
          viewport: 'pc',
          expectedImageRevision: `sha256:${'b'.repeat(64)}`,
        }),
      ).rejects.toMatchObject({ code: 'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT' });

      // invalid 化
      fs.writeFileSync(
        referenceMetaPath({
          rootDir: root,
          projectName: PROJECT,
          screenId: 's1',
          viewport: 'pc',
        }),
        '{bad',
      );
      await expect(
        deleteReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 's1',
          viewport: 'pc',
          expectedImageRevision: created.imageRevision,
        }),
      ).rejects.toMatchObject({ code: 'SPEC_REFERENCE_IMAGE_INVALID' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('meta unlink 失敗時は既存を維持し、cleanup 失敗でも delete 成功', async () => {
    const root = makeTempRoot();
    try {
      writeDesignOnlyScreen(root, 's1');
      const created = await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        imageBytes: buildPng(10, 10, 1),
      });
      await expect(
        deleteReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 's1',
          viewport: 'pc',
          expectedImageRevision: created.imageRevision,
          hooks: { failMetaUnlink: true },
        }),
      ).rejects.toMatchObject({ code: 'SPEC_REFERENCE_IMAGE_WRITE_FAILED' });
      expect(
        fs.existsSync(
          referenceMetaPath({
            rootDir: root,
            projectName: PROJECT,
            screenId: 's1',
            viewport: 'pc',
          }),
        ),
      ).toBe(true);

      const again = await deleteReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        expectedImageRevision: created.imageRevision,
        hooks: { failCleanup: true },
      });
      expect(again.result).toBe('deleted');
      expect(again.warnings?.length).toBeGreaterThan(0);
      // meta は消えている。generation は cleanup 失敗で残る可能性あり
      expect(
        fs.existsSync(
          referenceMetaPath({
            rootDir: root,
            projectName: PROJECT,
            screenId: 's1',
            viewport: 'pc',
          }),
        ),
      ).toBe(false);
      const leftovers = fs
        .readdirSync(referenceDir(root, 's1', 'pc'))
        .filter((n) => n.startsWith('reference-'));
      expect(leftovers.length).toBeGreaterThanOrEqual(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
