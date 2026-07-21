import { flattenItemTree } from './flatten-item-tree.js';
import { normalizeDescriptionDocument } from './normalize-description.js';
import { parseDescriptionDocument } from './parse-description-document.js';
import type {
  DescriptionDocumentValidationError,
  NormalizedDescription,
  ParsedDescriptionDocument,
} from './types.js';
import { validateDescriptionStructure } from './validate-description-structure.js';
import { validateDescriptionTreeSemantics } from './validate-description-tree-semantics.js';

export type ReadDescriptionDocumentOptions = {
  /** v1.0 順序合成用（computeEffectiveItemOrder と同型） */
  collectedOrder?: string[] | null;
};

export type ReadDescriptionDocumentResult = {
  parsed: ParsedDescriptionDocument;
  normalized: NormalizedDescription;
  flatItemOrder: string[];
};

/**
 * parse → structure validation → normalize → semantic validation → flatten。
 * raw parsed object / ファイルは変更しない。
 */
export function readDescriptionDocument(
  value: unknown,
  options: ReadDescriptionDocumentOptions = {},
): ReadDescriptionDocumentResult | { error: DescriptionDocumentValidationError } {
  const parsed = parseDescriptionDocument(value);
  if ('error' in parsed) {
    return parsed;
  }

  const structureError = validateDescriptionStructure(parsed);
  if (structureError) {
    return { error: structureError };
  }

  const normalized = normalizeDescriptionDocument(parsed, options);

  if (parsed.sourceSchemaVersion === '1.3') {
    const semanticError = validateDescriptionTreeSemantics(normalized);
    if (semanticError) {
      return { error: semanticError };
    }
  }

  return {
    parsed,
    normalized,
    flatItemOrder: flattenItemTree(normalized),
  };
}

/**
 * 既に parse 済みの document に対して validate + normalize のみ実行する。
 */
export function validateAndNormalizeDescriptionDocument(
  parsed: ParsedDescriptionDocument,
  options: ReadDescriptionDocumentOptions = {},
):
  | { normalized: NormalizedDescription; flatItemOrder: string[] }
  | { error: DescriptionDocumentValidationError } {
  const structureError = validateDescriptionStructure(parsed);
  if (structureError) {
    return { error: structureError };
  }

  const normalized = normalizeDescriptionDocument(parsed, options);

  if (parsed.sourceSchemaVersion === '1.3') {
    const semanticError = validateDescriptionTreeSemantics(normalized);
    if (semanticError) {
      return { error: semanticError };
    }
  }

  return {
    normalized,
    flatItemOrder: flattenItemTree(normalized),
  };
}
