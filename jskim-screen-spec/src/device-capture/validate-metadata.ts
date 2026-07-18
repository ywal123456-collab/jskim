import fs from 'node:fs';
import path from 'node:path';
import {
  GENERATION_IMAGE_RE,
  type ViewportId,
} from './presets.js';
import type { DeviceCaptureMetadata } from './types.js';
import { computeContentRevision } from '../util/write-file-atomic.js';
import { assertPngBuffer } from './png-dimensions.js';

const KNOWN_KEYS = new Set([
  'schemaVersion',
  'screenId',
  'stateId',
  'viewport',
  'format',
  'fullPage',
  'deviceScaleFactor',
  'inputRevision',
  'imageFile',
  'imageRevision',
  'imageWidth',
  'imageHeight',
  'capturedAt',
]);

export type ValidateMetadataResult =
  | { ok: true; metadata: DeviceCaptureMetadata }
  | { ok: false; reason: string };

function isSha256Revision(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const t = Date.parse(value);
  return Number.isFinite(t);
}

/**
 * imageFile は basename のみ。path traversal / 絶対 path / URL を拒否。
 */
export function isSafeImageFileName(imageFile: unknown): imageFile is string {
  if (typeof imageFile !== 'string' || imageFile.length === 0) {
    return false;
  }
  if (imageFile !== path.basename(imageFile)) {
    return false;
  }
  if (imageFile.includes('/') || imageFile.includes('\\')) {
    return false;
  }
  if (imageFile.includes('..')) {
    return false;
  }
  if (/^[a-zA-Z]:/.test(imageFile) || imageFile.startsWith('\\\\')) {
    return false;
  }
  if (/^[a-z]+:\/\//i.test(imageFile)) {
    return false;
  }
  return GENERATION_IMAGE_RE.test(imageFile);
}

export function parseDeviceCaptureMetadata(
  raw: unknown,
): ValidateMetadataResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'metadata が object ではありません。' };
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) {
      return { ok: false, reason: `未知のフィールドがあります: ${key}` };
    }
  }

  if (obj.schemaVersion !== '1.0') {
    return { ok: false, reason: 'schemaVersion が未対応です。' };
  }
  if (typeof obj.screenId !== 'string' || !obj.screenId) {
    return { ok: false, reason: 'screenId が不正です。' };
  }
  if (typeof obj.stateId !== 'string' || !obj.stateId) {
    return { ok: false, reason: 'stateId が不正です。' };
  }
  if (!obj.viewport || typeof obj.viewport !== 'object') {
    return { ok: false, reason: 'viewport が不正です。' };
  }
  const vp = obj.viewport as Record<string, unknown>;
  if (vp.id !== 'pc' && vp.id !== 'sp') {
    return { ok: false, reason: 'viewport.id が不正です。' };
  }
  if (
    typeof vp.width !== 'number' ||
    typeof vp.height !== 'number' ||
    !Number.isInteger(vp.width) ||
    !Number.isInteger(vp.height) ||
    vp.width <= 0 ||
    vp.height <= 0
  ) {
    return { ok: false, reason: 'viewport 寸法が不正です。' };
  }
  if (obj.format !== 'png') {
    return { ok: false, reason: 'format は png のみです。' };
  }
  if (obj.fullPage !== true) {
    return { ok: false, reason: 'fullPage は true のみです。' };
  }
  if (obj.deviceScaleFactor !== 1) {
    return { ok: false, reason: 'deviceScaleFactor が不正です。' };
  }
  if (!isSha256Revision(obj.inputRevision)) {
    return { ok: false, reason: 'inputRevision が不正です。' };
  }
  if (!isSafeImageFileName(obj.imageFile)) {
    return { ok: false, reason: 'imageFile が不正です。' };
  }
  if (!isSha256Revision(obj.imageRevision)) {
    return { ok: false, reason: 'imageRevision が不正です。' };
  }
  if (
    typeof obj.imageWidth !== 'number' ||
    typeof obj.imageHeight !== 'number' ||
    !Number.isInteger(obj.imageWidth) ||
    !Number.isInteger(obj.imageHeight) ||
    obj.imageWidth <= 0 ||
    obj.imageHeight <= 0
  ) {
    return { ok: false, reason: 'imageWidth/imageHeight が不正です。' };
  }
  if (!isIsoDate(obj.capturedAt)) {
    return { ok: false, reason: 'capturedAt が不正です。' };
  }

  const expectedFile = `capture-${obj.imageRevision.slice('sha256:'.length)}.png`;
  if (obj.imageFile !== expectedFile) {
    return {
      ok: false,
      reason: 'imageFile と imageRevision が一致しません。',
    };
  }

  return {
    ok: true,
    metadata: {
      schemaVersion: '1.0',
      screenId: obj.screenId,
      stateId: obj.stateId,
      viewport: {
        id: vp.id,
        width: vp.width,
        height: vp.height,
      },
      format: 'png',
      fullPage: true,
      deviceScaleFactor: 1,
      inputRevision: obj.inputRevision,
      imageFile: obj.imageFile,
      imageRevision: obj.imageRevision,
      imageWidth: obj.imageWidth,
      imageHeight: obj.imageHeight,
      capturedAt: obj.capturedAt,
    },
  };
}

