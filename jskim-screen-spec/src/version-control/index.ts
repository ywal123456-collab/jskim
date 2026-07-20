export {
  VersionControlError,
  createVersionControlError,
} from './errors.js';
export type { VersionControlErrorCode } from './errors.js';
export {
  REPOSITORY_FORMAT_VERSION,
  HASH_ALGORITHM,
  DEFAULT_BRANCH,
  HEAD_MAIN_REF,
  MAX_VERSION_OBJECT_BYTES,
  SHA256_HEX_RE,
  OBJECT_TYPES,
} from './constants.js';
export type { VersionObjectType } from './constants.js';
export type {
  RepositoryFormatDocument,
  InitVersionRepositoryOptions,
  InitVersionRepositoryResult,
  VersionPerson,
  TreeEntry,
  TreeObject,
  CommitObject,
  TagObject,
  WriteVersionObjectOptions,
  WriteVersionObjectResult,
  ReadVersionObjectOptions,
  ReadVersionObjectResult,
} from './types.js';
export {
  versionRepositoryPath,
  versionRepositoryRelativePath,
  objectRelativePath,
  assertValidObjectHash,
} from './repository-paths.js';
export { canonicalizeJson, canonicalizeJsonBytes } from './canonical-json.js';
export {
  encodeVersionObject,
  decodeVersionObjectBytes,
  hashVersionObject,
} from './object-format.js';
export {
  assertTreeObject,
  assertCommitObject,
  assertTagObject,
  normalizeTreeObject,
} from './validate-object.js';
export { initVersionRepository } from './init-repository.js';
export {
  writeVersionObject,
  readVersionObject,
  readTypedVersionObject,
  hasVersionObject,
} from './object-store.js';
export { createWorkingSnapshot, persistSnapshotObjects } from './snapshot.js';
export type { WorkingSnapshot, WorkingSnapshotObject } from './snapshot.js';
export { readVersionHead } from './head.js';
export type { VersionHead } from './head.js';
export {
  readVersionIndex,
  EMPTY_TREE_HASH,
  computeIndexRevision,
} from './version-index.js';
export type { VersionIndex, ReadVersionIndexResult } from './version-index.js';
export { diffVersionTrees, getVersionStatus } from './status.js';
export type { VersionChange, VersionStatusResult } from './status.js';
export { stageProject, stageScreen, stageFeature } from './stage.js';
export type { StageResult } from './stage.js';
export {
  assertVersionProjectDocument,
  buildVersionProjectDocument,
  compareScreenIdOrder,
  mergeScreenOrderForStage,
} from './project-document.js';
export type { VersionProjectDocument } from './project-document.js';
export { assertIndexTreeReachable } from './index-integrity.js';
