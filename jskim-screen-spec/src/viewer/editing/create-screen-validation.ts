/**
 * CreateScreenDialog のクライアント側 validation。
 * サーバー側（`isValidScreenId` / `validateEditableDescriptionDocument` 等）と
 * 同じ規則を viewer 側でも先に検査し、送信前にフィードバックする。
 * viewer bundle は `src/viewer` 配下に閉じるため定数はここで複製する。
 */

export const SCREEN_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const MAX_SCREEN_ID_LENGTH = 128;
export const MAX_NAME_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 10000;

export type CreateScreenInput = {
  screenId: string;
  name: string;
  description: string;
};

export type CreateScreenFieldErrors = {
  screenId?: string;
  name?: string;
  description?: string;
};

export function validateCreateScreenInput(
  input: CreateScreenInput,
): CreateScreenFieldErrors {
  const errors: CreateScreenFieldErrors = {};

  const screenId = input.screenId.trim();
  if (!screenId) {
    errors.screenId = '画面 ID を入力してください。';
  } else if (screenId.length > MAX_SCREEN_ID_LENGTH) {
    errors.screenId = `画面 ID は ${MAX_SCREEN_ID_LENGTH} 文字以内で入力してください。`;
  } else if (!SCREEN_ID_RE.test(screenId)) {
    errors.screenId =
      '画面 ID は英小文字で始まる kebab-case（例: crud-create）で入力してください。';
  }

  const name = input.name.trim();
  if (!name) {
    errors.name = '画面名を入力してください。';
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.name = `画面名は ${MAX_NAME_LENGTH} 文字以内で入力してください。`;
  }

  if (input.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `画面説明は ${MAX_DESCRIPTION_LENGTH} 文字以内で入力してください。`;
  }

  return errors;
}

export function hasCreateScreenErrors(
  errors: CreateScreenFieldErrors,
): boolean {
  return Object.keys(errors).length > 0;
}
