import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createFileAtomic,
  writeFileAtomic,
} from '../util/write-file-atomic.js';
import { createDeviceCaptureError } from './errors.js';
import { GENERATION_IMAGE_RE, generationImageFileName } from './presets.js';
import type { DeviceCaptureMetadata } from './types.js';
import { serializeDeviceCaptureMetadata } from './validate-metadata.js';

export type PersistCaptureHooks = {
  /** TEMP PNG 書き込み直前 */
  beforeTempPngWrite?: (tempPath: string) => void;
  /** TEMP PNG 書き込み直後に失敗させる */
  failTempPngWrite?: boolean;
  /** generation rename/link 前に失敗 */
  failImagePublish?: boolean;
  /** metadata TEMP 書き込み失敗 */
  failMetaTempWrite?: boolean;
  /** metadata atomic replace 失敗 */
  failMetaAtomicReplace?: boolean;
  writeFileAtomicFn?: typeof writeFileAtomic;
  createFileAtomicFn?: typeof createFileAtomic;
};

function safeUnlink(p: string): void {
  try {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  } catch {
    // best-effort
  }
}

/**
 * generation PNG を原子的に公開する（同一内容なら exists で no-op）。
 */
export function publishGenerationImage(options: {
  captureDir: string;
  imageRevision: string;
  pngBytes: Buffer;
  hooks?: PersistCaptureHooks;
}): { imageFile: string; imagePath: string; created: boolean } {
  const hex = options.imageRevision.slice('sha256:'.length);
  const imageFile = generationImageFileName(hex);
  const imagePath = path.join(options.captureDir, imageFile);
  fs.mkdirSync(options.captureDir, { recursive: true });

  if (fs.existsSync(imagePath)) {
    return { imageFile, imagePath, created: false };
  }

  if (options.hooks?.failImagePublish) {
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_WRITE_FAILED',
      '画像の公開に失敗しました（テスト注入）。',
    );
  }

  const createFn = options.hooks?.createFileAtomicFn || createFileAtomic;
  const result = createFn(imagePath, options.pngBytes);
  if (result.status === 'exists') {
    return { imageFile, imagePath, created: false };
  }
  return { imageFile, imagePath, created: true };
}

/**
 * PNG bytes を TEMP 経由で検証用に書く（最終名ではない）。
 */
