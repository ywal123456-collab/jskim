import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import {
  launchChromium,
  navigateLocal,
} from '../collector/collect-screen-spec-project.js';
import { runCollectActions } from '../collector/run-collect-actions.js';
import {
  computeImageRevision,
  computeInputRevision,
  loadDeviceCaptureInputContext,
} from './input-revision.js';
import { createDeviceCaptureError } from './errors.js';
import {
  cleanupTempFilesInDir,
  commitDeviceCapture,
  type PersistCaptureHooks,
} from './persist-capture.js';
import { captureMetaPath, captureViewportDir } from './paths.js';
import { getViewportPreset } from './presets.js';
import { enqueueDeviceCapture } from './project-queue.js';
import { assertPngBuffer } from './png-dimensions.js';
import { stabilizePageForCapture } from './stabilize.js';
import type {
  CollectDeviceCaptureOptions,
  CollectDeviceCaptureResult,
  DeviceCaptureMetadata,
} from './types.js';
import { readDeviceCaptureMetadataFile } from './validate-metadata.js';

export type CollectDeviceCaptureInternalHooks = PersistCaptureHooks & {
  /** screenshot 失敗注入 */
  failScreenshot?: boolean;
  /** inputRevisionAfter 再計算前に入力を変える */
  mutateInputAfterCapture?: () => void;
  /** 固定 capturedAt（テスト用） */
  now?: () => string;
};

function isSameCaptureResult(
  existing: DeviceCaptureMetadata,
  next: Omit<DeviceCaptureMetadata, 'capturedAt'>,
): boolean {
  return (
    existing.inputRevision === next.inputRevision &&
    existing.imageRevision === next.imageRevision &&
    existing.viewport.id === next.viewport.id &&
    existing.viewport.width === next.viewport.width &&
    existing.viewport.height === next.viewport.height &&
    existing.format === next.format &&
    existing.fullPage === next.fullPage &&
    existing.deviceScaleFactor === next.deviceScaleFactor &&
    existing.imageFile === next.imageFile &&
    existing.imageWidth === next.imageWidth &&
    existing.imageHeight === next.imageHeight &&
    existing.schemaVersion === next.schemaVersion &&
    existing.screenId === next.screenId &&
    existing.stateId === next.stateId
  );
}

async function capturePngWithPage(options: {
  page: Page;
  hooks?: CollectDeviceCaptureInternalHooks;
}): Promise<Buffer> {
  if (options.hooks?.failScreenshot) {
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_WRITE_FAILED',
      'スクリーンショットに失敗しました（テスト注入）。',
    );
  }
  const buf = await options.page.screenshot({
    type: 'png',
    fullPage: true,
    animations: 'disabled',
  });
  return Buffer.from(buf);
}

/**
 * Browser を外部から注入できる内部実装。
 * 呼び出し側が browser を渡した場合は close しない。
 */
