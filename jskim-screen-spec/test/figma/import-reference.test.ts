import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  importFigmaReferenceImage,
  reimportFigmaReferenceImage,
} from '../../src/figma/import-reference.js';
import { FigmaError } from '../../src/figma/errors.js';
import { putReferenceImage } from '../../src/reference-image/put-reference-image.js';
import { getReferenceImageStatus } from '../../src/reference-image/status.js';
import { ReferenceImageError } from '../../src/reference-image/errors.js';
import { resetReferenceImageLocksForTest } from '../../src/reference-image/key-lock.js';
import { referenceMetaPath } from '../../src/reference-image/paths.js';
import { readReferenceImageMetadataFile } from '../../src/reference-image/validate-metadata.js';
import {
  PROJECT,
  buildPng,
  makeTempRoot,
  referenceDir,
  writeDesignOnlyScreen,
} from '../reference-image/helpers.js';
import {
  createMockFetch,
  defaultFrameNodesBody,
  defaultImagesBody,
  jsonResponse,
  pngResponse,
  samplePng,
} from './mock-fetch.js';

const TOKEN = 'unit-test-figma-token';
const FILE_KEY = 'FileKeyABC';
const NODE_ID = '1:3';
const IMAGE_URL = 'https://images.example/export.png';

afterEach(() => {
  resetReferenceImageLocksForTest();
});

function figmaRoutes(options?: {
  png?: Buffer;
  frameName?: string;
  width?: number;
  height?: number;
  failNodes?: number;
  failImages?: number;
  failDownload?: boolean;
  nullImage?: boolean;
}): ReturnType<typeof createMockFetch> {
  const png = options?.png ?? samplePng(100, 200);
  return createMockFetch([
    {
      match: (u) => u.includes('/nodes'),
      handle: () => {
        if (options?.failNodes) {
          return jsonResponse({}, { status: options.failNodes });
        }
        return jsonResponse(
          defaultFrameNodesBody({
            nodeId: NODE_ID,
            name: options?.frameName ?? 'Hero',
            width: options?.width ?? 1440,
            height: options?.height ?? 2000,
          }),
        );
      },
    },
    {
      match: (u) => u.includes('/images/'),
      handle: () => {
        if (options?.failImages) {
          return jsonResponse({}, { status: options.failImages });
        }
        if (options?.nullImage) {
          return jsonResponse({ images: { [NODE_ID]: null } });
        }
        return jsonResponse(defaultImagesBody(NODE_ID, IMAGE_URL));
      },
    },
    {
      match: (u) => u.startsWith(IMAGE_URL),
      handle: () => {
        if (options?.failDownload) {
          return new Response(null, { status: 500 });
        }
        return pngResponse(png);
      },
    },
  ]);
}

