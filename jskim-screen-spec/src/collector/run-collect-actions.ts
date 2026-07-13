import type { Page } from 'playwright';
import { toActionSelector } from './action-selector.js';
import { createError, isSpecCollectError } from './collector-errors.js';

export type CollectAction =
  | { type: 'click'; target: string }
  | { type: 'check'; target: string }
  | { type: 'uncheck'; target: string }
  | { type: 'fill'; target: string; value: string }
  | { type: 'select'; target: string; value: string }
  | { type: 'wait'; milliseconds: number };

const MAX_WAIT_MS = 30000;

export function getMaxWaitMilliseconds(): number {
  return MAX_WAIT_MS;
}

/**
 * wait action の上限を検証する（ブラウザ起動前にも使える）。
 */
export function assertWaitWithinLimit(options: {
  action: CollectAction;
  actionIndex: number;
  screenId: string;
  stateId: string;
}): void {
  const { action, actionIndex, screenId, stateId } = options;
  if (action.type !== 'wait') {
    return;
  }
  if (action.milliseconds > MAX_WAIT_MS) {
    throw createError(
      'SPEC_COLLECT_WAIT_TOO_LONG',
      `wait が上限 ${MAX_WAIT_MS}ms を超えています。` +
        ` screenId=${screenId} stateId=${stateId} actionIndex=${actionIndex}` +
        ` milliseconds=${action.milliseconds}`,
    );
  }
}

async function resolveActionLocator(
  page: Page,
  target: string,
  context: {
    screenId: string;
    stateId: string;
    actionIndex: number;
  },
) {
  const selector = toActionSelector(target);
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count === 0) {
    throw createError(
      'SPEC_COLLECT_ACTION_TARGET_NOT_FOUND',
      `action target「${target}」が見つかりません。` +
        ` screenId=${context.screenId} stateId=${context.stateId}` +
        ` actionIndex=${context.actionIndex} target=${target}`,
    );
  }
  if (count > 1) {
    throw createError(
      'SPEC_COLLECT_ACTION_TARGET_DUPLICATE',
      `action target「${target}」が ${count} 件あります。` +
        ` screenId=${context.screenId} stateId=${context.stateId}` +
        ` actionIndex=${context.actionIndex} target=${target}`,
    );
  }
  return locator.first();
}

/**
 * Source JSON の collect.actions を Playwright Page 上で実行する。
 */
export async function runCollectActions(options: {
  page: Page;
  actions: CollectAction[];
  screenId: string;
  stateId: string;
}): Promise<void> {
  const { page, actions, screenId, stateId } = options;

  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const action = actions[actionIndex];
    assertWaitWithinLimit({ action, actionIndex, screenId, stateId });

    try {
      if (action.type === 'wait') {
        await page.waitForTimeout(action.milliseconds);
        continue;
      }

      const locator = await resolveActionLocator(page, action.target, {
        screenId,
        stateId,
        actionIndex,
      });

      if (action.type === 'click') {
        await locator.click();
      } else if (action.type === 'check') {
        await locator.check();
      } else if (action.type === 'uncheck') {
        await locator.uncheck();
      } else if (action.type === 'fill') {
        await locator.fill(action.value);
      } else if (action.type === 'select') {
        await locator.selectOption(action.value);
      } else {
        const unknownType = (action as { type: string }).type;
        throw createError(
          'SPEC_COLLECT_ACTION_FAILED',
          `未対応の action type「${unknownType}」です。` +
            ` screenId=${screenId} stateId=${stateId} actionIndex=${actionIndex}`,
        );
      }
    } catch (err) {
      if (isSpecCollectError(err)) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      const target =
        action.type === 'wait' ? '(wait)' : (action as { target?: string }).target;
      throw createError(
        'SPEC_COLLECT_ACTION_FAILED',
        `action の実行に失敗しました。` +
          ` screenId=${screenId} stateId=${stateId} actionIndex=${actionIndex}` +
          (target ? ` target=${target}` : '') +
          ` 原因: ${message}`,
      );
    }
  }
}

/**
 * actions 配列を CollectAction[] として正規化する。
 */
export function normalizeCollectActions(raw: unknown): CollectAction[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw as CollectAction[];
}
