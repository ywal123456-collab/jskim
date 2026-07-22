import { describe, expect, it } from 'vitest';
import {
  isValidDescriptionRevision,
  parseDescriptionRevision,
} from '../../src/viewer/editing/description-revision';
import { computeContentRevision } from '../../src/util/write-file-atomic';

const VALID =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('description-revision validator', () => {
  it('producer 由来の canonical revision を受理する', () => {
    const produced = computeContentRevision('{"demo":true}\n');
    expect(isValidDescriptionRevision(produced)).toBe(true);
    expect(parseDescriptionRevision(produced)).toBe(produced);
    expect(produced.startsWith('sha256:')).toBe(true);
    expect(produced.length).toBe('sha256:'.length + 64);
  });

  it('境界上正しい digest 長を受理する', () => {
    expect(isValidDescriptionRevision(VALID)).toBe(true);
    expect(
      isValidDescriptionRevision(
        'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ),
    ).toBe(true);
  });

  it('invalid 値を拒否する', () => {
    const invalids: unknown[] = [
      undefined,
      null,
      1,
      {},
      [],
      '',
      ' ',
      ` ${VALID}`,
      `${VALID} `,
      'md5:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'sha256:',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaag',
      'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      `${VALID}x`,
      `${VALID}\n`,
      'same-invalid-revision',
      'sha256:r1',
    ];
    for (const value of invalids) {
      expect(isValidDescriptionRevision(value), String(value)).toBe(false);
      expect(parseDescriptionRevision(value), String(value)).toBeNull();
    }
  });
});
