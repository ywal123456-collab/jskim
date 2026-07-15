export type SpecCollectErrorCode =
  | 'SPEC_COLLECT_BROWSER_NOT_FOUND'
  | 'SPEC_COLLECT_NAVIGATION_FAILED'
  | 'SPEC_COLLECT_EXTERNAL_REDIRECT'
  | 'SPEC_COLLECT_ACTION_TARGET_NOT_FOUND'
  | 'SPEC_COLLECT_ACTION_TARGET_DUPLICATE'
  | 'SPEC_COLLECT_ACTION_FAILED'
  | 'SPEC_COLLECT_SCREEN_ROOT_NOT_FOUND'
  | 'SPEC_COLLECT_SCREEN_ROOT_DUPLICATE'
  | 'SPEC_COLLECT_SNAPSHOT_WRITE_FAILED'
  | 'SPEC_COLLECT_DESCRIPTION_REVISION_CONFLICT'
  | 'SPEC_COLLECT_WAIT_TOO_LONG';

export type SpecCollectError = Error & {
  code: SpecCollectErrorCode;
};

/**
 * Screen Spec collector 用のエラーを生成する。
 */
export function createError(
  code: SpecCollectErrorCode,
  message: string,
): SpecCollectError {
  const err = new Error(message) as SpecCollectError;
  err.name = 'SpecCollectError';
  err.code = code;
  return err;
}

export function isSpecCollectError(err: unknown): err is SpecCollectError {
  return (
    err instanceof Error &&
    typeof (err as SpecCollectError).code === 'string' &&
    String((err as SpecCollectError).code).startsWith('SPEC_COLLECT_')
  );
}
