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
