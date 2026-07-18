export {
  CAPTURE_POLICY_VERSION,
  DEVICE_CAPTURE_FORMAT,
  DEVICE_CAPTURE_FULL_PAGE,
  GENERATION_IMAGE_RE,
  MAX_CAPTURE_IMAGE_HEIGHT,
  MAX_CAPTURE_IMAGE_WIDTH,
  VIEWPORT_PRESETS,
  generationImageFileName,
  getViewportPreset,
  type ViewportId,
  type ViewportPreset,
} from './presets.js';

export {
  DeviceCaptureError,
  createDeviceCaptureError,
  type DeviceCaptureErrorCode,
} from './errors.js';

export type {
  CollectDeviceCaptureOptions,
  CollectDeviceCaptureResult,
  DeviceCaptureMetadata,
  DeviceCaptureStatus,
  DeviceCaptureViewportMeta,
} from './types.js';

export {
  computeImageRevision,
  computeInputRevision,
  loadDeviceCaptureInputContext,
  type DeviceCaptureInputContext,
} from './input-revision.js';

export {
  assertPngBuffer,
  readPngDimensions,
} from './png-dimensions.js';

export {
  isSafeImageFileName,
  parseDeviceCaptureMetadata,
  readDeviceCaptureMetadataFile,
  serializeDeviceCaptureMetadata,
  validatePersistedCapture,
} from './validate-metadata.js';

export {
  getDeviceCaptureStatus,
  type GetDeviceCaptureStatusOptions,
  type GetDeviceCaptureStatusResult,
} from './status.js';

export {
  collectDeviceCapture,
  collectDeviceCaptureOwned,
  collectDeviceCaptureWithBrowser,
  type CollectDeviceCaptureInternalHooks,
} from './collect-device-capture.js';

export {
  enqueueDeviceCapture,
  getDeviceCaptureQueueDepth,
  resetDeviceCaptureQueuesForTests,
} from './project-queue.js';

export {
  captureMetaPath,
  captureViewportDir,
  capturesRootDir,
} from './paths.js';

export {
  cleanupOrphanGenerationImages,
  commitDeviceCapture,
  type PersistCaptureHooks,
} from './persist-capture.js';
