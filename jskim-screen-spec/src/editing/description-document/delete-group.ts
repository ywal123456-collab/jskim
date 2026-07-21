import { isValidItemId } from '../../util/screen-id.js';
import { cloneNormalizedDescription } from './clone-normalized.js';
import { findNodeLocation } from './find-node-location.js';
import { DescriptionDocumentError } from './errors.js';
import { getChildListRef } from './tree-children.js';
import type { NormalizedDescription } from './types.js';

const DELETE_GROUP_KEYS = new Set(['groupId']);

export type DeleteGroupInput = {
  groupId: string;
};

export type ApplyDeleteGroupResult = {
  status: 'updated';
  normalized: NormalizedDescription;
};

function assertDeleteGroupInput(input: DeleteGroupInput): void {
  for (const key of Object.keys(input)) {
    if (!DELETE_GROUP_KEYS.has(key)) {
      throw new DescriptionDocumentError({
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `deleteGroup に許可されていないフィールドがあります: ${key}`,
      });
    }
  }
  if (!isValidItemId(input.groupId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `groupId の形式が不正です: ${input.groupId}`,
    });
  }
}

/**
 * Group を解除する（children を親へ昇格）。
 * UI 上の「グループ解除」もこの operation を正本とする（独立 ungroup API は定義しない）。
 */
export function applyDeleteGroup(
  normalized: NormalizedDescription,
  input: DeleteGroupInput,
): ApplyDeleteGroupResult {
  assertDeleteGroupInput(input);

  const targetGroup = normalized.groups.find(
    (entry) => entry.groupId === input.groupId,
  );
  if (!targetGroup) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
      message: `Group が見つかりません: ${input.groupId}`,
    });
  }

  const location = findNodeLocation(normalized, {
    type: 'group',
    id: input.groupId,
  });

  const next = cloneNormalizedDescription(normalized);
  const parentChildren = getChildListRef(next, location.parentGroupId);
  const promotedChildren = next.groups.find(
    (entry) => entry.groupId === input.groupId,
  )!.children.map((ref) => ({ type: ref.type, id: ref.id }));

  parentChildren.splice(location.index, 1, ...promotedChildren);

  next.groups = next.groups.filter((entry) => entry.groupId !== input.groupId);
  next.sourceSchemaVersion = '1.3';
  return { status: 'updated', normalized: next };
}