export function readDeviceCaptureMetadataFile(
  metaPath: string,
): ValidateMetadataResult {
  if (!fs.existsSync(metaPath)) {
    return { ok: false, reason: 'meta.json がありません。' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return { ok: false, reason: 'meta.json の JSON が不正です。' };
  }
  return parseDeviceCaptureMetadata(parsed);
}

/**
 * metadata + 画像ファイルの整合を検証する。
 */
export function validatePersistedCapture(options: {
  metaPath: string;
  expectedScreenId: string;
  expectedStateId: string;
  expectedViewport: ViewportId;
}): ValidateMetadataResult & { imagePath?: string } {
  const parsed = readDeviceCaptureMetadataFile(options.metaPath);
  if (!parsed.ok) {
    return parsed;
  }
  const { metadata } = parsed;
  if (metadata.screenId !== options.expectedScreenId) {
    return { ok: false, reason: 'metadata.screenId が経路と一致しません。' };
  }
  if (metadata.stateId !== options.expectedStateId) {
    return { ok: false, reason: 'metadata.stateId が経路と一致しません。' };
  }
  if (metadata.viewport.id !== options.expectedViewport) {
    return { ok: false, reason: 'metadata.viewport.id が経路と一致しません。' };
  }

  const dir = path.dirname(options.metaPath);
  const imagePath = path.join(dir, metadata.imageFile);
  if (!fs.existsSync(imagePath)) {
    return { ok: false, reason: '参照画像がありません。' };
  }

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(imagePath);
  } catch {
    return { ok: false, reason: '参照画像を読めません。' };
  }

  try {
    const dim = assertPngBuffer(bytes);
    if (
      dim.width !== metadata.imageWidth ||
      dim.height !== metadata.imageHeight
    ) {
      return { ok: false, reason: '画像寸法が metadata と一致しません。' };
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'PNG 検証に失敗しました。',
    };
  }

  const actualRevision = computeContentRevision(bytes);
  if (actualRevision !== metadata.imageRevision) {
    return { ok: false, reason: 'imageRevision が画像内容と一致しません。' };
  }

  return { ok: true, metadata, imagePath };
}

/** canonical JSON（安定 field 順・indent 2・末尾改行） */
export function serializeDeviceCaptureMetadata(
  metadata: DeviceCaptureMetadata,
): string {
  const ordered: DeviceCaptureMetadata = {
    schemaVersion: metadata.schemaVersion,
    screenId: metadata.screenId,
    stateId: metadata.stateId,
    viewport: {
      id: metadata.viewport.id,
      width: metadata.viewport.width,
      height: metadata.viewport.height,
    },
    format: metadata.format,
    fullPage: metadata.fullPage,
    deviceScaleFactor: metadata.deviceScaleFactor,
    inputRevision: metadata.inputRevision,
    imageFile: metadata.imageFile,
    imageRevision: metadata.imageRevision,
    imageWidth: metadata.imageWidth,
    imageHeight: metadata.imageHeight,
    capturedAt: metadata.capturedAt,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
