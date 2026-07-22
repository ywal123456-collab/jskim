/**
 * GroupEditDialog のクライアント側 validation。
 * viewer bundle は `src/viewer` 配下に閉じるため定数はここで定義する。
 */

export const GROUP_EDIT_KINDS = [
  'SECTION',
  'FIELDSET',
  'CARD',
  'REPEATABLE',
  'ACTIONS',
  'CONTENT',
  'CUSTOM',
] as const;

export type GroupEditKind = (typeof GROUP_EDIT_KINDS)[number];

export const MAX_GROUP_NAME_LENGTH = 200;
export const MAX_GROUP_DESCRIPTION_LENGTH = 10000;

export type GroupEditDraft = {
  name: string;
  kind: GroupEditKind;
  description: string;
};

export type GroupEditFieldErrors = {
  name?: string;
  kind?: string;
  description?: string;
};

export type GroupEditPayload = {
  name: string;
  kind: GroupEditKind;
  description: string | null;
};

export function isGroupEditKind(value: string): value is GroupEditKind {
  return (GROUP_EDIT_KINDS as readonly string[]).includes(value);
}

export function validateGroupEditDraft(draft: GroupEditDraft): GroupEditFieldErrors {
  const errors: GroupEditFieldErrors = {};
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

export function hasGroupEditErrors(errors: GroupEditFieldErrors): boolean {
  return Boolean(errors.name || errors.kind || errors.description);
}

export function toGroupEditPayload(draft: GroupEditDraft): GroupEditPayload {
  const description = draft.description.trim();
  return {
    name: draft.name.trim(),
    kind: draft.kind,
    description: description === '' ? null : description,
  };
}

export function groupEditPayloadEquals(
  payload: GroupEditPayload,
  current: { name: string; kind: string; description?: string | null },
): boolean {
  const currentName =
    typeof current.name === 'string' ? current.name.trim() : '';
  const currentDescription =
    typeof current.description === 'string' && current.description.trim() !== ''
      ? current.description.trim()
      : null;
  return (
    payload.name === currentName &&
    payload.kind === current.kind &&
    payload.description === currentDescription
  );
}
