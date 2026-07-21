import { isValidItemId } from '../../util/screen-id.js';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
} from '../description-field-limits.js';
import { cloneNormalizedDescription } from './clone-normalized.js';
import { DescriptionDocumentError } from './errors.js';
import { ITEM_GROUP_KINDS, type ItemGroupKind, type NormalizedDescription } from './types.js';

const UPDATE_GROUP_KEYS = new Set(['groupId', 'name', 'description', 'kind']);

export type UpdateGroupInput = {
  groupId: string;
  name?: string;
  description?: string | null;
  kind?: ItemGroupKind;
};

function assertUpdateGroupInput(input: UpdateGroupInput): void {
  for (const key of Object.keys(input)) {
    if (!UPDATE_GROUP_KEYS.has(key)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `updateGroup に許可されていないフィールドがあります: ${key}`,
      });
    }
  }
  if (!isValidItemId(input.groupId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `groupId の形式が不正です: ${input.groupId}`,
    });
  }
  if (
    input.name === undefined &&
    input.description === undefined &&
    input.kind === undefined
  ) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'updateGroup には name / description / kind のいずれかが必要です。',
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
  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== 'string') {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'description は文字列または null である必要があります。',
      });
    }
    if (input.description.length > MAX_DESCRIPTION_LENGTH) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `description は${MAX_DESCRIPTION_LENGTH}文字以内である必要があります。`,
      });
    }
  }
  if (input.kind !== undefined && !ITEM_GROUP_KINDS.includes(input.kind)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `kind が不正です: ${String(input.kind)}`,
    });
  }
}

export type ApplyUpdateGroupResult =
  | { status: 'updated'; normalized: NormalizedDescription }
  | { status: 'unchanged'; normalized: NormalizedDescription };

/**
 * Group metadata を更新する（tree 位置・children は不変）。
 */
export function applyUpdateGroup(
  normalized: NormalizedDescription,
  input: UpdateGroupInput,
): ApplyUpdateGroupResult {
  assertUpdateGroupInput(input);

  const next = cloneNormalizedDescription(normalized);
  const group = next.groups.find((entry) => entry.groupId === input.groupId);
  if (!group) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
      message: `Group が見つかりません: ${input.groupId}`,
    });
  }

  let changed = false;
  if (input.name !== undefined && input.name !== group.name) {
    group.name = input.name;
    changed = true;
  }
  if (input.kind !== undefined && input.kind !== group.kind) {
    group.kind = input.kind;
    changed = true;
  }
  if (input.description !== undefined) {
    if (input.description === null) {
      if (group.description !== undefined) {
        delete group.description;
        changed = true;
      }
    } else if (input.description !== group.description) {
      group.description = input.description;
      changed = true;
    }
  }

  if (!changed) {
    return { status: 'unchanged', normalized: next };
  }

  next.sourceSchemaVersion = '1.3';
  return { status: 'updated', normalized: next };
}
