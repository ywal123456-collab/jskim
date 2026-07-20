export type VersionControlErrorCode =
  | 'SPEC_VERSION_UNSUPPORTED_FORMAT'
  | 'SPEC_VERSION_REPOSITORY_CORRUPT'
  | 'SPEC_VERSION_REPOSITORY_EXISTS'
  | 'SPEC_VERSION_INIT_FAILED'
  | 'SPEC_VERSION_OBJECT_NOT_FOUND'
  | 'SPEC_VERSION_OBJECT_CORRUPT'
  | 'SPEC_VERSION_OBJECT_HASH_MISMATCH'
  | 'SPEC_VERSION_OBJECT_TYPE_MISMATCH'
  | 'SPEC_VERSION_OBJECT_TOO_LARGE'
  | 'SPEC_VERSION_OBJECT_WRITE_FAILED'
  | 'SPEC_VERSION_OBJECT_RENAME_FAILED'
  | 'SPEC_VERSION_INVALID_HASH'
  | 'SPEC_VERSION_INVALID_OBJECT'
  | 'SPEC_VERSION_CANONICAL_JSON_INVALID';

export class VersionControlError extends Error {
  readonly code: VersionControlErrorCode;

  constructor(code: VersionControlErrorCode, message: string) {
    super(message);
    this.name = 'VersionControlError';
    this.code = code;
  }
}

export function createVersionControlError(
  code: VersionControlErrorCode,
  message: string,
): VersionControlError {
  return new VersionControlError(code, message);
}
