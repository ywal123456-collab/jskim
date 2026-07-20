import { createVersionControlError } from './errors.js';
import { hashVersionObject } from './object-format.js';
import { readVersionObject } from './object-store.js';
import type { TreeObject } from './types.js';

const EMPTY_TREE_HASH = hashVersionObject('tree', {
  formatVersion: '1.0',
  entries: [],
});

/**
 * index.tree から到達可能な全 object の存在と integrity を検証する。
 * 空 tree hash（未 materialize）は store を要求しない。
 */
export function assertIndexTreeReachable(options: {
  rootDir: string;
  projectName: string;
  treeHash: string;
}): void {
  if (options.treeHash === EMPTY_TREE_HASH) {
    return;
  }

  const visited = new Set<string>();

  const walk = (hash: string, expectedType: 'tree' | 'blob'): void => {
    if (visited.has(hash)) {
      throw createVersionControlError(
        'SPEC_VERSION_INDEX_CORRUPT',
        'index tree に循環参照があります。',
      );
    }
    visited.add(hash);

    let obj;
    try {
      obj = readVersionObject({
        rootDir: options.rootDir,
        projectName: options.projectName,
        hash,
        expectedType,
      });
    } catch (err) {
      if (
        err instanceof Error &&
        'code' in err &&
        String((err as { code: string }).code).startsWith('SPEC_VERSION_')
      ) {
        throw createVersionControlError(
          'SPEC_VERSION_INDEX_CORRUPT',
          'index が参照するオブジェクトが不正または欠落しています。',
        );
      }
      throw createVersionControlError(
        'SPEC_VERSION_INDEX_CORRUPT',
        'index が参照するオブジェクトを検証できませんでした。',
      );
    }

    if (expectedType === 'blob') {
      return;
    }

    let tree: TreeObject;
    try {
      tree = JSON.parse(obj.payload.toString('utf8')) as TreeObject;
    } catch {
      throw createVersionControlError(
        'SPEC_VERSION_INDEX_CORRUPT',
        'index tree の payload が不正です。',
      );
    }
    if (!Array.isArray(tree.entries)) {
      throw createVersionControlError(
        'SPEC_VERSION_INDEX_CORRUPT',
        'index tree の entries が不正です。',
      );
    }
    for (const entry of tree.entries) {
      if (entry.objectType !== 'blob' && entry.objectType !== 'tree') {
        throw createVersionControlError(
          'SPEC_VERSION_INDEX_CORRUPT',
          'index tree entry の type が不正です。',
        );
      }
      walk(entry.hash, entry.objectType);
    }
  };

  walk(options.treeHash, 'tree');
}
