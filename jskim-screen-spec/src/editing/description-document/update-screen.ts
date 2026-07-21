import {
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
} from '../description-field-limits.js';
import { cloneNormalizedDescription } from './clone-normalized.js';
import { DescriptionDocumentError } from './errors.js';
import type { NormalizedDescription } from './types.js';

const UPDATE_SCREEN_KEYS = new Set(['name', 'description']);

export type UpdateScreenInput = {
  name?: string;
  description?: string;
};

function assertUpdateScreenInput(input: UpdateScreenInput): void {
  for (const key of Object.keys(input)) {
    if (!UPDATE_SCREEN_KEYS.has(key)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `updateScreen に許可されていないフィールドがあります: ${key}`,
      });
    }
  }
  if (input.name === undefined && input.description === undefined) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'updateScreen には name / description のいずれかが必要です。',
    });
  }
  if (input.name !== undefined) {
    if (typeof input.name !== 'string') {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'name は文字列である必要があります。',
      });
    }
    if (input.name.length > MAX_NAME_LENGTH) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `name は${MAX_NAME_LENGTH}文字以内である必要があります。`,
      });
    }
  }
  if (input.description !== undefined) {
    if (typeof input.description !== 'string') {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'description は文字列である必要があります。',
      });
    }
    if (input.description.length > MAX_DESCRIPTION_LENGTH) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `description は${MAX_DESCRIPTION_LENGTH}文字以内である必要があります。`,
      });
    }
  }
}

export type ApplyUpdateScreenResult =
  | { status: 'updated'; normalized: NormalizedDescription }
  | { status: 'unchanged'; normalized: NormalizedDescription };

/**
 * screen metadata（name / description）のみ更新する（Group / Item tree は不変）。
 */
export function applyUpdateScreen(
  normalized: NormalizedDescription,
  input: UpdateScreenInput,
): ApplyUpdateScreenResult {
  assertUpdateScreenInput(input);

  const next = cloneNormalizedDescription(normalized);
  let changed = false;

  if (input.name !== undefined && input.name !== next.screen.name) {
    next.screen = { ...next.screen, name: input.name };
    changed = true;
  }
  if (
    input.description !== undefined &&
    input.description !== next.screen.description
  ) {
    next.screen = { ...next.screen, description: input.description };
    changed = true;
  }

  if (!changed) {
    return { status: 'unchanged', normalized: next };
  }

  next.sourceSchemaVersion = '1.3';
  return { status: 'updated', normalized: next };
}
