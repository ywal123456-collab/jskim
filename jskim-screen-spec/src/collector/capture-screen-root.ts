import type { Page } from 'playwright';
import { createError } from './collector-errors.js';
import { getSerializeRuntimeStateFunctionSource } from './serialize-runtime-state.js';

type CaptureEvaluateResult =
  | { ok: true; html: string }
  | { ok: false; reason: 'not_found' | 'duplicate'; count: number };

/**
 * 一意な `[data-jskim-spec-screen=id]` を見つけ、
 * ランタイム状態をシリアライズした outerHTML を返す。
 */
export async function captureScreenRoot(options: {
  page: Page;
  screenId: string;
  stateId: string;
}): Promise<string> {
  const { page, screenId, stateId } = options;
  const serializeSource = getSerializeRuntimeStateFunctionSource();

  const expression = `(() => {
    ${serializeSource}
    const id = ${JSON.stringify(screenId)};
    const nodes = document.querySelectorAll(
      '[data-jskim-spec-screen="' + CSS.escape(id) + '"]'
    );
    if (nodes.length === 0) {
      return { ok: false, reason: 'not_found', count: 0 };
    }
    if (nodes.length > 1) {
      return { ok: false, reason: 'duplicate', count: nodes.length };
    }
    return { ok: true, html: serializeRuntimeState(nodes[0]) };
  })()`;

  const result = (await page.evaluate(expression)) as CaptureEvaluateResult;

  if (!result.ok) {
    if (result.reason === 'not_found') {
      throw createError(
        'SPEC_COLLECT_SCREEN_ROOT_NOT_FOUND',
        `screen root「${screenId}」が見つかりません。` +
          ` screenId=${screenId} stateId=${stateId}`,
      );
    }
    throw createError(
      'SPEC_COLLECT_SCREEN_ROOT_DUPLICATE',
      `screen root「${screenId}」が ${result.count} 件あります。` +
        ` screenId=${screenId} stateId=${stateId}`,
    );
  }

  return result.html;
}
