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
  MAX_IDENTITY_NAME_LENGTH,
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
export {
  readVersionHead,
  writeVersionHeadSymbolic,
  writeVersionHeadDetached,
  assertHeadMatchesExpected,
} from './head.js';
export type { VersionHead } from './head.js';
export {
  loadVersionAuthorConfig,
  persistVersionAuthorConfig,
  resolveVersionAuthor,
} from './author-config.js';
export type {
  VersionAuthorConfig,
  VersionAuthorOptions,
  ResolveVersionAuthorOptions,
} from './author-config.js';
export { withMutationLock } from './mutation-lock.js';
export {
  validateRefName,
  readVersionRef,
  compareAndSwapVersionRef,
  listRefNames,
  deleteVersionRef,
} from './refs.js';
export type { VersionRefKind } from './refs.js';
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
export {
  resolveVersionRevision,
  MIN_SHORT_HASH_LENGTH,
} from './revision-resolver.js';
export type { ResolvedVersionRevision } from './revision-resolver.js';
export { commitVersion } from './commit-version.js';
export type {
  CommitVersionOptions,
  CommitVersionResult,
} from './commit-version.js';
export { getVersionLog, getVersionCommit } from './version-log.js';
export type {
  VersionCommitSummary,
  GetVersionLogOptions,
  GetVersionLogResult,
} from './version-log.js';
export {
  listVersionBranches,
  createVersionBranch,
  deleteVersionBranch,
} from './branch-version.js';
export type { VersionBranchInfo } from './branch-version.js';
export { listVersionTags, createVersionTag } from './tag-version.js';
export type {
  VersionTagInfo,
  CreateVersionTagOptions,
} from './tag-version.js';
export { checkoutVersion } from './checkout-version.js';
export type {
  CheckoutVersionOptions,
  CheckoutVersionResult,
} from './checkout-version.js';
export { revertVersionCommit } from './revert-version.js';
export type {
  RevertVersionOptions,
  RevertVersionResult,
} from './revert-version.js';
export { fsckVersionRepository, assertFsckClean } from './fsck.js';
export type { FsckVersionResult } from './fsck.js';
export {
  inspectVersionRecovery,
  recoverVersionRepository,
} from './recovery.js';
export type {
  VersionRecoveryInspection,
  RecoverVersionOptions,
  TransactionRecoveryPlan,
  RecoveryHeadState,
  RecoveryIndexState,
  RecoverySourceState,
  RecoveryRecommendedAction,
} from './recovery.js';
export {
  assertNoIncompleteTransaction,
  assertValidOperationId,
  createOperationId,
  listIncompleteTransactions,
  transactionJournalPath,
  transactionWorktreeRoot,
  writeTransactionJournal,
  updateTransactionPhase,
  removeTransactionArtifacts,
} from './transaction.js';
export type {
  VersionTransactionJournal,
  TransactionPhase,
  TransactionFs,
} from './transaction.js';
export { removeVersionIndex } from './version-index.js';
export {
  buildMaterializePlan,
  logicalPathToPhysicalRelative,
} from './materialize-snapshot.js';
export type {
  MaterializePlan,
  PhysicalFilePlan,
} from './materialize-snapshot.js';
