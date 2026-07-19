import type { ViewportId } from '../reference-image/presets.js';
import type { PutReferenceImageResult } from '../reference-image/types.js';
import type { FigmaErrorDetails } from './errors.js';

export const FIGMA_API_BASE_URL = 'https://api.figma.com';

/** Figma download / Reference upload と同じ 20 MiB */
export const FIGMA_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const FIGMA_DEFAULT_EXPORT_SCALE = 1 as const;

export const FIGMA_DEFAULT_OPERATION_DEADLINE_MS = 120_000;
export const FIGMA_DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const FIGMA_DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
export const FIGMA_DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
export const FIGMA_MAX_RETRIES_429 = 3;
export const FIGMA_MAX_REDIRECTS = 5;

export type FigmaFileNodeRef = {
  fileKey: string;
  nodeId: string;
};

export type FigmaFrameInfo = {
  fileKey: string;
  nodeId: string;
  frameName: string;
  width: number;
  height: number;
};

export type FigmaExportImage = {
  fileKey: string;
  nodeId: string;
  imageUrl: string;
  exportScale: typeof FIGMA_DEFAULT_EXPORT_SCALE;
};

export type FigmaParseInput =
  | { figmaUrl: string; fileKey?: undefined; nodeId?: undefined }
  | { fileKey: string; nodeId: string; figmaUrl?: undefined };

export type FigmaViewportSizeMismatch = {
  code: 'SPEC_FIGMA_VIEWPORT_SIZE_MISMATCH';
  message: string;
  frameWidth: number;
  frameHeight: number;
  viewportWidth: number;
  viewportHeight: number;
};

export type ImportFigmaReferenceImageOptions = {
  rootDir: string;
  projectName: string;
  screenId: string;
  viewport: ViewportId;
  expectedImageRevision?: string | null;
  /** URL または fileKey+nodeId（同時指定は不可） */
  figmaUrl?: string;
  fileKey?: string;
  nodeId?: string;
  /** 未指定時は process.env / env から解決 */
  token?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** テスト用: 現在時刻 ms */
  nowMs?: () => number;
  /** テスト用: retry 待機（実 sleep を避ける） */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  operationDeadlineMs?: number;
  requestTimeoutMs?: number;
  downloadTimeoutMs?: number;
  apiBaseUrl?: string;
  /** テスト用: put 時点の時刻 */
  nowIso?: () => string;
};

export type ReimportFigmaReferenceImageOptions = {
  rootDir: string;
  projectName: string;
  screenId: string;
  viewport: ViewportId;
  expectedImageRevision: string;
  token?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  operationDeadlineMs?: number;
  requestTimeoutMs?: number;
  downloadTimeoutMs?: number;
  apiBaseUrl?: string;
  nowIso?: () => string;
};

export type ImportFigmaReferenceImageResult = PutReferenceImageResult & {
  frame: FigmaFrameInfo;
  sizeMismatch?: FigmaViewportSizeMismatch;
  rateLimit?: FigmaErrorDetails;
};
