import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createViewerManifest } from '../../src/builder/create-viewer-manifest.js';
import { loadScreenSpecProject } from '../../src/builder/load-screen-spec-project.js';
import { putReferenceImage } from '../../src/reference-image/put-reference-image.js';
import { deleteReferenceImage } from '../../src/reference-image/delete-reference-image.js';
import { serializeReferenceImageMetadata } from '../../src/reference-image/validate-metadata.js';
import { computeContentRevision } from '../../src/util/write-file-atomic.js';
import { resetReferenceImageLocksForTest } from '../../src/reference-image/key-lock.js';
import { createFileDescriptionStore } from '../../src/editing/file-description-store.js';
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

describe('Reference Image manifest / output', () => {
  it('PC/SP missing/current/invalid と has* フラグ', async () => {
    const root = makeTempRoot();
    try {
      writeDesignOnlyScreen(root, 'd1');
      writeImplementationOnlyScreen(root, 'i1');
      writeLinkedScreen(root, 'l1');

      await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'd1',
        viewport: 'pc',
        imageBytes: buildPng(20, 30, 1),
      });
      await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'i1',
        viewport: 'sp',
        imageBytes: buildPng(20, 30, 2),
      });
      await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'l1',
        viewport: 'pc',
        imageBytes: buildPng(20, 30, 3),
      });
      await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'l1',
        viewport: 'sp',
        imageBytes: buildPng(20, 30, 4),
      });

      // orphan references screen（union に出さない）
      const orphanDir = referenceDir(root, 'orphan-only', 'pc');
      fs.mkdirSync(orphanDir, { recursive: true });
      fs.writeFileSync(path.join(orphanDir, 'meta.json'), '{}');

      // invalid on d1 sp
      const invDir = referenceDir(root, 'd1', 'sp');
      fs.mkdirSync(invDir, { recursive: true });
      fs.writeFileSync(path.join(invDir, 'meta.json'), '{bad');

      const project = loadScreenSpecProject({
        rootDir: root,
        projectName: PROJECT,
      });
      expect(project.screens.map((s) => s.screenId).sort()).toEqual([
        'd1',
        'i1',
        'l1',
      ]);

      const payload = createViewerManifest({
        projectName: PROJECT,
        base: '/spec/',
        screens: project.screens,
        registeredScreenIds: new Set(project.screens.map((s) => s.screenId)),
        rootDir: root,
      });

      const d1 = payload.screens.find((s) => s.id === 'd1')!;
      expect(d1.hasPreview).toBe(false);
      expect(d1.hasReferenceImage).toBe(true);
      expect(d1.hasAnyPreview).toBe(true);
      expect(d1.referenceImages?.pc.status).toBe('current');
      expect(d1.referenceImages?.sp.status).toBe('invalid');
      expect(
        d1.referenceImages?.sp.status === 'invalid'
          ? d1.referenceImages.sp.diagnosticCode
          : null,
      ).toBe('SPEC_REFERENCE_IMAGE_INVALID');
      if (d1.referenceImages?.pc.status === 'current') {
        expect(d1.referenceImages.pc.imagePath).toMatch(
          /^reference-images\/d1\/pc\/reference-[0-9a-f]{64}\.png$/,
        );
        expect(d1.referenceImages.pc.source).toEqual({ type: 'upload' });
        const serialized = JSON.stringify(d1.referenceImages.pc);
        expect(serialized).not.toMatch(/fileKey/);
        expect(serialized).not.toMatch(/nodeId/);
      }

      const i1 = payload.screens.find((s) => s.id === 'i1')!;
      expect(i1.hasPreview).toBe(true);
      expect(i1.hasReferenceImage).toBe(true);
      expect(i1.referenceImages?.pc.status).toBe('missing');
      expect(i1.referenceImages?.sp.status).toBe('current');

      const l1 = payload.screens.find((s) => s.id === 'l1')!;
      expect(l1.hasReferenceImage).toBe(true);
      expect(l1.referenceImages?.pc.status).toBe('current');
      expect(l1.referenceImages?.sp.status).toBe('current');

      // invalid / orphan generation は output に無い
      expect(
        payload.referenceImageFiles.every((f) =>
          f.relativePath.includes('/pc/') || f.relativePath.includes('/sp/'),
        ),
      ).toBe(true);
      expect(
        payload.referenceImageFiles.some((f) => f.relativePath.includes('orphan')),
      ).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('output copy / cleanup / read-only build fetch', async () => {
    const root = makeTempRoot();
    try {
      writeDesignOnlyScreen(root, 'd1');
      const first = await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'd1',
        viewport: 'pc',
        imageBytes: buildPng(16, 16, 1),
      });
      await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'd1',
        viewport: 'sp',
        imageBytes: buildPng(16, 16, 2),
      });

      // orphan generation / TEMP
      fs.writeFileSync(
        path.join(referenceDir(root, 'd1', 'pc'), `reference-${'f'.repeat(64)}.png`),
        Buffer.from('orphan'),
      );
      fs.writeFileSync(
        path.join(referenceDir(root, 'd1', 'pc'), '.temp.png.tmp'),
        Buffer.from('tmp'),
      );

      const project = loadScreenSpecProject({
        rootDir: root,
        projectName: PROJECT,
      });
      const payload = createViewerManifest({
        projectName: PROJECT,
        base: '/spec/',
        screens: project.screens,
        registeredScreenIds: new Set(['d1']),
        rootDir: root,
      });
      expect(payload.referenceImageFiles).toHaveLength(2);
      expect(
        payload.referenceImageFiles.some((f) =>
          f.relativePath.includes('f'.repeat(64)),
        ),
      ).toBe(false);

      const second = await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'd1',
        viewport: 'pc',
        imageBytes: buildPng(16, 16, 3),
        expectedImageRevision: first.imageRevision,
      });
      const afterReplace = createViewerManifest({
        projectName: PROJECT,
        base: '/spec/',
        screens: loadScreenSpecProject({
          rootDir: root,
          projectName: PROJECT,
        }).screens,
        registeredScreenIds: new Set(['d1']),
        rootDir: root,
      });
      const oldRel = `reference-images/d1/pc/reference-${first.imageRevision.slice(7)}.png`;
      const newRel = `reference-images/d1/pc/reference-${second.imageRevision.slice(7)}.png`;
      expect(
        afterReplace.referenceImageFiles.some((f) => f.relativePath === oldRel),
      ).toBe(false);
      expect(
        afterReplace.referenceImageFiles.some((f) => f.relativePath === newRel),
      ).toBe(true);

      await deleteReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'd1',
        viewport: 'pc',
        expectedImageRevision: second.imageRevision,
      });
      const afterDelete = createViewerManifest({
        projectName: PROJECT,
        base: '/spec/',
        screens: loadScreenSpecProject({
          rootDir: root,
          projectName: PROJECT,
        }).screens,
        registeredScreenIds: new Set(['d1']),
        rootDir: root,
      });
      expect(
        afterDelete.referenceImageFiles.some((f) => f.relativePath === newRel),
      ).toBe(false);
      expect(afterDelete.referenceImageFiles).toHaveLength(1);
      expect(afterDelete.referenceImageFiles[0].relativePath).toContain('/sp/');

      // read-only 静的 data 契約（vite SPA build は環境依存のため data 層のみ検証）
      const outDir = path.join(root, 'spec', PROJECT, 'dist');
      const dataDir = path.join(outDir, 'data');
      fs.mkdirSync(path.join(dataDir, 'screens'), { recursive: true });
      fs.writeFileSync(
        path.join(dataDir, 'manifest.json'),
        `${JSON.stringify(afterDelete.manifest, null, 2)}\n`,
      );
      fs.writeFileSync(
        path.join(dataDir, 'screens', 'd1.json'),
        `${JSON.stringify(afterDelete.screens[0], null, 2)}\n`,
      );
      for (const file of afterDelete.referenceImageFiles) {
        const target = path.join(dataDir, file.relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.bytes);
      }
      const manifest = JSON.parse(
        fs.readFileSync(path.join(dataDir, 'manifest.json'), 'utf8'),
      );
      expect(manifest.screens[0].hasReferenceImage).toBe(true);
      const screenJson = JSON.parse(
        fs.readFileSync(path.join(dataDir, 'screens', 'd1.json'), 'utf8'),
      );
      expect(screenJson.referenceImages.sp.status).toBe('current');
      expect(screenJson.referenceImages.pc.status).toBe('missing');
      const spOut = path.join(
        dataDir,
        screenJson.referenceImages.sp.imagePath,
      );
      expect(fs.existsSync(spOut)).toBe(true);
      expect(fs.readFileSync(spOut).length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('Description 削除後も Reference を維持し、複製は missing', async () => {
    const root = makeTempRoot();
    try {
      writeLinkedScreen(root, 'linked');
      await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'linked',
        viewport: 'pc',
        imageBytes: buildPng(8, 8, 1),
      });

      const listIds = () =>
        loadScreenSpecProject({
          rootDir: root,
          projectName: PROJECT,
        }).screens.map((s) => s.screenId);

      const store = createFileDescriptionStore({
        rootDir: root,
        projectName: PROJECT,
        listScreenIds: listIds,
      });
      const read = store.read('linked');
      store.delete('linked', read.revision);

      const project = loadScreenSpecProject({
        rootDir: root,
        projectName: PROJECT,
      });
      const linked = project.screens.find((s) => s.screenId === 'linked')!;
      expect(linked.status).toBe('implementation-only');
      const payload = createViewerManifest({
        projectName: PROJECT,
        base: '/spec/',
        screens: project.screens,
        registeredScreenIds: new Set(['linked']),
        rootDir: root,
      });
      expect(payload.screens[0].hasReferenceImage).toBe(true);
      expect(payload.screens[0].referenceImages?.pc.status).toBe('current');

      // DESIGN_ONLY 複製: Reference は複製しない
      writeDesignOnlyScreen(root, 'design-src', '設計');
      await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'design-src',
        viewport: 'pc',
        imageBytes: buildPng(8, 8, 2),
      });
      const dup = store.create({
        screenId: 'design-copy',
        name: '複製',
        description: '',
        copyFromScreenId: 'design-src',
      });
      expect(dup.created).toBe(true);
      const after = loadScreenSpecProject({
        rootDir: root,
        projectName: PROJECT,
      });
      const payload2 = createViewerManifest({
        projectName: PROJECT,
        base: '/spec/',
        screens: after.screens,
        registeredScreenIds: new Set(after.screens.map((s) => s.screenId)),
        rootDir: root,
      });
      const copyScreen = payload2.screens.find((s) => s.id === 'design-copy')!;
      expect(copyScreen.hasReferenceImage).toBe(false);
      expect(copyScreen.referenceImages?.pc.status).toBe('missing');
      expect(copyScreen.referenceImages?.sp.status).toBe('missing');
      // 原版は不変
      expect(
        payload2.screens.find((s) => s.id === 'design-src')?.hasReferenceImage,
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('hash mismatch invalid は imagePath を出さない', () => {
    const root = makeTempRoot();
    try {
      writeDesignOnlyScreen(root, 'd1');
      const png = buildPng(10, 10, 1);
      const rev = computeContentRevision(png);
      const hex = rev.slice('sha256:'.length);
      const dir = referenceDir(root, 'd1', 'pc');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `reference-${hex}.png`), png);
      const meta = {
        schemaVersion: '1.0' as const,
        screenId: 'd1',
        viewport: { id: 'pc' as const, width: 1440, height: 900 },
        format: 'png' as const,
        imageFile: `reference-${hex}.png`,
        imageRevision: rev,
        imageWidth: 10,
        imageHeight: 10,
        uploadedAt: '2026-07-18T00:00:00.000Z',
        source: { type: 'upload' as const },
      };
      fs.writeFileSync(
        path.join(dir, 'meta.json'),
        serializeReferenceImageMetadata(meta),
      );
      // corrupt image bytes but keep filename
      fs.writeFileSync(path.join(dir, meta.imageFile), buildPng(10, 10, 9));

      const project = loadScreenSpecProject({
        rootDir: root,
        projectName: PROJECT,
      });
      const payload = createViewerManifest({
        projectName: PROJECT,
        base: '/spec/',
        screens: project.screens,
        registeredScreenIds: new Set(['d1']),
        rootDir: root,
      });
      expect(payload.screens[0].referenceImages?.pc.status).toBe('invalid');
      expect(payload.referenceImageFiles).toEqual([]);
      expect(payload.screens[0].hasReferenceImage).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
