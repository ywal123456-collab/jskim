import fs from 'node:fs';
import path from 'node:path';
import { extractItemIdsInDomOrder } from '../builder/item-order.js';
import { containsPathTraversal } from '../util/screen-id.js';
import { DescriptionDocumentError } from './description-document/errors.js';
import type { DescriptionTreeMutationContext } from './description-document/mutate-description-tree.js';

/**
 * snapshot HTML から collected Item ID を server-side で算出する。
 * Description だけでは collected / manual-only を区別できないため subtree 削除保護に使う。
 */
export function collectCollectedItemIdsForScreen(
  ctx: DescriptionTreeMutationContext,
): string[] {
  if (containsPathTraversal(ctx.screenId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_COLLECTED_STATE_UNAVAILABLE',
      message: `collected Item の状態を判定できません: ${ctx.screenId}`,
    });
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
      return [];
    }
    const files = fs
      .readdirSync(snapshotDir)
      .filter((name) => name.endsWith('.html'))
      .sort();

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
  } catch {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_COLLECTED_STATE_UNAVAILABLE',
      message: `collected Item の状態を判定できません: ${ctx.screenId}`,
    });
  }
}
