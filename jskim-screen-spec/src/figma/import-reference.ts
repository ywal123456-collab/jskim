import { createFigmaApiClient } from './client.js';
import { downloadFigmaPng } from './download-image.js';
import { createFigmaError } from './errors.js';
import { parseFigmaInput } from './parse-input.js';
import { resolveFigmaToken } from './token.js';
import {
  FIGMA_DEFAULT_EXPORT_SCALE,
  type FigmaFrameInfo,
  type FigmaViewportSizeMismatch,
  type FigmaWidthMismatchConfirmation,
  type ImportFigmaReferenceImageOptions,
  type ImportFigmaReferenceImageResult,
  type ReimportFigmaReferenceImageOptions,
} from './types.js';
import { getViewportPreset } from '../reference-image/presets.js';
import { putReferenceImage } from '../reference-image/put-reference-image.js';
import { getReferenceImageStatus } from '../reference-image/status.js';
import type { ReferenceImageSourceFigma } from '../reference-image/types.js';

function buildSizeMismatch(
  frameWidth: number,
  frameHeight: number,
  viewport: 'pc' | 'sp',
): FigmaViewportSizeMismatch | undefined {
  const preset = getViewportPreset(viewport);
  if (frameWidth === preset.width && frameHeight === preset.height) {
    return undefined;
  }
  return {
    code: 'SPEC_FIGMA_VIEWPORT_SIZE_MISMATCH',
    message: 'Frame サイズが viewport プリセットと異なります。',
    frameWidth,
    frameHeight,
    viewportWidth: preset.width,
    viewportHeight: preset.height,
  };
}

function buildWidthMismatchConfirmation(
  frame: FigmaFrameInfo,
  viewport: 'pc' | 'sp',
): FigmaWidthMismatchConfirmation {
  const preset = getViewportPreset(viewport);
  return {
    code: 'SPEC_FIGMA_WIDTH_MISMATCH',
    frame: {
      frameName: frame.frameName,
      width: frame.width,
      height: frame.height,
    },
    viewport: {
      width: preset.width,
      height: preset.height,
    },
  };
}

type FetchTransport = {
  fileKey: string;
  nodeId: string;
  token: string;
  viewport: 'pc' | 'sp';
  confirmWidthMismatch?: boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  operationDeadlineMs?: number;
  requestTimeoutMs?: number;
  downloadTimeoutMs?: number;
  apiBaseUrl?: string;
};

type FetchOutcome =
  | {
      kind: 'confirmation-required';
      confirmation: FigmaWidthMismatchConfirmation;
    }
  | {
      kind: 'ready';
      frame: FigmaFrameInfo;
      pngBytes: Buffer;
      exportScale: typeof FIGMA_DEFAULT_EXPORT_SCALE;
    };

/**
 * Frame 取得後、幅不一致かつ未確認なら export/download せず confirmation を返す。
 */
async function fetchFigmaPngAndFrame(
  options: FetchTransport,
): Promise<FetchOutcome> {
  const startedAt = (options.nowMs ?? Date.now)();
  const client = createFigmaApiClient({
    token: options.token,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    nowMs: options.nowMs,
    sleep: options.sleep,
    operationDeadlineMs: options.operationDeadlineMs,
    requestTimeoutMs: options.requestTimeoutMs,
    apiBaseUrl: options.apiBaseUrl,
    operationStartedAtMs: startedAt,
  });

  const frame = await client.getFrame(options.fileKey, options.nodeId);
  const preset = getViewportPreset(options.viewport);
  const confirmed = options.confirmWidthMismatch === true;
  if (!confirmed && frame.width !== preset.width) {
    return {
      kind: 'confirmation-required',
      confirmation: buildWidthMismatchConfirmation(frame, options.viewport),
    };
  }

  const exported = await client.getPngExportUrl(options.fileKey, options.nodeId);
  const pngBytes = await downloadFigmaPng({
    imageUrl: exported.imageUrl,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    downloadTimeoutMs: options.downloadTimeoutMs,
    operationDeadlineMs: options.operationDeadlineMs,
    operationStartedAtMs: startedAt,
    nowMs: options.nowMs,
  });

  return {
    kind: 'ready',
    frame,
    pngBytes,
    exportScale: exported.exportScale,
  };
}

/**
 * Figma Frame を PNG export し、既存 Reference Image 契約へ保存する。
 */
