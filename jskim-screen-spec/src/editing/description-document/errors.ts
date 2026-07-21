import type { DescriptionDocumentValidationError } from './types.js';

export function createDescriptionDocumentError(
  code: string,
  message: string,
): DescriptionDocumentValidationError {
  return { code, message };
}

export class DescriptionDocumentError extends Error {
  readonly code: string;

  constructor(error: DescriptionDocumentValidationError) {
    super(error.message);
    this.name = 'DescriptionDocumentError';
    this.code = error.code;
  }
}

export function throwDescriptionDocumentError(
  code: string,
  message: string,
): never {
  throw new DescriptionDocumentError(createDescriptionDocumentError(code, message));
}
