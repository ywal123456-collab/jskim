import { describe, expect, it } from 'vitest';
import { assertWaitWithinLimit } from '../../src/collector/run-collect-actions.js';
import { assertLocalScreenPath } from '../../src/collector/collect-screen-spec-project.js';
import { isSpecCollectError } from '../../src/collector/collector-errors.js';

describe('collector validation', () => {
  it('wait が 30000ms を超えると SPEC_COLLECT_WAIT_TOO_LONG', () => {
    try {
      assertWaitWithinLimit({
        action: { type: 'wait', milliseconds: 30001 },
        actionIndex: 2,
        screenId: 'demo',
        stateId: 'filled',
      });
      expect.unreachable('エラーになるはず');
    } catch (err) {
      expect(isSpecCollectError(err)).toBe(true);
      if (isSpecCollectError(err)) {
        expect(err.code).toBe('SPEC_COLLECT_WAIT_TOO_LONG');
        expect(err.message).toContain('screenId=demo');
        expect(err.message).toContain('stateId=filled');
        expect(err.message).toContain('actionIndex=2');
      }
    }
  });

  it('wait が 30000ms 以下なら通る', () => {
    expect(() =>
      assertWaitWithinLimit({
        action: { type: 'wait', milliseconds: 30000 },
        actionIndex: 0,
        screenId: 'demo',
        stateId: 'default',
      }),
    ).not.toThrow();
  });

  it('screen.path の .. を拒否する', () => {
    try {
      assertLocalScreenPath('/../etc/passwd', 'demo');
      expect.unreachable('エラーになるはず');
    } catch (err) {
      expect(isSpecCollectError(err)).toBe(true);
      if (isSpecCollectError(err)) {
        expect(err.code).toBe('SPEC_COLLECT_EXTERNAL_REDIRECT');
        expect(err.message).toContain('screenId=demo');
      }
    }
  });

  it('screen.path が / で始まらない場合も拒否する', () => {
    try {
      assertLocalScreenPath('index.html', 'demo');
      expect.unreachable('エラーになるはず');
    } catch (err) {
      expect(isSpecCollectError(err)).toBe(true);
      if (isSpecCollectError(err)) {
        expect(err.code).toBe('SPEC_COLLECT_EXTERNAL_REDIRECT');
      }
    }
  });
});
