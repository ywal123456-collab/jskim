import {
  DESCRIPTION_SOURCE_SCHEMA_VERSIONS,
  type DescriptionSourceSchemaVersion,
  type ParsedDescriptionDocument,
} from './types.js';
import { createDescriptionDocumentError } from './errors.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isDescriptionSourceSchemaVersion(
  value: unknown,
): value is DescriptionSourceSchemaVersion {
  return (
    typeof value === 'string' &&
    (DESCRIPTION_SOURCE_SCHEMA_VERSIONS as readonly string[]).includes(value)
  );
}

/**
 * JSON を ParsedDescriptionDocument に変換する（raw object は変更しない）。
 */
export function parseDescriptionDocument(
  value: unknown,
): ParsedDescriptionDocument | { error: ReturnType<typeof createDescriptionDocumentError> } {
  if (!isPlainObject(value)) {
    return {
      error: createDescriptionDocumentError(
        'SPEC_DESCRIPTION_INVALID',
        'Description JSON のルートは object である必要があります。',
      ),
    };
  }

  if (!isDescriptionSourceSchemaVersion(value.schemaVersion)) {
    return {
      error: createDescriptionDocumentError(
        'SPEC_DESCRIPTION_INVALID',
        'schemaVersion は "1.0" / "1.1" / "1.2" / "1.3" のいずれかである必要があります。',
      ),
    };
  }

  return {
    sourceSchemaVersion: value.schemaVersion,
    raw: value,
  };
}
