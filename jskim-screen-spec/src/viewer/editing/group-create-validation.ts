/**
 * GroupCreateDialog のクライアント側 validation。
 * ID 規則は create-item-validation / サーバー isValidItemId と同一。
 * name/kind/description は group-edit-validation と同一上限。
 */

import {
  GROUP_EDIT_KINDS,
  MAX_GROUP_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  isGroupEditKind,
  type GroupEditKind,
} from './group-edit-validation.js';
import { VIEWER_MAX_GROUP_DEPTH } from './description-tree-helpers.js';

export const GROUP_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const MAX_GROUP_ID_LENGTH = 128;
export { VIEWER_MAX_GROUP_DEPTH as MAX_GROUP_CREATE_DEPTH };

export type GroupCreateDraft = {
  groupId: string;
  name: string;
  kind: GroupEditKind;
  description: string;
};

export type GroupCreateFieldErrors = {
  groupId?: string;
  name?: string;
  kind?: string;
  description?: string;
  parent?: string;
  depth?: string;
};

export type GroupCreatePayload = {
  groupId: string;
  name: string;
  kind: GroupEditKind;
  description: string | null;
};

export type GroupCreateValidationContext = {
  existingNodeIds: string[];
  /** null = root create。string = child create の親。 */
  parentGroupId: string | null;
  /** child のとき親の active depth。root は無視。 */
  parentDepth: number | null;
  parentActive: boolean;
};

export function validateGroupCreateDraft(
  draft: GroupCreateDraft,
  context: GroupCreateValidationContext,
): GroupCreateFieldErrors {
  const errors: GroupCreateFieldErrors = {};

  if (context.parentGroupId != null) {
    if (!context.parentActive || context.parentDepth == null) {
      errors.parent =
        '追加先のグループが見つかりません。最新内容を確認してください。';
    } else if (context.parentDepth >= VIEWER_MAX_GROUP_DEPTH) {
      errors.depth =
        '最大階層（8階層）に達しているため、子グループを追加できません。';
    }
  }

  const groupId = draft.groupId.trim();
  if (!groupId) {
    errors.groupId = 'グループ ID を入力してください。';
  } else if (groupId.length > MAX_GROUP_ID_LENGTH) {
    errors.groupId = `グループ ID は ${MAX_GROUP_ID_LENGTH} 文字以内で入力してください。`;
  } else if (!GROUP_ID_RE.test(groupId)) {
    errors.groupId =
      'グループ ID は英小文字で始まる kebab-case（例: main-section）で入力してください。';
  } else if (context.existingNodeIds.includes(groupId)) {
    errors.groupId = 'このグループIDは既に使用されています。';
  }

  const name = draft.name.trim();
  if (!name) {
    errors.name = '名前を入力してください。';
  } else if (name.length > MAX_GROUP_NAME_LENGTH) {
    errors.name = `名前は ${MAX_GROUP_NAME_LENGTH} 文字以内で入力してください。`;
  }

  if (!isGroupEditKind(draft.kind)) {
    errors.kind = '種類を選択してください。';
  }

  if (draft.description.length > MAX_GROUP_DESCRIPTION_LENGTH) {
    errors.description = `説明は ${MAX_GROUP_DESCRIPTION_LENGTH} 文字以内で入力してください。`;
  }

  return errors;
}

export function hasGroupCreateErrors(errors: GroupCreateFieldErrors): boolean {
  return Boolean(
    errors.groupId ||
      errors.name ||
      errors.kind ||
      errors.description ||
      errors.parent ||
      errors.depth,
  );
}

export function toGroupCreatePayload(draft: GroupCreateDraft): GroupCreatePayload {
  const description = draft.description.trim();
  return {
    groupId: draft.groupId.trim(),
    name: draft.name.trim(),
    kind: draft.kind,
    description: description === '' ? null : description,
  };
}

export { GROUP_EDIT_KINDS };
export type { GroupEditKind };
