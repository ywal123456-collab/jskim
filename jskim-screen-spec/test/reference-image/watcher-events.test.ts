import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { classifyScreenSpecWatchPath } from '../../src/watch/classify-watch-path.js';
import { putReferenceImage } from '../../src/reference-image/put-reference-image.js';
import { deleteReferenceImage } from '../../src/reference-image/delete-reference-image.js';
import { resetReferenceImageLocksForTest } from '../../src/reference-image/key-lock.js';
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

/**
 * watcher 分類契約: meta.json → BUILD_ONLY、generation/TEMP → IGNORE。
 * core が書くパスを classify して collect/build/reload 期待回数を検証する。
 */
function classifyUnder(
  rootDir: string,
  relPosix: string,
): 'COLLECT_AND_BUILD' | 'BUILD_ONLY' | 'IGNORE' {
  return classifyScreenSpecWatchPath({
    rootDir,
    projectName: PROJECT,
    sourceDir: path.join(rootDir, 'src', PROJECT),
    filePath: path.join(rootDir, ...relPosix.split('/')),
  });
}

function countEvents(
  kinds: Array<'COLLECT_AND_BUILD' | 'BUILD_ONLY' | 'IGNORE'>,
): { collect: number; build: number; reload: number } {
  let collect = 0;
  let build = 0;
  for (const k of kinds) {
    if (k === 'COLLECT_AND_BUILD') {
      collect += 1;
      build += 1;
    } else if (k === 'BUILD_ONLY') {
      build += 1;
    }
  }
  return { collect, build, reload: build };
}

describe('Reference Image watcher 契約', () => {
  it('初回 upload: generation IGNORE → meta BUILD_ONLY', async () => {
    const root = makeTempRoot();
    try {
      writeDesignOnlyScreen(root, 's1');
      const before = new Set(
        fs.existsSync(referenceDir(root, 's1', 'pc'))
          ? fs.readdirSync(referenceDir(root, 's1', 'pc'))
          : [],
      );
      await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        imageBytes: buildPng(10, 10, 1),
      });
      const dir = referenceDir(root, 's1', 'pc');
      const names = fs.readdirSync(dir);
      const events: Array<'COLLECT_AND_BUILD' | 'BUILD_ONLY' | 'IGNORE'> = [];
      for (const name of names) {
        if (before.has(name)) {
          continue;
        }
        const rel = `spec/${PROJECT}/src/references/s1/pc/${name}`;
        events.push(classifyUnder(root, rel));
      }
      expect(events.filter((e) => e === 'IGNORE').length).toBeGreaterThanOrEqual(1);
      expect(events.filter((e) => e === 'BUILD_ONLY')).toEqual(['BUILD_ONLY']);
      expect(countEvents(events)).toEqual({ collect: 0, build: 1, reload: 1 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('replace: new generation IGNORE / meta change BUILD_ONLY / old unlink IGNORE', async () => {
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
      const dir = referenceDir(root, 's1', 'pc');
      const beforeNames = new Set(fs.readdirSync(dir));
      await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        imageBytes: buildPng(10, 10, 2),
        expectedImageRevision: first.imageRevision,
      });
      const afterNames = fs.readdirSync(dir);
      const events: Array<'COLLECT_AND_BUILD' | 'BUILD_ONLY' | 'IGNORE'> = [];
      for (const name of afterNames) {
        if (!beforeNames.has(name) || name === 'meta.json') {
          events.push(
            classifyUnder(
              root,
              `spec/${PROJECT}/src/references/s1/pc/${name}`,
            ),
          );
        }
      }
      // old generation unlink
      for (const name of beforeNames) {
        if (!afterNames.includes(name) && name.startsWith('reference-')) {
          events.push(
            classifyUnder(
              root,
              `spec/${PROJECT}/src/references/s1/pc/${name}`,
            ),
          );
        }
      }
      const counted = countEvents(events);
      expect(counted.collect).toBe(0);
      expect(counted.build).toBe(1);
      expect(counted.reload).toBe(1);
      expect(
        events.every((e) => e === 'IGNORE' || e === 'BUILD_ONLY'),
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('unchanged / conflict / validation failure は build 0', async () => {
    const root = makeTempRoot();
    try {
      writeDesignOnlyScreen(root, 's1');
      const png = buildPng(10, 10, 1);
      const first = await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        imageBytes: png,
      });
      const metaMtime = fs.statSync(
        path.join(referenceDir(root, 's1', 'pc'), 'meta.json'),
      ).mtimeMs;

      await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        imageBytes: png,
        expectedImageRevision: first.imageRevision,
      });
      expect(
        fs.statSync(path.join(referenceDir(root, 's1', 'pc'), 'meta.json'))
          .mtimeMs,
      ).toBe(metaMtime);

      await expect(
        putReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 's1',
          viewport: 'pc',
          imageBytes: buildPng(10, 10, 2),
          expectedImageRevision: `sha256:${'0'.repeat(64)}`,
        }),
      ).rejects.toMatchObject({ code: 'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT' });

      await expect(
        putReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 's1',
          viewport: 'pc',
          imageBytes: Buffer.from('not-png'),
          expectedImageRevision: first.imageRevision,
        }),
      ).rejects.toMatchObject({ code: 'SPEC_REFERENCE_IMAGE_INVALID_PNG' });

      expect(
        fs.statSync(path.join(referenceDir(root, 's1', 'pc'), 'meta.json'))
          .mtimeMs,
      ).toBe(metaMtime);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('delete: meta unlink BUILD_ONLY / generation IGNORE', async () => {
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
      const imageName = `reference-${created.imageRevision.slice(7)}.png`;
      await deleteReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 's1',
        viewport: 'pc',
        expectedImageRevision: created.imageRevision,
      });
      expect(
        classifyUnder(
          root,
          `spec/${PROJECT}/src/references/s1/pc/meta.json`,
        ),
      ).toBe('BUILD_ONLY');
      expect(
        classifyUnder(
          root,
          `spec/${PROJECT}/src/references/s1/pc/${imageName}`,
        ),
      ).toBe('IGNORE');
      expect(
        countEvents(['BUILD_ONLY', 'IGNORE']),
      ).toEqual({ collect: 0, build: 1, reload: 1 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
