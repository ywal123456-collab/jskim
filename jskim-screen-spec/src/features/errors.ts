export type FeatureErrorCode =
  | 'SPEC_FEATURE_FILE_NOT_FOUND'
  | 'SPEC_FEATURE_INVALID_FORMAT'
  | 'SPEC_FEATURE_UNSUPPORTED_SCHEMA'
  | 'SPEC_FEATURE_DUPLICATE_ID'
  | 'SPEC_FEATURE_ORDER_CONFLICT'
  | 'SPEC_FEATURE_UNKNOWN_SCREEN'
  | 'SPEC_FEATURE_DUPLICATE_MEMBERSHIP'
  | 'SPEC_FEATURE_DUPLICATE_KNOWN_SCREEN'
  | 'SPEC_FEATURE_WRITE_FAILED'
  | 'SPEC_FEATURE_RENAME_FAILED'
  | 'SPEC_FEATURE_REVISION_CONFLICT'
  | 'SPEC_FEATURE_IN_PROGRESS'
  | 'SPEC_FEATURE_NOT_FOUND'
  | 'SPEC_FEATURE_INVALID_INPUT'
  | 'SPEC_FEATURE_DISPLAY_ORDER_LIMIT';

export class FeatureError extends Error {
  readonly code: FeatureErrorCode;
  readonly expectedRevision?: string | null;
  readonly currentRevision?: string | null;

  constructor(
    code: FeatureErrorCode,
    message: string,
    extra: {
      expectedRevision?: string | null;
      currentRevision?: string | null;
    } = {},
  ) {
    super(message);
    this.name = 'FeatureError';
    this.code = code;
    if (Object.prototype.hasOwnProperty.call(extra, 'expectedRevision')) {
      this.expectedRevision = extra.expectedRevision;
    }
    if (Object.prototype.hasOwnProperty.call(extra, 'currentRevision')) {
      this.currentRevision = extra.currentRevision;
    }
  }
}

export function createFeatureError(
  code: FeatureErrorCode,
  message: string,
  extra: {
    expectedRevision?: string | null;
    currentRevision?: string | null;
  } = {},
): FeatureError {
  return new FeatureError(code, message, extra);
}
