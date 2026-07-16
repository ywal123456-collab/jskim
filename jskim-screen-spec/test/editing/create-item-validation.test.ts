import { describe, expect, it } from 'vitest';
import {
  hasCreateItemErrors,
  MAX_ITEM_ID_LENGTH,
  validateCreateItemInput,
} from '../../src/viewer/editing/create-item-validation';

function validInput(
  overrides: Partial<Parameters<typeof validateCreateItemInput>[0]> = {},
) {
  return {
    itemId: 'submit-button',
    name: '送信ボタン',
    type: 'button',
    description: '',
    note: '',
    existingItemIds: ['title'] as string[],
    ...overrides,
  };
}

describe('validateCreateItemInput', () => {
  it('正常な入力は error なし', () => {
    const errors = validateCreateItemInput(validInput());
    expect(hasCreateItemErrors(errors)).toBe(false);
  });

  it('itemId が空 / kebab-case 以外 / 長すぎる場合は error', () => {
    expect(validateCreateItemInput(validInput({ itemId: '' })).itemId).toBeTruthy();

    expect(
      validateCreateItemInput(validInput({ itemId: 'Invalid_ID' })).itemId,
    ).toBeTruthy();

    expect(
      validateCreateItemInput(validInput({ itemId: '1st-item' })).itemId,
    ).toBeTruthy();

    expect(
      validateCreateItemInput(
        validInput({ itemId: 'a'.repeat(MAX_ITEM_ID_LENGTH + 1) }),
      ).itemId,
    ).toBeTruthy();
  });

  it('既存の itemId と重複する場合は error', () => {
    expect(
      validateCreateItemInput(
        validInput({ itemId: 'title', existingItemIds: ['title', 'save'] }),
      ).itemId,
    ).toBeTruthy();
  });

  it('項目名と種類が必須', () => {
    expect(validateCreateItemInput(validInput({ name: '  ' })).name).toBeTruthy();
    expect(validateCreateItemInput(validInput({ type: '' })).type).toBeTruthy();
  });

  it('許可される itemId の例', () => {
    for (const id of ['title', 'submit-button', 'wizard-step-1', 'a']) {
      expect(
        validateCreateItemInput(validInput({ itemId: id, existingItemIds: [] }))
          .itemId,
      ).toBeUndefined();
    }
  });
});
