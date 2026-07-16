/**
 * CreateItemDialog のクライアント側 validation。
 * サーバー側（`isValidItemId` / `validateEditableDescriptionDocument` 等）と
 * 同じ規則を viewer 側でも先に検査し、送信前にフィードバックする。
 * viewer bundle は `src/viewer` 配下に閉じるため定数はここで複製する。
 */

export const ITEM_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const MAX_ITEM_ID_LENGTH = 128;
export const MAX_ITEM_NAME_LENGTH = 200;
export const MAX_ITEM_TYPE_LENGTH = 200;
export const MAX_ITEM_TEXT_LENGTH = 10000;

export type CreateItemInput = {
  itemId: string;
  name: string;
  type: string;
  description: string;
  note: string;
  existingItemIds: string[];
};

export type CreateItemFieldErrors = {
  itemId?: string;
  name?: string;
  type?: string;
  description?: string;
  note?: string;
};

export type CreateItemPayload = {
  itemId: string;
  name: string;
  type: string;
  description: string;
  note: string;
};

export function validateCreateItemInput(
  input: CreateItemInput,
): CreateItemFieldErrors {
  const errors: CreateItemFieldErrors = {};

  const itemId = input.itemId.trim();
  if (!itemId) {
    errors.itemId = '項目 ID を入力してください。';
  } else if (itemId.length > MAX_ITEM_ID_LENGTH) {
    errors.itemId = `項目 ID は ${MAX_ITEM_ID_LENGTH} 文字以内で入力してください。`;
  } else if (!ITEM_ID_RE.test(itemId)) {
    errors.itemId =
      '項目 ID は英小文字で始まる kebab-case（例: submit-button）で入力してください。';
  } else if (input.existingItemIds.includes(itemId)) {
    errors.itemId = 'この項目 ID は既に使われています。';
  }

  const name = input.name.trim();
  if (!name) {
    errors.name = '項目名を入力してください。';
  } else if (name.length > MAX_ITEM_NAME_LENGTH) {
    errors.name = `項目名は ${MAX_ITEM_NAME_LENGTH} 文字以内で入力してください。`;
  }

  const type = input.type.trim();
  if (!type) {
    errors.type = '種類を入力してください。';
  } else if (type.length > MAX_ITEM_TYPE_LENGTH) {
    errors.type = `種類は ${MAX_ITEM_TYPE_LENGTH} 文字以内で入力してください。`;
  }

  if (input.description.length > MAX_ITEM_TEXT_LENGTH) {
    errors.description = `説明は ${MAX_ITEM_TEXT_LENGTH} 文字以内で入力してください。`;
  }

  if (input.note.length > MAX_ITEM_TEXT_LENGTH) {
    errors.note = `備考は ${MAX_ITEM_TEXT_LENGTH} 文字以内で入力してください。`;
  }

  return errors;
}

export function hasCreateItemErrors(errors: CreateItemFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function toCreateItemPayload(input: CreateItemInput): CreateItemPayload {
  return {
    itemId: input.itemId.trim(),
    name: input.name.trim(),
    type: input.type.trim(),
    description: input.description,
    note: input.note,
  };
}
