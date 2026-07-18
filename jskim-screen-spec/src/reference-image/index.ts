export {
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGE_HEIGHT,
  MAX_REFERENCE_IMAGE_WIDTH,
  REFERENCE_GENERATION_IMAGE_RE,
  REFERENCE_IMAGE_FORMAT,
  REFERENCE_IMAGE_SCHEMA_VERSION,
  VIEWPORT_PRESETS,
  getViewportPreset,
  isViewportId,
  referenceGenerationImageFileName,
  type ViewportId,
  type ViewportPreset,
} from './presets.js';

export {
  ReferenceImageError,
  createReferenceImageError,
  type ReferenceImageErrorCode,
} from './errors.js';

export type {
  DeleteReferenceImageOptions,
  DeleteReferenceImageResult,
  GetReferenceImageStatusOptions,
  PutReferenceImageOptions,
  PutReferenceImageResult,
  ReferenceImageMetadata,
  ReferenceImageSource,
  ReferenceImageStatus,
  ReferenceImageViewportMeta,
} from './types.js';

export { assertReferencePngBuffer } from './png-validate.js';

export {
  isSafeReferenceImageFileName,
  parseReferenceImageMetadata,
  readReferenceImageMetadataFile,
  serializeReferenceImageMetadata,
  validatePersistedReferenceImage,
} from './validate-metadata.js';

export {
  getReferenceImageStatus,
  type GetReferenceImageStatusResult,
} from './status.js';

export {
  getReferenceImagePublicInfo,
  viewerReferenceImagePath,
  type ReferenceImagePublicInfo,
} from './public-info.js';

export {
  resolveViewerReferenceImages,
  type ViewerReferenceImageEntry,
  type ViewerReferenceImages,
  type ReferenceImageOutputFile,
} from './manifest-references.js';

export {
  putReferenceImage,
  type PutReferenceImageInternalHooks,
} from './put-reference-image.js';

export {
  deleteReferenceImage,
  type DeleteReferenceImageInternalHooks,
} from './delete-reference-image.js';

export {
  referenceImageLockKey,
  withReferenceImageLock,
  referenceImageLockSizeForTest,
  resetReferenceImageLocksForTest,
} from './key-lock.js';

export {
  referenceMetaPath,
  referenceViewportDir,
  referencesRootDir,
} from './paths.js';

export {
  cleanupOrphanReferenceGenerationImages,
  commitReferenceImage,
  type PersistReferenceHooks,
} from './persist-reference.js';

export { assertReferenceImageScreenExists } from './screen-exists.js';
