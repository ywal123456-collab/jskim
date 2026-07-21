import type { DescriptionSourceSchemaVersion } from './types.js';
import { DescriptionDocumentError } from './errors.js';

/**
 * Collector / Viewer PUT 等、flat schema mutation が前提の経路向け。
 * v1.3 Description は fail-closed とする。
 */
export function assertDescriptionMutationSupported(
  schemaVersion: string | undefined,
): void {
  if (schemaVersion === '1.3') {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_UNSUPPORTED_SCHEMA',
      message:
        '項目グループ（schemaVersion "1.3"）の画面設計書は、現バージョンでは変更できません。',
    });
  }
}

export function isDescriptionMutationSupported(
  schemaVersion: string | undefined,
): schemaVersion is Exclude<DescriptionSourceSchemaVersion, '1.3'> {
  return schemaVersion !== '1.3';
}
