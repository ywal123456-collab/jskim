export { FeatureError, createFeatureError } from './errors.js';
export type { FeatureErrorCode } from './errors.js';
export type {
  ScreenFeature,
  ScreenFeatureFile,
  ScreenFeatureFileSchemaVersion,
  LoadScreenFeaturesResult,
  PersistScreenFeaturesOptions,
  PersistScreenFeaturesResult,
} from './types.js';
export { featuresFilePath, featuresRelativePath } from './paths.js';
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