describe('importFigmaReferenceImage / reimportFigmaReferenceImage', () => {
  it('新しい Figma Reference を作成する', async () => {
    const root = makeTempRoot('jskim-figma-');
    try {
      writeDesignOnlyScreen(root, 'inquiry-input');
      const png = samplePng(120, 240);
      const pending = await importFigmaReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
        figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Name?node-id=1-3`,
        token: TOKEN,
        fetchImpl: figmaRoutes({ png, width: 1600, height: 3000 }),
        nowIso: () => '2026-07-19T00:00:00.000Z',
      });
      expect(pending.result).toBe('confirmation-required');
      if (pending.result === 'confirmation-required') {
        expect(pending.confirmation.code).toBe('SPEC_FIGMA_WIDTH_MISMATCH');
        expect(pending.confirmation.frame.width).toBe(1600);
      }

      const result = await importFigmaReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
        figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Name?node-id=1-3`,
        token: TOKEN,
        confirmWidthMismatch: true,
        fetchImpl: figmaRoutes({ png, width: 1600, height: 3000 }),
        nowIso: () => '2026-07-19T00:00:00.000Z',
      });
      expect(result.result).toBe('created');
      if (result.result !== 'confirmation-required') {
        expect(result.frame.frameName).toBe('Hero');
        expect(result.sizeMismatch).toMatchObject({
          code: 'SPEC_FIGMA_VIEWPORT_SIZE_MISMATCH',
          frameWidth: 1600,
          viewportWidth: 1440,
        });
      }

      const meta = readReferenceImageMetadataFile(
        referenceMetaPath({
          rootDir: root,
          projectName: PROJECT,
          screenId: 'inquiry-input',
          viewport: 'pc',
        }),
      );
      expect(meta.ok).toBe(true);
      if (meta.ok) {
        expect(meta.metadata.source).toEqual({
          type: 'figma',
          fileKey: FILE_KEY,
          nodeId: NODE_ID,
          frameName: 'Hero',
          importedAt: '2026-07-19T00:00:00.000Z',
          exportScale: 1,
        });
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('幅不一致で confirmWidthMismatch=false のとき export しない', async () => {
    const root = makeTempRoot('jskim-figma-');
    try {
      writeDesignOnlyScreen(root, 'inquiry-input');
      let imagesCalled = 0;
      let downloadCalled = 0;
      const fetchImpl = createMockFetch([
        {
          match: (u) => u.includes('/nodes'),
          handle: () =>
            jsonResponse(
              defaultFrameNodesBody({
                nodeId: NODE_ID,
                name: 'Wide',
                width: 1600,
                height: 900,
              }),
            ),
        },
        {
          match: (u) => u.includes('/images/'),
          handle: () => {
            imagesCalled += 1;
            return jsonResponse(defaultImagesBody(NODE_ID, IMAGE_URL));
          },
        },
        {
          match: (u) => u.startsWith(IMAGE_URL),
          handle: () => {
            downloadCalled += 1;
            return pngResponse(samplePng(10, 10));
          },
        },
      ]);
      const result = await importFigmaReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
        fileKey: FILE_KEY,
        nodeId: NODE_ID,
        token: TOKEN,
        fetchImpl,
      });
      expect(result.result).toBe('confirmation-required');
      expect(imagesCalled).toBe(0);
      expect(downloadCalled).toBe(0);
      const metaPath = referenceMetaPath({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
      });
      expect(fs.existsSync(metaPath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('高さのみ不一致なら確認なしで保存する', async () => {
    const root = makeTempRoot('jskim-figma-');
    try {
      writeDesignOnlyScreen(root, 'inquiry-input');
      const png = samplePng(100, 200);
      const result = await importFigmaReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
        fileKey: FILE_KEY,
        nodeId: NODE_ID,
        token: TOKEN,
        fetchImpl: figmaRoutes({ png, width: 1440, height: 3000 }),
        nowIso: () => '2026-07-19T00:00:00.000Z',
      });
      expect(result.result).toBe('created');
      if (result.result !== 'confirmation-required') {
        expect(result.sizeMismatch?.frameHeight).toBe(3000);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('既存 upload Reference を Figma で置き換える', async () => {
    const root = makeTempRoot('jskim-figma-');
    try {
      writeDesignOnlyScreen(root, 'inquiry-input');
      const uploaded = await putReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
        imageBytes: buildPng(10, 10, 1),
      });
      const figmaPng = samplePng(50, 60);
      const replaced = await importFigmaReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
        fileKey: FILE_KEY,
        nodeId: NODE_ID,
        expectedImageRevision: uploaded.imageRevision,
        token: TOKEN,
        fetchImpl: figmaRoutes({ png: figmaPng }),
      });
      expect(replaced.result).toBe('updated');
      expect(replaced.imageRevision).not.toBe(uploaded.imageRevision);
      const status = getReferenceImageStatus({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
      });
      expect(status.metadata?.source.type).toBe('figma');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('revision conflict と同一 PNG unchanged を扱う', async () => {
    const root = makeTempRoot('jskim-figma-');
    try {
      writeDesignOnlyScreen(root, 'inquiry-input');
      const png = samplePng(40, 40);
      const created = await importFigmaReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
        fileKey: FILE_KEY,
        nodeId: NODE_ID,
        token: TOKEN,
        fetchImpl: figmaRoutes({ png }),
      });

      await expect(
        importFigmaReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 'inquiry-input',
          viewport: 'pc',
          fileKey: FILE_KEY,
          nodeId: NODE_ID,
          expectedImageRevision: 'sha256:' + '0'.repeat(64),
          token: TOKEN,
          fetchImpl: figmaRoutes({ png }),
        }),
      ).rejects.toBeInstanceOf(ReferenceImageError);

      const same = await importFigmaReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
        fileKey: FILE_KEY,
        nodeId: NODE_ID,
        expectedImageRevision: created.imageRevision,
        token: TOKEN,
        fetchImpl: figmaRoutes({ png, frameName: 'Hero' }),
      });
      expect(same.result).toBe('unchanged');
      expect(same.imageRevision).toBe(created.imageRevision);

      const files = fs.readdirSync(
        referenceDir(root, 'inquiry-input', 'pc'),
      );
      expect(files.filter((f) => f.startsWith('reference-')).length).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('API / download 失敗時に既存 Reference を保全する', async () => {
    const root = makeTempRoot('jskim-figma-');
    try {
      writeDesignOnlyScreen(root, 'inquiry-input');
      const png = samplePng(30, 30);
      const created = await importFigmaReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
        fileKey: FILE_KEY,
        nodeId: NODE_ID,
        token: TOKEN,
        fetchImpl: figmaRoutes({ png }),
      });
      const metaBefore = fs.readFileSync(
        referenceMetaPath({
          rootDir: root,
          projectName: PROJECT,
          screenId: 'inquiry-input',
          viewport: 'pc',
        }),
        'utf8',
      );

      await expect(
        importFigmaReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 'inquiry-input',
          viewport: 'pc',
          fileKey: FILE_KEY,
          nodeId: NODE_ID,
          expectedImageRevision: created.imageRevision,
          token: TOKEN,
          fetchImpl: figmaRoutes({ failNodes: 403 }),
        }),
      ).rejects.toMatchObject({ code: 'SPEC_FIGMA_FORBIDDEN' });

      await expect(
        importFigmaReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 'inquiry-input',
          viewport: 'pc',
          fileKey: FILE_KEY,
          nodeId: NODE_ID,
          expectedImageRevision: created.imageRevision,
          token: TOKEN,
          fetchImpl: figmaRoutes({ failDownload: true }),
        }),
      ).rejects.toMatchObject({ code: 'SPEC_FIGMA_DOWNLOAD_FAILED' });

      const metaAfter = fs.readFileSync(
        referenceMetaPath({
          rootDir: root,
          projectName: PROJECT,
          screenId: 'inquiry-input',
          viewport: 'pc',
        }),
        'utf8',
      );
      expect(metaAfter).toBe(metaBefore);
      expect(
        getReferenceImageStatus({
          rootDir: root,
          projectName: PROJECT,
          screenId: 'inquiry-input',
          viewport: 'pc',
        }).metadata?.imageRevision,
      ).toBe(created.imageRevision);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('Reimport: figma source / 同一 PNG / 変更 PNG / upload 拒否', async () => {
    const root = makeTempRoot('jskim-figma-');
    try {
      writeDesignOnlyScreen(root, 'inquiry-input');
      const png1 = samplePng(20, 20, 1);
      const created = await importFigmaReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
        fileKey: FILE_KEY,
        nodeId: NODE_ID,
        token: TOKEN,
        fetchImpl: figmaRoutes({ png: png1, frameName: 'A' }),
      });

      const same = await reimportFigmaReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
        expectedImageRevision: created.imageRevision,
        token: TOKEN,
        fetchImpl: figmaRoutes({ png: png1, frameName: 'A' }),
      });
      expect(same.result).toBe('unchanged');

      const png2 = samplePng(20, 20, 2);
      const updated = await reimportFigmaReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
        expectedImageRevision: created.imageRevision,
        token: TOKEN,
        fetchImpl: figmaRoutes({ png: png2, frameName: 'B' }),
      });
      expect(updated.result).toBe('updated');
      expect(updated.frame.frameName).toBe('B');

      // upload source は Reimport 不可
      const uploadRoot = makeTempRoot('jskim-figma-up-');
      try {
        writeDesignOnlyScreen(uploadRoot, 'inquiry-input');
        const up = await putReferenceImage({
          rootDir: uploadRoot,
          projectName: PROJECT,
          screenId: 'inquiry-input',
          viewport: 'pc',
          imageBytes: buildPng(8, 8),
        });
        await expect(
          reimportFigmaReferenceImage({
            rootDir: uploadRoot,
            projectName: PROJECT,
            screenId: 'inquiry-input',
            viewport: 'pc',
            expectedImageRevision: up.imageRevision,
            token: TOKEN,
            fetchImpl: figmaRoutes({}),
          }),
        ).rejects.toMatchObject({ code: 'SPEC_FIGMA_SOURCE_MISSING' });
      } finally {
        fs.rmSync(uploadRoot, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('Reimport 失敗時に既存を保全し、Frame not found を返す', async () => {
    const root = makeTempRoot('jskim-figma-');
    try {
      writeDesignOnlyScreen(root, 'inquiry-input');
      const png = samplePng(15, 15);
      const created = await importFigmaReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
        fileKey: FILE_KEY,
        nodeId: NODE_ID,
        token: TOKEN,
        fetchImpl: figmaRoutes({ png }),
      });
      const before = fs.readFileSync(
        path.join(referenceDir(root, 'inquiry-input', 'pc'), 'meta.json'),
        'utf8',
      );

      await expect(
        reimportFigmaReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 'inquiry-input',
          viewport: 'pc',
          expectedImageRevision: created.imageRevision,
          token: TOKEN,
          fetchImpl: createMockFetch([
            {
              match: (u) => u.includes('/nodes'),
              handle: () => jsonResponse({ nodes: { [NODE_ID]: null } }),
            },
          ]),
        }),
      ).rejects.toMatchObject({ code: 'SPEC_FIGMA_NODE_NOT_FOUND' });

      expect(
        fs.readFileSync(
          path.join(referenceDir(root, 'inquiry-input', 'pc'), 'meta.json'),
          'utf8',
        ),
      ).toBe(before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('保存失敗時に既存を壊さない（meta atomic fail）', async () => {
    const root = makeTempRoot('jskim-figma-');
    try {
      writeDesignOnlyScreen(root, 'inquiry-input');
      const png1 = samplePng(11, 11, 1);
      const created = await importFigmaReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'inquiry-input',
        viewport: 'pc',
        fileKey: FILE_KEY,
        nodeId: NODE_ID,
        token: TOKEN,
        fetchImpl: figmaRoutes({ png: png1 }),
      });
      const before = fs.readFileSync(
        referenceMetaPath({
          rootDir: root,
          projectName: PROJECT,
          screenId: 'inquiry-input',
          viewport: 'pc',
        }),
        'utf8',
      );

      const png2 = samplePng(11, 11, 2);
      await expect(
        putReferenceImage({
          rootDir: root,
          projectName: PROJECT,
          screenId: 'inquiry-input',
          viewport: 'pc',
          imageBytes: png2,
          expectedImageRevision: created.imageRevision,
          source: {
            type: 'figma',
            fileKey: FILE_KEY,
            nodeId: NODE_ID,
            frameName: 'X',
            importedAt: '2026-07-19T01:00:00.000Z',
            exportScale: 1,
          },
          hooks: { failMetaAtomicReplace: true },
        }),
      ).rejects.toBeInstanceOf(ReferenceImageError);

      expect(
        fs.readFileSync(
          referenceMetaPath({
            rootDir: root,
            projectName: PROJECT,
            screenId: 'inquiry-input',
            viewport: 'pc',
          }),
          'utf8',
        ),
      ).toBe(before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('エラー出力に token を含めない', async () => {
    const root = makeTempRoot('jskim-figma-');
    try {
      await importFigmaReferenceImage({
        rootDir: root,
        projectName: PROJECT,
        screenId: 'no-screen',
        viewport: 'pc',
        fileKey: FILE_KEY,
        nodeId: NODE_ID,
        token: TOKEN,
        fetchImpl: figmaRoutes({ failNodes: 401 }),
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(String(err)).not.toContain(TOKEN);
      if (err instanceof FigmaError) {
        expect(JSON.stringify(err)).not.toContain(TOKEN);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