export function writeTempPng(options: {
  captureDir: string;
  pngBytes: Buffer;
  hooks?: PersistCaptureHooks;
}): string {
  fs.mkdirSync(options.captureDir, { recursive: true });
  const stamp = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const tempPath = path.join(
    options.captureDir,
    `.capture-temp.${stamp}.png.tmp`,
  );
  options.hooks?.beforeTempPngWrite?.(tempPath);
  if (options.hooks?.failTempPngWrite) {
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_WRITE_FAILED',
      'TEMP PNG の書き込みに失敗しました（テスト注入）。',
    );
  }
  try {
    fs.writeFileSync(tempPath, options.pngBytes);
  } catch (err) {
    safeUnlink(tempPath);
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_WRITE_FAILED',
      `TEMP PNG の書き込みに失敗しました。原因: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return tempPath;
}

export type CommitCaptureResult = {
  status: 'created' | 'updated' | 'unchanged';
  metadata: DeviceCaptureMetadata;
  metaPath: string;
  imagePath: string;
  warnings: string[];
};

/**
 * meta.json の atomic 置換が commit point。
 * no-op 時は何も書かない。
 */
export function commitDeviceCapture(options: {
  captureDir: string;
  metadata: DeviceCaptureMetadata;
  pngBytes: Buffer;
  previousMetaJson?: string | null;
  hooks?: PersistCaptureHooks;
}): CommitCaptureResult {
  const warnings: string[] = [];
  const metaPath = path.join(options.captureDir, 'meta.json');
  const metaJson = serializeDeviceCaptureMetadata(options.metadata);

  // 同一結果 no-op
  if (
    options.previousMetaJson != null &&
    options.previousMetaJson === metaJson
  ) {
    return {
      status: 'unchanged',
      metadata: options.metadata,
      metaPath,
      imagePath: path.join(options.captureDir, options.metadata.imageFile),
      warnings,
    };
  }

  // no-op: 意味的に同一（capturedAt 以外も比較済みの serialize 一致）
  // 既存 meta を読んで比較する場合は呼び出し側で previous を渡す。
  // ここでも既存ファイルと比較する。
  if (fs.existsSync(metaPath)) {
    try {
      const existing = fs.readFileSync(metaPath, 'utf8');
      if (existing === metaJson) {
        return {
          status: 'unchanged',
          metadata: options.metadata,
          metaPath,
          imagePath: path.join(options.captureDir, options.metadata.imageFile),
          warnings,
        };
      }
      // capturedAt 以外が同一なら no-op（呼び出し側で metadata を再構築済みの想定）
    } catch {
      // continue
    }
  }

  const existed = fs.existsSync(metaPath);

  let published: { imageFile: string; imagePath: string; created: boolean };
  try {
    published = publishGenerationImage({
      captureDir: options.captureDir,
      imageRevision: options.metadata.imageRevision,
      pngBytes: options.pngBytes,
      hooks: options.hooks,
    });
  } catch (err) {
    throw err;
  }

  if (options.hooks?.failMetaTempWrite) {
    // 新 image を作った場合は削除
    if (published.created) {
      safeUnlink(published.imagePath);
    }
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_WRITE_FAILED',
      'metadata TEMP の書き込みに失敗しました（テスト注入）。',
    );
  }

  if (options.hooks?.failMetaAtomicReplace) {
    if (published.created) {
      safeUnlink(published.imagePath);
    }
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_WRITE_FAILED',
      'metadata の atomic 置換に失敗しました（テスト注入）。',
    );
  }

  const writeFn = options.hooks?.writeFileAtomicFn || writeFileAtomic;
  try {
    const result = writeFn(metaPath, metaJson);
    if (result.status === 'conflict') {
      if (published.created) {
        safeUnlink(published.imagePath);
      }
      throw createDeviceCaptureError(
        'SPEC_DEVICE_CAPTURE_WRITE_FAILED',
        'metadata の書き込みが競合しました。',
      );
    }
    if (result.status === 'unchanged' && !existed) {
      // ありえないが安全側
    }
  } catch (err) {
    if (published.created) {
      safeUnlink(published.imagePath);
    }
    if (err instanceof Error && err.name === 'DeviceCaptureError') {
      throw err;
    }
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_WRITE_FAILED',
      `metadata の書き込みに失敗しました。原因: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // orphan cleanup
  try {
    cleanupOrphanGenerationImages({
      captureDir: options.captureDir,
      keepImageFile: options.metadata.imageFile,
    });
  } catch (err) {
    warnings.push(
      `未参照画像の整理に失敗しました: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return {
    status: existed ? 'updated' : 'created',
    metadata: options.metadata,
    metaPath,
    imagePath: published.imagePath,
    warnings,
  };
}

/**
 * 正常 naming の generation PNG のうち、現 meta が参照しないものを削除。
 */
export function cleanupOrphanGenerationImages(options: {
  captureDir: string;
  keepImageFile: string;
}): string[] {
  if (!fs.existsSync(options.captureDir)) {
    return [];
  }
  const removed: string[] = [];
  for (const name of fs.readdirSync(options.captureDir)) {
    if (!GENERATION_IMAGE_RE.test(name)) {
      continue;
    }
    if (name === options.keepImageFile) {
      continue;
    }
    const full = path.join(options.captureDir, name);
    try {
      fs.unlinkSync(full);
      removed.push(name);
    } catch {
      // best-effort
    }
  }
  return removed;
}

export function cleanupTempFilesInDir(captureDir: string): void {
  if (!fs.existsSync(captureDir)) {
    return;
  }
  for (const name of fs.readdirSync(captureDir)) {
    if (name.endsWith('.tmp') || name.startsWith('.capture-temp.')) {
      safeUnlink(path.join(captureDir, name));
    }
  }
}

/** OS TEMP に PNG を書く（captureDir 汚染回避用） */
export function writeOsTempPng(pngBytes: Buffer): string {
  const tempPath = path.join(
    os.tmpdir(),
    `jskim-device-capture-${process.pid}-${Date.now()}.png`,
  );
  fs.writeFileSync(tempPath, pngBytes);
  return tempPath;
}
