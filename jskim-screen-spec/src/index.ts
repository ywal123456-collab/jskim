export { buildScreenSpecViewer } from './builder/build-screen-spec-viewer.js';
export type { BuildScreenSpecViewerOptions } from './builder/build-screen-spec-viewer.js';
export { buildScreenSpecViewerAtomic } from './builder/build-screen-spec-viewer-atomic.js';
export {
  classifyScreenSpecWatchPath,
  mergeScreenSpecWatchKinds,
} from './watch/classify-watch-path.js';
export type {
  ScreenSpecWatchKind,
  ClassifyScreenSpecWatchPathOptions,
} from './watch/classify-watch-path.js';
export {
  extractItemIdsInDomOrder,
  computeItemOrder,
} from './builder/item-order.js';
export { sanitizeSnapshot } from './builder/sanitize-snapshot.js';
export { loadScreenSpecProject } from './builder/load-screen-spec-project.js';
export type {
  ScreenSpecStatus,
  LoadedScreen,
  ScreenSpecProject,
} from './builder/load-screen-spec-project.js';
export { createViewerManifest } from './builder/create-viewer-manifest.js';
export { createFileDescriptionStore } from './editing/file-description-store.js';
export type {
  DescriptionReadResult,
  DescriptionWriteResult,
  DescriptionCreateInput,
  DescriptionCreateResult,
  DescriptionDeleteResult,
  FileDescriptionStore,
} from './editing/file-description-store.js';
export {
  withDescriptionScreenLock,
  descriptionScreenLockSizeForTest,
  resetDescriptionScreenLocksForTest,
} from './editing/description-screen-lock.js';
export {
  validateEditableDescriptionDocument,
  toEditableDocument,
  createEmptyEditableDocument,
  buildImplementationDraftDocument,
  SCREEN_ID_RE,
  isValidScreenId,
  isReservedScreenId,
  MAX_SCREEN_ID_LENGTH,
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from './editing/validate-description-document.js';
export type { EditableDescriptionDocument } from './editing/validate-description-document.js';
export {
  writeFileAtomic,
  writeFileAtomicOrThrow,
  createFileAtomic,
  computeContentRevision,
  computeEmptyDescriptionRevision,
  computeDraftRevision,
} from './util/write-file-atomic.js';
export type {
  WriteFileAtomicFs,
  WriteFileAtomicOptions,
  WriteFileAtomicResult,
  CreateFileAtomicResult,
} from './util/write-file-atomic.js';
export { WINDOWS_RESERVED_NAMES } from './util/screen-id.js';
export {
  writeCollectedDescription,
  DESCRIPTION_WRITE_MAX_RETRIES,
} from './collector/write-collected-description.js';
export { collectScreenSpecProject } from './collector/collect-screen-spec-project.js';
export type {
  CollectScreenSpecProjectOptions,
  CollectScreenSpecProjectResult,
} from './collector/collect-screen-spec-project.js';
export {
  collectDeviceCapture,
  collectDeviceCaptureWithBrowser,
  getDeviceCaptureStatus,
  getDeviceCapturePublicInfo,
  computeInputRevision,
  VIEWPORT_PRESETS,
  getViewportPreset,
} from './device-capture/index.js';
export type {
  CollectDeviceCaptureOptions,
  CollectDeviceCaptureResult,
  DeviceCaptureMetadata,
  DeviceCaptureStatus,
  DeviceCapturePublicInfo,
  ViewportId,
  ViewerDeviceCaptures,
} from './device-capture/index.js';
export {
  putReferenceImage,
  deleteReferenceImage,
  getReferenceImageStatus,
  getReferenceImagePublicInfo,
  resolveViewerReferenceImages,
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGE_WIDTH,
  MAX_REFERENCE_IMAGE_HEIGHT,
} from './reference-image/index.js';
export type {
  PutReferenceImageOptions,
  PutReferenceImageResult,
  DeleteReferenceImageOptions,
  DeleteReferenceImageResult,
  ReferenceImageMetadata,
  ReferenceImageSource,
  ReferenceImageSourceFigma,
  ReferenceImageStatus,
  ReferenceImagePublicInfo,
  ViewerReferenceImages,
} from './reference-image/index.js';
export {
  importFigmaReferenceImage,
  reimportFigmaReferenceImage,
  FigmaError,
} from './figma/index.js';
export type {
  ImportFigmaReferenceImageOptions,
  ReimportFigmaReferenceImageOptions,
  ImportFigmaReferenceImageResult,
  FigmaFrameInfo,
  FigmaErrorCode,
} from './figma/index.js';
export {
  rewriteResourceTokens,
  toResourceToken,
  SpecResourceTokenError,
} from './collector/resources/resource-token.js';
export { applyShadowCompatCss } from './collector/resources/shadow-compat-css.js';
export { contentHash12 } from './collector/resources/content-hash.js';
export {
  loadScreenFeatures,
  persistScreenFeatures,
  validateScreenFeatureFile,
  FeatureError,
} from './features/index.js';
export type {
  ScreenFeature,
  ScreenFeatureFile,
  LoadScreenFeaturesResult,
  PersistScreenFeaturesResult,
  FeatureErrorCode,
} from './features/index.js';
export {
  initVersionRepository,
  writeVersionObject,
  readVersionObject,
  hasVersionObject,
  hashVersionObject,
  createWorkingSnapshot,
  persistSnapshotObjects,
  readVersionHead,
  readVersionIndex,
  diffVersionTrees,
  getVersionStatus,
  stageProject,
  stageScreen,
  stageFeature,
  VersionControlError,
  MAX_VERSION_OBJECT_BYTES,
} from './version-control/index.js';
export type {
  InitVersionRepositoryResult,
  WriteVersionObjectResult,
  ReadVersionObjectResult,
  TreeObject,
  CommitObject,
  TagObject,
  VersionControlErrorCode,
  VersionObjectType,
  WorkingSnapshot,
  WorkingSnapshotObject,
  VersionHead,
  VersionIndex,
  ReadVersionIndexResult,
  VersionChange,
  VersionStatusResult,
  StageResult,
  VersionProjectDocument,
} from './version-control/index.js';
