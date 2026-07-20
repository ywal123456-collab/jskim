import { createVersionControlError } from './errors.js';
import { readVersionHead } from './head.js';
import { withMutationLock } from './mutation-lock.js';
import {
  compareAndSwapVersionRef,
  deleteVersionRef,
  listRefNames,
  readVersionRef,
  validateRefName,
} from './refs.js';
import { resolveVersionRevision } from './revision-resolver.js';
import { assertNoIncompleteTransaction } from './transaction.js';

export type VersionBranchInfo = {
  name: string;
  commitHash: string | null;
  current: boolean;
  unborn: boolean;
};

export function listVersionBranches(options: {
  rootDir: string;
  projectName: string;
}): VersionBranchInfo[] {
  const head = readVersionHead(options);
  const currentName =
    head.ref && head.ref.startsWith('refs/heads/')
      ? head.ref.slice('refs/heads/'.length)
      : null;
  const names = listRefNames({ ...options, kind: 'heads' });
  const listed = new Set(names);
  const result: VersionBranchInfo[] = names.map((name) => ({
    name,
    commitHash: readVersionRef({
      ...options,
      kind: 'heads',
      name,
    }),
    current: currentName === name,
    unborn: false,
  }));

  if (currentName && !listed.has(currentName) && head.unborn) {
    result.push({
      name: currentName,
      commitHash: null,
      current: true,
      unborn: true,
    });
    result.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  return result;
}

export function createVersionBranch(options: {
  rootDir: string;
  projectName: string;
  name: string;
  startPoint?: string;
}): { name: string; commitHash: string } {
  return withMutationLock(options, 'branch-create', () => {
    assertNoIncompleteTransaction(options);
    const name = validateRefName('heads', options.name);
    let commitHash: string;
    if (options.startPoint !== undefined) {
      commitHash = resolveVersionRevision({
        rootDir: options.rootDir,
        projectName: options.projectName,
        revision: options.startPoint,
      }).commitHash;
    } else {
      const head = readVersionHead(options);
      if (head.unborn || !head.commit) {
        throw createVersionControlError(
          'SPEC_VERSION_REVISION_NOT_FOUND',
          'unborn HEAD では startPoint が必要です。',
        );
      }
      commitHash = head.commit;
    }

    if (listRefNames({ ...options, kind: 'heads' }).includes(name)) {
      throw createVersionControlError(
        'SPEC_VERSION_BRANCH_EXISTS',
        '同名の branch がすでに存在します。',
      );
    }

    try {
      compareAndSwapVersionRef({
        rootDir: options.rootDir,
        projectName: options.projectName,
        kind: 'heads',
        name,
        expectedOldHash: null,
        newHash: commitHash,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'SPEC_VERSION_REF_CONFLICT'
      ) {
        throw createVersionControlError(
          'SPEC_VERSION_BRANCH_EXISTS',
          '同名の branch がすでに存在します。',
        );
      }
      throw error;
    }

    return { name, commitHash };
  });
}

export function deleteVersionBranch(options: {
  rootDir: string;
  projectName: string;
  name: string;
}): void {
  withMutationLock(options, 'branch-delete', () => {
    assertNoIncompleteTransaction(options);
    const name = validateRefName('heads', options.name);
    const head = readVersionHead(options);
    if (head.ref === `refs/heads/${name}`) {
      throw createVersionControlError(
        'SPEC_VERSION_CURRENT_BRANCH_DELETE',
        '現在の HEAD branch は削除できません。',
      );
    }

    if (!listRefNames({ ...options, kind: 'heads' }).includes(name)) {
      throw createVersionControlError(
        'SPEC_VERSION_BRANCH_NOT_FOUND',
        'branch が見つかりません。',
      );
    }

    deleteVersionRef({
      rootDir: options.rootDir,
      projectName: options.projectName,
      kind: 'heads',
      name,
    });
  });
}