export async function collectDeviceCaptureWithBrowser(
  options: CollectDeviceCaptureOptions & {
    browser: Browser;
    hooks?: CollectDeviceCaptureInternalHooks;
  },
): Promise<CollectDeviceCaptureResult> {
  const preset = getViewportPreset(options.viewport);
  const captureDir = captureViewportDir(options);
  const metaPath = captureMetaPath(options);

  const ctxBefore = loadDeviceCaptureInputContext(options);
  const inputRevisionBefore = computeInputRevision(ctxBefore);

  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    context = await options.browser.newContext({
      viewport: {
        width: preset.width,
        height: preset.height,
      },
      deviceScaleFactor: preset.deviceScaleFactor,
      isMobile: false,
      hasTouch: false,
    });
    page = await context.newPage();

    await navigateLocal(
      page,
      options.baseUrl,
      ctxBefore.route,
      options.screenId,
      options.stateId,
    );

    await runCollectActions({
      page,
      actions: ctxBefore.actions,
      screenId: options.screenId,
      stateId: options.stateId,
    });

    await stabilizePageForCapture(page);

    const pngBytes = await capturePngWithPage({
      page,
      hooks: options.hooks,
    });
    const dims = assertPngBuffer(pngBytes);
    const imageRevision = computeImageRevision(pngBytes);
    const imageFile = `capture-${imageRevision.slice('sha256:'.length)}.png`;

    options.hooks?.mutateInputAfterCapture?.();

    const ctxAfter = loadDeviceCaptureInputContext(options);
    const inputRevisionAfter = computeInputRevision(ctxAfter);
    if (inputRevisionAfter !== inputRevisionBefore) {
      throw createDeviceCaptureError(
        'SPEC_DEVICE_CAPTURE_INPUT_CHANGED',
        '収集中に画面またはリソースが変更されました。最新の状態で再度収集してください。',
      );
    }

    const nextCore = {
      schemaVersion: '1.0' as const,
      screenId: options.screenId,
      stateId: options.stateId,
      viewport: {
        id: preset.id,
        width: preset.width,
        height: preset.height,
      },
      format: 'png' as const,
      fullPage: true,
      deviceScaleFactor: preset.deviceScaleFactor,
      inputRevision: inputRevisionAfter,
      imageFile,
      imageRevision,
      imageWidth: dims.width,
      imageHeight: dims.height,
    };

    const existingParsed = readDeviceCaptureMetadataFile(metaPath);
    if (
      existingParsed.ok &&
      isSameCaptureResult(existingParsed.metadata, nextCore)
    ) {
      cleanupTempFilesInDir(captureDir);
      return {
        status: 'unchanged',
        screenId: options.screenId,
        stateId: options.stateId,
        viewport: options.viewport,
        metadataPath: metaPath,
        imagePath: path.join(
          captureDir,
          existingParsed.metadata.imageFile,
        ),
        inputRevision: existingParsed.metadata.inputRevision,
        imageRevision: existingParsed.metadata.imageRevision,
      };
    }

    const capturedAt = options.hooks?.now?.() || new Date().toISOString();
    const metadata: DeviceCaptureMetadata = {
      ...nextCore,
      capturedAt,
    };

    const committed = commitDeviceCapture({
      captureDir,
      metadata,
      pngBytes,
      hooks: options.hooks,
    });

    return {
      status: committed.status,
      screenId: options.screenId,
      stateId: options.stateId,
      viewport: options.viewport,
      metadataPath: committed.metaPath,
      imagePath: committed.imagePath,
      inputRevision: committed.metadata.inputRevision,
      imageRevision: committed.metadata.imageRevision,
      warnings: committed.warnings.length > 0 ? committed.warnings : undefined,
    };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // ignore
      }
    }
    if (context) {
      try {
        await context.close();
      } catch {
        // ignore
      }
    }
    cleanupTempFilesInDir(captureDir);
  }
}

/**
 * 単一 Capture の所有 wrapper（Chromium launch〜close）。
 */
export async function collectDeviceCaptureOwned(
  options: CollectDeviceCaptureOptions & {
    hooks?: CollectDeviceCaptureInternalHooks;
  },
): Promise<CollectDeviceCaptureResult> {
  const browser = await launchChromium();
  try {
    return await collectDeviceCaptureWithBrowser({
      ...options,
      browser,
    });
  } finally {
    try {
      await browser.close();
    } catch {
      // ignore
    }
  }
}

/**
 * 公開 API: project 単位 queue 経由で Device Capture を実行する。
 */
export async function collectDeviceCapture(
  options: CollectDeviceCaptureOptions & {
    hooks?: CollectDeviceCaptureInternalHooks;
  },
): Promise<CollectDeviceCaptureResult> {
  return enqueueDeviceCapture(
    options.rootDir,
    options.projectName,
    async () => {
      if (options.browser) {
        return collectDeviceCaptureWithBrowser({
          ...options,
          browser: options.browser,
        });
      }
      return collectDeviceCaptureOwned(options);
    },
  );
}
