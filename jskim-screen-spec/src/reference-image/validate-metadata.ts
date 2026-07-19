import fs from 'node:fs';
import path from 'node:path';
import { computeContentRevision } from '../util/write-file-atomic.js';
import { parsePngIhdr } from '../util/png-ihdr.js';
import {
  MAX_REFERENCE_IMAGE_HEIGHT,
  MAX_REFERENCE_IMAGE_WIDTH,
  REFERENCE_GENERATION_IMAGE_RE,
  type ViewportId,
} from './presets.js';
import type { ReferenceImageMetadata } from './types.js';

const KNOWN_KEYS = new Set([
  'schemaVersion',
  'screenId',
  'viewport',
  'format',
  'imageFile',
  'imageRevision',
  'imageWidth',
  'imageHeight',
  'uploadedAt',
  'source',
]);

const SOURCE_UPLOAD_KEYS = new Set(['type']);
const SOURCE_FIGMA_KEYS = new Set([
  'type',
  'fileKey',
  'nodeId',
  'frameName',
  'importedAt',
  'exportScale',
]);

export type ValidateMetadataResult =
  | { ok: true; metadata: ReferenceImageMetadata }
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
export function isSafeReferenceImageFileName(
  imageFile: unknown,
): imageFile is string {
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
  return REFERENCE_GENERATION_IMAGE_RE.test(imageFile);
}

export function parseReferenceImageMetadata(
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
  if (!isSafeReferenceImageFileName(obj.imageFile)) {
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
  if (!isIsoDate(obj.uploadedAt)) {
    return { ok: false, reason: 'uploadedAt が不正です。' };
  }
  if (!obj.source || typeof obj.source !== 'object' || Array.isArray(obj.source)) {
    return { ok: false, reason: 'source が不正です。' };
  }
  const sourceRaw = obj.source as Record<string, unknown>;
  const parsedSource = parseReferenceImageSource(sourceRaw);
  if (!parsedSource.ok) {
    return { ok: false, reason: parsedSource.reason };
  }

  const expectedFile = `reference-${obj.imageRevision.slice('sha256:'.length)}.png`;
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
      viewport: {
        id: vp.id,
        width: vp.width,
        height: vp.height,
      },
      format: 'png',
      imageFile: obj.imageFile,
      imageRevision: obj.imageRevision,
      imageWidth: obj.imageWidth,
      imageHeight: obj.imageHeight,
      uploadedAt: obj.uploadedAt,
      source: parsedSource.source,
    },
  };
}

function parseReferenceImageSource(
  source: Record<string, unknown>,
):
  | { ok: true; source: ReferenceImageMetadata['source'] }
  | { ok: false; reason: string } {
  if (source.type === 'upload') {
    for (const key of Object.keys(source)) {
      if (!SOURCE_UPLOAD_KEYS.has(key)) {
        return {
          ok: false,
          reason: `source に未知のフィールドがあります: ${key}`,
        };
      }
    }
    return { ok: true, source: { type: 'upload' } };
  }

  if (source.type === 'figma') {
    for (const key of Object.keys(source)) {
      if (!SOURCE_FIGMA_KEYS.has(key)) {
        return {
          ok: false,
          reason: `source に未知のフィールドがあります: ${key}`,
        };
      }
    }
    if (typeof source.fileKey !== 'string' || !source.fileKey.trim()) {
      return { ok: false, reason: 'source.fileKey が不正です。' };
    }
    if (
      typeof source.nodeId !== 'string' ||
      !/^\d+:\d+$/.test(source.nodeId)
    ) {
      return { ok: false, reason: 'source.nodeId が不正です。' };
    }
    if (typeof source.frameName !== 'string' || !source.frameName.trim()) {
      return { ok: false, reason: 'source.frameName が不正です。' };
    }
    if (!isIsoDate(source.importedAt)) {
      return { ok: false, reason: 'source.importedAt が不正です。' };
    }
    if (source.exportScale !== 1) {
      return { ok: false, reason: 'source.exportScale が不正です。' };
    }
    // path injection 防止（basename 相当の安全文字のみを強制しないが separator は拒否）
    if (
      source.fileKey.includes('/') ||
      source.fileKey.includes('\\') ||
      source.fileKey.includes('..')
    ) {
      return { ok: false, reason: 'source.fileKey が不正です。' };
    }
    return {
      ok: true,
      source: {
        type: 'figma',
        fileKey: source.fileKey,
        nodeId: source.nodeId,
        frameName: source.frameName,
        importedAt: source.importedAt,
        exportScale: 1,
      },
    };
  }

  return { ok: false, reason: 'source.type が不正です。' };
}

export function readReferenceImageMetadataFile(
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
  return parseReferenceImageMetadata(parsed);
}

/**
 * metadata + 画像ファイルの整合を検証する。
 */
export function validatePersistedReferenceImage(options: {
  metaPath: string;
  expectedScreenId: string;
  expectedViewport: ViewportId;
}): ValidateMetadataResult & { imagePath?: string } {
  const parsed = readReferenceImageMetadataFile(options.metaPath);
  if (!parsed.ok) {
    return parsed;
  }
  const { metadata } = parsed;
  if (metadata.screenId !== options.expectedScreenId) {
    return { ok: false, reason: 'metadata.screenId が経路と一致しません。' };
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

  const dim = parsePngIhdr(bytes);
  if (!dim.ok) {
    return { ok: false, reason: dim.reason };
  }
  if (
    dim.width > MAX_REFERENCE_IMAGE_WIDTH ||
    dim.height > MAX_REFERENCE_IMAGE_HEIGHT
  ) {
    return { ok: false, reason: '画像寸法が上限を超えています。' };
  }
  if (
    dim.width !== metadata.imageWidth ||
    dim.height !== metadata.imageHeight
  ) {
    return { ok: false, reason: '画像寸法が metadata と一致しません。' };
  }

  const actualRevision = computeContentRevision(bytes);
  if (actualRevision !== metadata.imageRevision) {
    return { ok: false, reason: 'imageRevision が画像内容と一致しません。' };
  }

  return { ok: true, metadata, imagePath };
}

/** canonical JSON（安定 field 順・indent 2・末尾改行） */
export function serializeReferenceImageMetadata(
  metadata: ReferenceImageMetadata,
): string {
  const ordered: ReferenceImageMetadata = {
    schemaVersion: metadata.schemaVersion,
    screenId: metadata.screenId,
    viewport: {
      id: metadata.viewport.id,
      width: metadata.viewport.width,
      height: metadata.viewport.height,
    },
    format: metadata.format,
    imageFile: metadata.imageFile,
    imageRevision: metadata.imageRevision,
    imageWidth: metadata.imageWidth,
    imageHeight: metadata.imageHeight,
    uploadedAt: metadata.uploadedAt,
    source:
      metadata.source.type === 'upload'
        ? { type: 'upload' }
        : {
            type: 'figma',
            fileKey: metadata.source.fileKey,
            nodeId: metadata.source.nodeId,
            frameName: metadata.source.frameName,
            importedAt: metadata.source.importedAt,
            exportScale: metadata.source.exportScale,
          },
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
