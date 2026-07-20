export type FeatureErrorCode =
  | 'SPEC_FEATURE_FILE_NOT_FOUND'
  | 'SPEC_FEATURE_INVALID_FORMAT'
  | 'SPEC_FEATURE_UNSUPPORTED_SCHEMA'
  | 'SPEC_FEATURE_DUPLICATE_ID'
  | 'SPEC_FEATURE_ORDER_CONFLICT'
  | 'SPEC_FEATURE_UNKNOWN_SCREEN'
  | 'SPEC_FEATURE_DUPLICATE_MEMBERSHIP'
  | 'SPEC_FEATURE_WRITE_FAILED'
  | 'SPEC_FEATURE_RENAME_FAILED';

export class FeatureError extends Error {
  readonly code: FeatureErrorCode;

  constructor(code: FeatureErrorCode, message: string) {
    super(message);
    this.name = 'FeatureError';
    this.code = code;
  }
}

export function createFeatureError(
  code: FeatureErrorCode,
  message: string,
): FeatureError {
  return new FeatureError(code, message);
}
