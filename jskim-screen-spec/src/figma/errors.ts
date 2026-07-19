export type FigmaErrorCode =
  | 'SPEC_FIGMA_INPUT_INVALID'
  | 'SPEC_FIGMA_TOKEN_MISSING'
  | 'SPEC_FIGMA_UNAUTHORIZED'
  | 'SPEC_FIGMA_FORBIDDEN'
  | 'SPEC_FIGMA_FILE_NOT_FOUND'
  | 'SPEC_FIGMA_NODE_NOT_FOUND'
  | 'SPEC_FIGMA_NODE_NOT_FRAME'
  | 'SPEC_FIGMA_RATE_LIMITED'
  | 'SPEC_FIGMA_EXPORT_FAILED'
  | 'SPEC_FIGMA_DOWNLOAD_FAILED'
  | 'SPEC_FIGMA_RESPONSE_INVALID'
  | 'SPEC_FIGMA_IMAGE_TOO_LARGE'
  | 'SPEC_FIGMA_TIMEOUT'
  | 'SPEC_FIGMA_ABORTED'
  | 'SPEC_FIGMA_SOURCE_MISSING';

export type FigmaErrorDetails = {
  retryAfterSeconds?: number;
  planTier?: string;
  rateLimitType?: string;
  /** 検証済みの公式 URL のみ。未検証リンクは載せない */
  upgradeLink?: string;
};

export class FigmaError extends Error {
  readonly code: FigmaErrorCode;
  readonly details?: FigmaErrorDetails;

  constructor(
    code: FigmaErrorCode,
    message: string,
    details?: FigmaErrorDetails,
  ) {
    super(message);
    this.name = 'FigmaError';
    this.code = code;
    if (details && Object.keys(details).length > 0) {
      this.details = details;
    }
  }
}

export function createFigmaError(
  code: FigmaErrorCode,
  message: string,
  details?: FigmaErrorDetails,
): FigmaError {
  return new FigmaError(code, message, details);
}

/** token / signed URL をメッセージや cause に載せないための簡易マスク */
export function maskSecret(value: string | undefined | null): string {
  if (value == null || value.length === 0) {
    return '';
  }
  if (value.length <= 8) {
    return '***';
  }
  return `${value.slice(0, 2)}…${value.slice(-2)}`;
}

export function maskUrlForLog(urlString: string): string {
  try {
    const u = new URL(urlString);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}
