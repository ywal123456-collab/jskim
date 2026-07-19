export {
  FigmaError,
  createFigmaError,
  maskSecret,
  maskUrlForLog,
  type FigmaErrorCode,
  type FigmaErrorDetails,
} from './errors.js';

export {
  parseFigmaInput,
  normalizeNodeId,
  validateFileKey,
  validateFigmaUpgradeLink,
} from './parse-input.js';

export {
  resolveFigmaToken,
  describeFigmaTokenPresence,
  JSKIM_FIGMA_TOKEN_ENV,
} from './token.js';

export {
  FigmaApiClient,
  createFigmaApiClient,
  computeRemainingDeadlineMs,
  type FigmaClientOptions,
} from './client.js';

export { downloadFigmaPng, type DownloadFigmaPngOptions } from './download-image.js';

export {
  importFigmaReferenceImage,
  reimportFigmaReferenceImage,
} from './import-reference.js';

export {
  FIGMA_API_BASE_URL,
  FIGMA_MAX_IMAGE_BYTES,
  FIGMA_DEFAULT_EXPORT_SCALE,
  FIGMA_DEFAULT_OPERATION_DEADLINE_MS,
  FIGMA_DEFAULT_REQUEST_TIMEOUT_MS,
  FIGMA_DEFAULT_DOWNLOAD_TIMEOUT_MS,
  FIGMA_MAX_RETRIES_429,
  FIGMA_MAX_REDIRECTS,
  type FigmaFileNodeRef,
  type FigmaFrameInfo,
  type FigmaExportImage,
  type FigmaParseInput,
  type FigmaViewportSizeMismatch,
  type ImportFigmaReferenceImageOptions,
  type ReimportFigmaReferenceImageOptions,
  type ImportFigmaReferenceImageResult,
} from './types.js';
