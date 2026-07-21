import type { DescriptionDocumentValidationError } from './types.js';

export function createDescriptionDocumentError(
  code: string,
  message: string,
): DescriptionDocumentValidationError {
  return { code, message };
}

export class DescriptionDocumentError extends Error {
  readonly code: string;
  readonly expectedRevision?: string;
  readonly currentRevision?: string | null;

  constructor(
    error: DescriptionDocumentValidationError & {
      expectedRevision?: string;
      currentRevision?: string | null;
    },
  ) {
    super(error.message);
    this.name = 'DescriptionDocumentError';
    this.code = error.code;
    if (error.expectedRevision !== undefined) {
      this.expectedRevision = error.expectedRevision;
    }
    if (error.currentRevision !== undefined) {
      this.currentRevision = error.currentRevision;
    }
  }
}

export function throwDescriptionDocumentError(
  code: string,
  message: string,
): never {
  throw new DescriptionDocumentError(createDescriptionDocumentError(code, message));
}