export async function importFigmaReferenceImage(
  options: ImportFigmaReferenceImageOptions,
): Promise<ImportFigmaReferenceImageResult> {
  const urlProvided = options.figmaUrl !== undefined;
  const directProvided =
    options.fileKey !== undefined || options.nodeId !== undefined;
  if (urlProvided && directProvided) {
    throw createFigmaError(
      'SPEC_FIGMA_INPUT_INVALID',
      'Figma URL と fileKey/nodeId を同時に指定できません。',
    );
  }
  const parsed = urlProvided
    ? parseFigmaInput({ figmaUrl: options.figmaUrl! })
    : parseFigmaInput({
        fileKey: options.fileKey ?? '',
        nodeId: options.nodeId ?? '',
      });

  const token = resolveFigmaToken({
    token: options.token,
    env: options.env,
  });

  const fetched = await fetchFigmaPngAndFrame({
    fileKey: parsed.fileKey,
    nodeId: parsed.nodeId,
    token,
    viewport: options.viewport,
    confirmWidthMismatch: options.confirmWidthMismatch,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    nowMs: options.nowMs,
    sleep: options.sleep,
    operationDeadlineMs: options.operationDeadlineMs,
    requestTimeoutMs: options.requestTimeoutMs,
    downloadTimeoutMs: options.downloadTimeoutMs,
    apiBaseUrl: options.apiBaseUrl,
  });

  if (fetched.kind === 'confirmation-required') {
    return {
      result: 'confirmation-required',
      confirmation: fetched.confirmation,
    };
  }

  const { frame, pngBytes, exportScale } = fetched;
  const importedAt = options.nowIso?.() ?? new Date().toISOString();
  const source: ReferenceImageSourceFigma = {
    type: 'figma',
    fileKey: frame.fileKey,
    nodeId: frame.nodeId,
    frameName: frame.frameName,
    importedAt,
    exportScale,
  };

  const put = await putReferenceImage({
    rootDir: options.rootDir,
    projectName: options.projectName,
    screenId: options.screenId,
    viewport: options.viewport,
    imageBytes: pngBytes,
    expectedImageRevision: options.expectedImageRevision,
    source,
    hooks: options.nowIso ? { now: options.nowIso } : undefined,
  });

  const sizeMismatch = buildSizeMismatch(
    frame.width,
    frame.height,
    options.viewport,
  );

  return {
    ...put,
    frame,
    ...(sizeMismatch ? { sizeMismatch } : {}),
  };
}

/**
 * server-side meta の figma source を用いて再 export する。
 * browser は fileKey/nodeId を送らない前提。
 */
export async function reimportFigmaReferenceImage(
  options: ReimportFigmaReferenceImageOptions,
): Promise<ImportFigmaReferenceImageResult> {
  const status = getReferenceImageStatus({
    rootDir: options.rootDir,
    projectName: options.projectName,
    screenId: options.screenId,
    viewport: options.viewport,
  });

  if (status.status === 'missing') {
    throw createFigmaError(
      'SPEC_FIGMA_SOURCE_MISSING',
      '参照画像が未登録のため Figma Reimport できません。',
    );
  }
  if (status.status === 'invalid' || !status.metadata) {
    throw createFigmaError(
      'SPEC_FIGMA_SOURCE_MISSING',
      '参照画像の metadata が破損しているため Figma Reimport できません。',
    );
  }

  const { source } = status.metadata;
  if (source.type !== 'figma') {
    throw createFigmaError(
      'SPEC_FIGMA_SOURCE_MISSING',
      'Figma source ではない参照画像は Reimport できません。',
    );
  }
  if (
    !source.fileKey ||
    !source.nodeId ||
    typeof source.frameName !== 'string' ||
    source.exportScale !== 1
  ) {
    throw createFigmaError(
      'SPEC_FIGMA_SOURCE_MISSING',
      'Figma source 情報が不完全なため Reimport できません。',
    );
  }

  const token = resolveFigmaToken({
    token: options.token,
    env: options.env,
  });

  const fetched = await fetchFigmaPngAndFrame({
    fileKey: source.fileKey,
    nodeId: source.nodeId,
    token,
    viewport: options.viewport,
    confirmWidthMismatch: options.confirmWidthMismatch,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    nowMs: options.nowMs,
    sleep: options.sleep,
    operationDeadlineMs: options.operationDeadlineMs,
    requestTimeoutMs: options.requestTimeoutMs,
    downloadTimeoutMs: options.downloadTimeoutMs,
    apiBaseUrl: options.apiBaseUrl,
  });

  if (fetched.kind === 'confirmation-required') {
    return {
      result: 'confirmation-required',
      confirmation: fetched.confirmation,
    };
  }

  const { frame, pngBytes, exportScale } = fetched;
  const importedAt = options.nowIso?.() ?? new Date().toISOString();
  const nextSource: ReferenceImageSourceFigma = {
    type: 'figma',
    fileKey: frame.fileKey,
    nodeId: frame.nodeId,
    frameName: frame.frameName,
    importedAt,
    exportScale,
  };

  const put = await putReferenceImage({
    rootDir: options.rootDir,
    projectName: options.projectName,
    screenId: options.screenId,
    viewport: options.viewport,
    imageBytes: pngBytes,
    expectedImageRevision: options.expectedImageRevision,
    source: nextSource,
    hooks: options.nowIso ? { now: options.nowIso } : undefined,
  });

  const sizeMismatch = buildSizeMismatch(
    frame.width,
    frame.height,
    options.viewport,
  );

  return {
    ...put,
    frame,
    ...(sizeMismatch ? { sizeMismatch } : {}),
  };
}
