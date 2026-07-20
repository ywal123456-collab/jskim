export { FeatureError, createFeatureError } from './errors.js';
export type { FeatureErrorCode } from './errors.js';
export type {
  ScreenFeature,
  ScreenFeatureFile,
  ScreenFeatureFileSchemaVersion,
  LoadScreenFeaturesResult,
  PersistScreenFeaturesOptions,
  PersistScreenFeaturesResult,
  FeatureMutationResult,
  FeatureMutationStatus,
} from './types.js';
export {
  featuresFilePath,
  featuresRelativePath,
  featureMutationLockPath,
} from './paths.js';
export {
  validateScreenFeatureFile,
  computeUngroupedScreenIds,
  formatScreenFeatureFile,
  MAX_FEATURE_NAME_LENGTH,
  MAX_FEATURE_DESCRIPTION_LENGTH,
  MIN_DISPLAY_ORDER,
  MAX_DISPLAY_ORDER,
} from './validate-features.js';
export type { ValidateScreenFeatureFileOptions } from './validate-features.js';
export { loadScreenFeatures } from './load-features.js';
export type { LoadScreenFeaturesOptions } from './load-features.js';
export { persistScreenFeatures } from './persist-features.js';
export {
  readFeaturesFileRevision,
  getScreenFeatureWorkingState,
} from './feature-revision.js';
export type { ScreenFeatureWorkingState } from './feature-revision.js';
export {
  withFeatureMutationLock,
  featureMutationLockQueueSizeForTest,
  resetFeatureMutationLocksForTest,
} from './feature-mutation-lock.js';
export {
  projectBrowserSafeFeature,
  projectBrowserSafeFeatures,
  projectBrowserSafeFeatureState,
  projectBrowserSafeFeatureManifest,
} from './browser-safe-features.js';
export type {
  BrowserSafeFeature,
  BrowserSafeFeatureState,
  BrowserSafeFeatureManifest,
} from './browser-safe-features.js';
export {
  getScreenFeatureWorkingStatePublic,
  projectFeatureMutationState,
  createScreenFeature,
  updateScreenFeature,
  deleteScreenFeature,
  reorderScreenFeatures,
  moveScreenToFeature,
  reorderFeatureScreens,
  moveScreenFeatureDirection,
  moveFeatureDirection,
} from './feature-operations.js';
export type { FeatureOperationContext } from './feature-operations.js';
