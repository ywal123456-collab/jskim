import { describe, expect, it } from 'vitest';
import {
  hasCreateScreenErrors,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SCREEN_ID_LENGTH,
  validateCreateScreenInput,
} from '../../src/viewer/editing/create-screen-validation';

describe('validateCreateScreenInput', () => {
  it('正常な入力は error なし', () => {
    const errors = validateCreateScreenInput({
      screenId: 'crud-create',
      name: '新規作成',
      description: '説明',
    });
    expect(hasCreateScreenErrors(errors)).toBe(false);
  });

  it('screenId が空 / kebab-case 以外 / 長すぎる場合は error', () => {
    expect(
      validateCreateScreenInput({ screenId: '', name: 'x', description: '' })
        .screenId,
    ).toBeTruthy();

    expect(
      validateCreateScreenInput({
        screenId: 'Invalid_ID',
        name: 'x',
        description: '',
      }).screenId,
    ).toBeTruthy();

    expect(
      validateCreateScreenInput({
        screenId: '1st-item',
        name: 'x',
        description: '',
      }).screenId,
    ).toBeTruthy();

    expect(
      validateCreateScreenInput({
        screenId: 'a'.repeat(MAX_SCREEN_ID_LENGTH + 1),
        name: 'x',
        description: '',
      }).screenId,
    ).toBeTruthy();
  });

  it('name が空 / trim 後空 / 長すぎる場合は error', () => {
    expect(
      validateCreateScreenInput({
        screenId: 'crud-create',
        name: '',
        description: '',
      }).name,
    ).toBeTruthy();

    expect(
      validateCreateScreenInput({
        screenId: 'crud-create',
        name: '   ',
        description: '',
      }).name,
    ).toBeTruthy();

    expect(
      validateCreateScreenInput({
        screenId: 'crud-create',
        name: 'a'.repeat(MAX_NAME_LENGTH + 1),
        description: '',
      }).name,
    ).toBeTruthy();
  });

  it('description が長すぎる場合は error', () => {
    expect(
      validateCreateScreenInput({
        screenId: 'crud-create',
        name: 'x',
        description: 'a'.repeat(MAX_DESCRIPTION_LENGTH + 1),
      }).description,
    ).toBeTruthy();

    expect(
      validateCreateScreenInput({
        screenId: 'crud-create',
        name: 'x',
        description: 'a'.repeat(MAX_DESCRIPTION_LENGTH),
      }).description,
    ).toBeUndefined();
  });

  it('許可される screenId の例', () => {
    for (const id of ['crud-create', 'product-name', 'wizard-step-1', 'a']) {
      expect(
        validateCreateScreenInput({ screenId: id, name: 'x', description: '' })
          .screenId,
      ).toBeUndefined();
    }
  });
});
