import fs from 'node:fs';
import path from 'node:path';
import { extractItemIdsInDomOrder } from '../builder/item-order.js';
import { containsPathTraversal } from '../util/screen-id.js';
import { DescriptionDocumentError } from './description-document/errors.js';
import type { DescriptionTreeMutationContext } from './description-document/mutate-description-tree.js';

export type CollectCollectedItemIdsOptions = {
  /**
   * delete/exclude 用: snapshot が無い・HTML が無い・読取不能な場合は fail-closed。
   * 通常の normalize 用（GET / create / update）では false のまま空配列を許容する。
   */
  requireSnapshot?: boolean;
};

function collectedStateUnavailable(screenId: string): never {
  throw new DescriptionDocumentError({
    code: 'SPEC_DESCRIPTION_COLLECTED_STATE_UNAVAILABLE',
    message: `collected Item の状態を判定できません: ${screenId}`,
  });
}

/**
 * snapshot HTML から collected Item ID を server-side で算出する。
 * Description だけでは collected / manual-only を区別できないため subtree 削除保護に使う。
 */
export function collectCollectedItemIdsForScreen(
  ctx: DescriptionTreeMutationContext,
  options: CollectCollectedItemIdsOptions = {},
): string[] {
  if (containsPathTraversal(ctx.screenId)) {
    collectedStateUnavailable(ctx.screenId);
  }

  const snapshotDir = path.join(
    ctx.rootDir,
    'spec',
    ctx.projectName,
    'src',
    'snapshots',
    ctx.screenId,
  );

  try {
    if (!fs.existsSync(snapshotDir)) {
      if (options.requireSnapshot) {
        collectedStateUnavailable(ctx.screenId);
      }
      return [];
    }
    const files = fs
      .readdirSync(snapshotDir)
      .filter((name) => name.endsWith('.html'))
      .sort();

    if (options.requireSnapshot && files.length === 0) {
      collectedStateUnavailable(ctx.screenId);
    }

    const ids: string[] = [];
    const seen = new Set<string>();
    for (const name of files) {
      const html = fs.readFileSync(path.join(snapshotDir, name), 'utf8');
      for (const id of extractItemIdsInDomOrder(html)) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    return ids;
  } catch (err) {
    if (err instanceof DescriptionDocumentError) {
      throw err;
    }
    collectedStateUnavailable(ctx.screenId);
  }
}

/** deleteItem / excludeItem 用の collected 判定（snapshot 必須）。 */
export function collectCollectedItemIdsForDestructiveMutation(
  ctx: DescriptionTreeMutationContext,
): string[] {
  return collectCollectedItemIdsForScreen(ctx, { requireSnapshot: true });
}
