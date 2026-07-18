import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { putReferenceImage } from '../../src/reference-image/put-reference-image.js';
import { deleteReferenceImage } from '../../src/reference-image/delete-reference-image.js';
import { getReferenceImageStatus } from '../../src/reference-image/status.js';
import {
  referenceImageLockSizeForTest,
  resetReferenceImageLocksForTest,
  withReferenceImageLock,
} from '../../src/reference-image/key-lock.js';
import {
  PROJECT,
  buildPng,
  makeTempRoot,
  writeDesignOnlyScreen,
} from './helpers.js';

afterEach(() => {
  resetReferenceImageLocksForTest();
});

describe('Reference Image concurrency', () => {
  it('同一 key は直列化し stale replace は conflict', async () => {
    const root = makeTempRoot();
    try {
      writeDesignOnlyScreen(root, 's1');
      const first = await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        imageBytes: buildPng(10, 10, 1),
      });

      let releaseB!: () => void;
      const gateB = new Promise<void>((resolve) => {
        releaseB = resolve;
      });

      const pB = putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        imageBytes: buildPng(10, 10, 2),
        expectedImageRevision: first.imageRevision,
        hooks: {
          now: () => '2026-07-18T01:00:00.000Z',
          // publish 前に待つため fail ではなく awaitBarrier が無いので
          // lock 検証は withReferenceImageLock で行う
        },
      });

      // A が古い revision で後から来る
      const pA = putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        imageBytes: buildPng(10, 10, 3),
        expectedImageRevision: first.imageRevision,
      });

      const results = await Promise.allSettled([pB, pA]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      if (rejected[0].status === 'rejected') {
        expect((rejected[0].reason as { code: string }).code).toBe(
          'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT',
        );
      }
      const status = getReferenceImageStatus({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
      });
      expect(status.status).toBe('current');
      void gateB;
      void releaseB;
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('異なる viewport / screen は並列可能', async () => {
    const root = makeTempRoot();
    try {
      writeDesignOnlyScreen(root, 's1');
      writeDesignOnlyScreen(root, 's2');
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let startedSp = false;
      let startedS2 = false;

      const pPc = withReferenceImageLock('demo\0s1\0pc', async () => {
        await gate;
        return 'pc';
      });
      const pSp = withReferenceImageLock('demo\0s1\0sp', async () => {
        startedSp = true;
        return 'sp';
      });
      const pS2 = withReferenceImageLock('demo\0s2\0pc', async () => {
        startedS2 = true;
        return 's2';
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(startedSp).toBe(true);
      expect(startedS2).toBe(true);
      release();
      await expect(Promise.all([pPc, pSp, pS2])).resolves.toEqual([
        'pc',
        'sp',
        's2',
      ]);
      expect(referenceImageLockSizeForTest()).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reject 後も後続が実行され Map が掃除される', async () => {
    const order: number[] = [];
    const p1 = withReferenceImageLock('k', async () => {
      order.push(1);
      throw new Error('boom');
    });
    const p2 = withReferenceImageLock('k', async () => {
      order.push(2);
      return 'ok';
    });
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('ok');
    expect(order).toEqual([1, 2]);
    expect(referenceImageLockSizeForTest()).toBe(0);
  });

  it('同一 key の replace vs delete は直列', async () => {
    const root = makeTempRoot();
    try {
      writeDesignOnlyScreen(root, 's1');
      const first = await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        imageBytes: buildPng(10, 10, 1),
      });
      const replaceP = putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        imageBytes: buildPng(10, 10, 2),
        expectedImageRevision: first.imageRevision,
      });
      const deleteP = deleteReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        expectedImageRevision: first.imageRevision,
      });
      const settled = await Promise.allSettled([replaceP, deleteP]);
      const ok = settled.filter((s) => s.status === 'fulfilled');
      const ng = settled.filter((s) => s.status === 'rejected');
      expect(ok.length).toBe(1);
      expect(ng.length).toBe(1);
      const status = getReferenceImageStatus({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
      });
      // 勝者のどちらか: missing または current（mismatch 無し）
      expect(['missing', 'current']).toContain(status.status);
      if (status.status === 'current') {
        expect(status.metadata?.imageRevision).toBeTruthy();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
