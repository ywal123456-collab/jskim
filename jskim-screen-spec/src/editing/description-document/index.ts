export {
  parseDescriptionDocument,
} from './parse-description-document.js';
export {
  readDescriptionDocument,
  validateAndNormalizeDescriptionDocument,
  type ReadDescriptionDocumentOptions,
  type ReadDescriptionDocumentResult,
} from './read-description-document.js';
export {
  normalizeDescriptionDocument,
  normalizeDescriptionSpec,
  type NormalizeDescriptionDocumentOptions,
} from './normalize-description.js';
export { flattenItemTree } from './flatten-item-tree.js';
export { validateDescriptionStructure } from './validate-description-structure.js';
export {
  validateDescriptionTreeSemantics,
  MAX_GROUP_DEPTH,
} from './validate-description-tree-semantics.js';
export {
  assertLegacyDescriptionMutationSupported,
  assertDescriptionMutationSupported,
  isDescriptionMutationSupported,
} from './mutation-support.js';
export {
  createDescriptionDocumentError,
  DescriptionDocumentError,
  throwDescriptionDocumentError,
} from './errors.js';
export {
  DESCRIPTION_SOURCE_SCHEMA_VERSIONS,
  ITEM_GROUP_KINDS,
  type DescriptionSourceSchemaVersion,
  type SpecNodeRef,
  type ItemGroupKind,
  type ItemDescriptionFields,
  type ItemGroup,
  type ParsedDescriptionDocument,
  type NormalizedDescription,
  type DescriptionDocumentValidationError,
} from './types.js';
export { cloneNormalizedDescription } from './clone-normalized.js';
export { formatDescriptionDocumentV13 } from './canonical-writer.js';
export {
  formatDescriptionTreeForApi,
  type DescriptionTreeApiDocument,
} from './format-description-tree-response.js';
export { sortDescriptionItemMapKeys } from './sort-item-map-keys.js';
export {
  descriptionDataFilePath,
  descriptionDataRelativePath,
  descriptionScreenMutationLockPath,
} from './paths.js';
export { readDescriptionRevision } from './description-revision.js';
export { applyCreateGroup, type CreateGroupInput } from './create-group.js';
export { applyCreateItem, type CreateItemInput } from './create-item.js';
export {
  applyUpdateGroup,
  type UpdateGroupInput,
  type ApplyUpdateGroupResult,
} from './update-group.js';
export {
  applyUpdateItem,
  type UpdateItemInput,
  type ApplyUpdateItemResult,
} from './update-item.js';
export { findNodeLocation, type NodeLocation } from './find-node-location.js';
export { applyMoveNode, type MoveNodeInput, type ApplyMoveNodeResult } from './move-node.js';
export {
  applyReorderChildren,
  type ReorderChildrenInput,
  type ApplyReorderChildrenResult,
} from './reorder-children.js';
export { collectGroupSubtree, type GroupSubtreeCollection } from './collect-group-subtree.js';
export { applyDeleteGroup, type DeleteGroupInput, type ApplyDeleteGroupResult } from './delete-group.js';
export {
  applyDeleteGroupSubtree,
  type DeleteGroupSubtreeInput,
  type ApplyDeleteGroupSubtreeResult,
} from './delete-group-subtree.js';
export { applyDeleteItem, type DeleteItemInput, type ApplyDeleteItemResult } from './delete-item.js';
export { applyExcludeItem, type ExcludeItemInput, type ApplyExcludeItemResult } from './exclude-item.js';
export { applyRestoreItem, type RestoreItemInput, type ApplyRestoreItemResult } from './restore-item.js';
export {
  mutateDescriptionTree,
  createDescriptionGroup,
  updateDescriptionGroup,
  moveDescriptionNode,
  reorderDescriptionChildren,
  deleteDescriptionGroup,
  deleteDescriptionGroupSubtree,
  createDescriptionItem,
  updateDescriptionItem,
  deleteDescriptionItem,
  excludeDescriptionItem,
  restoreDescriptionItem,
  readDescriptionTreeState,
  type DescriptionTreeMutationContext,
  type DescriptionTreeMutationAdapters,
  type DescriptionTreeMutationResult,
  type MutateDescriptionTreeOptions,
} from './mutate-description-tree.js';
