export type DeviceCaptureErrorCode =
  | 'SPEC_DEVICE_CAPTURE_SCREEN_NOT_FOUND'
  | 'SPEC_DEVICE_CAPTURE_STATE_NOT_FOUND'
  | 'SPEC_DEVICE_CAPTURE_SNAPSHOT_MISSING'
  | 'SPEC_DEVICE_CAPTURE_INPUT_CHANGED'
  | 'SPEC_DEVICE_CAPTURE_INVALID_PNG'
  | 'SPEC_DEVICE_CAPTURE_DIMENSION_LIMIT'
  | 'SPEC_DEVICE_CAPTURE_WRITE_FAILED'
  | 'SPEC_DEVICE_CAPTURE_STABILIZE_TIMEOUT';

export class DeviceCaptureError extends Error {
  readonly code: DeviceCaptureErrorCode;

  constructor(code: DeviceCaptureErrorCode, message: string) {
    super(message);
    this.name = 'DeviceCaptureError';
    this.code = code;
  }
}

export function createDeviceCaptureError(
  code: DeviceCaptureErrorCode,
  message: string,
): DeviceCaptureError {
  return new DeviceCaptureError(code, message);
}
