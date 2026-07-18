export type ReferenceImageErrorCode =
  | 'SPEC_REFERENCE_IMAGE_SCREEN_NOT_FOUND'
  | 'SPEC_REFERENCE_IMAGE_INVALID_VIEWPORT'
  | 'SPEC_REFERENCE_IMAGE_INVALID_PNG'
  | 'SPEC_REFERENCE_IMAGE_FILE_TOO_LARGE'
  | 'SPEC_REFERENCE_IMAGE_DIMENSION_LIMIT'
  | 'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT'
  | 'SPEC_REFERENCE_IMAGE_INVALID'
  | 'SPEC_REFERENCE_IMAGE_NOT_FOUND'
  | 'SPEC_REFERENCE_IMAGE_WRITE_FAILED';

export class ReferenceImageError extends Error {
  readonly code: ReferenceImageErrorCode;

  constructor(code: ReferenceImageErrorCode, message: string) {
    super(message);
    this.name = 'ReferenceImageError';
    this.code = code;
  }
}

export function createReferenceImageError(
  code: ReferenceImageErrorCode,
  message: string,
): ReferenceImageError {
  return new ReferenceImageError(code, message);
}
