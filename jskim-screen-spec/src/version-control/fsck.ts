import fs from 'node:fs';
import path from 'node:path';
import { createVersionControlError } from './errors.js';
import { assertMetadataPathBoundary } from './fs-guards.js';
import { readVersionHead } from './head.js';
import { decodeVersionObjectBytes } from './object-format.js';
import { createWorkingSnapshot } from './snapshot.js';
import {
  assertValidOperationId,
  listIncompleteTransactions,
  transactionBackupSpecPath,
  transactionJournalPath,
  transactionNextRoot,
  transactionWorktreeRoot,
} from './transaction.js';
import {
  objectAbsolutePath,
  versionRepositoryPath,
} from './repository-paths.js';
import { listRefNames, readVersionRef } from './refs.js';
import {
  assertCommitObject,
  assertTagObject,
  assertTreeObject,
} from './validate-object.js';
import { readVersionIndex } from './version-index.js';

export type FsckVersionResult = {
  errors: string[];
  warnings: string[];
  danglingObjects: string[];
  staleLocks: string[];
  incompleteTransactions: string[];
  reachableObjects: number;
  checkedObjects: number;
};

function collectObjectHashes(repo: string): string[] {
  const objects = path.join(repo, 'objects');
  if (!fs.existsSync(objects)) return [];
  const hashes: string[] = [];
  for (const fanout of fs.readdirSync(objects)) {
    if (fanout.startsWith('.')) {
      // TEMP leftovers
      continue;
    }
    if (!/^[a-f0-9]{2}$/.test(fanout)) continue;
    const dir = path.join(objects, fanout);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(dir);
    } catch {
      continue;
    }
    if (st.isSymbolicLink() || !st.isDirectory()) continue;
    for (const rest of fs.readdirSync(dir)) {
      if (rest.startsWith('.')) continue;
      if (!/^[a-f0-9]{62}$/.test(rest)) continue;
      hashes.push(`${fanout}${rest}`);
    }
  }
  return hashes;
}

function walkTree(
  repo: string,
  hash: string,
  reachable: Set<string>,
  errors: string[],
  stack: Set<string>,
): void {
  if (reachable.has(hash)) return;
  if (stack.has(hash)) {
    errors.push('tree に循環参照があります。');
    return;
  }
  const abs = objectAbsolutePath(repo, hash);
  if (!fs.existsSync(abs)) {
    errors.push('到達可能な tree オブジェクトがありません。');
    return;
  }
  let encoded: Buffer;
  try {
    encoded = fs.readFileSync(abs);
  } catch {
    errors.push('tree オブジェクトを読み取れません。');
    return;
  }
  let decoded;
  try {
    decoded = decodeVersionObjectBytes(encoded, hash);
  } catch {
    errors.push('tree オブジェクトが破損しています。');
    return;
  }
  if (decoded.type !== 'tree') {
    errors.push('tree 参照先の type が不正です。');
    return;
  }
  reachable.add(hash);
  stack.add(hash);
  let tree;
  try {
    tree = assertTreeObject(JSON.parse(decoded.payload.toString('utf8')));
  } catch {
    errors.push('tree ペイロードが不正です。');
    stack.delete(hash);
    return;
  }
  for (const entry of tree.entries) {
    if (entry.objectType === 'tree') {
      walkTree(repo, entry.hash, reachable, errors, stack);
    } else {
      const childAbs = objectAbsolutePath(repo, entry.hash);
      if (!fs.existsSync(childAbs)) {
        errors.push('到達可能な blob オブジェクトがありません。');
        continue;
      }
      try {
        const child = fs.readFileSync(childAbs);
        decodeVersionObjectBytes(child, entry.hash);
        reachable.add(entry.hash);
      } catch {
        errors.push('blob オブジェクトが破損しています。');
      }
    }
  }
  stack.delete(hash);
}

/**
 * リポジトリ整合性を read-only で検査する。自動削除は行わない。
 */
export function fsckVersionRepository(options: {
  rootDir: string;
  projectName: string;
}): FsckVersionResult {
  const repo = versionRepositoryPath(options.rootDir, options.projectName);
  const errors: string[] = [];
  const warnings: string[] = [];
  const staleLocks: string[] = [];
  const reachable = new Set<string>();

  if (!fs.existsSync(path.join(repo, 'format.json'))) {
    throw createVersionControlError(
      'SPEC_VERSION_NOT_INITIALIZED',
      '版管理リポジトリが初期化されていません。',
    );
  }

  try {
    assertMetadataPathBoundary(path.join(repo, 'format.json'), 'format.json');
  } catch {
    errors.push('format.json が不正です。');
  }

  // TEMP files
  const walkTemp = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory() && !st.isSymbolicLink()) {
        walkTemp(abs);
      } else if (name.includes('.tmp') || name.startsWith('.')) {
        warnings.push('TEMP または一時ファイルが残っています。');
      }
    }
  };
  walkTemp(path.join(repo, 'objects'));

  // locks
  const locksDir = path.join(repo, 'locks');
  if (fs.existsSync(locksDir)) {
    for (const name of fs.readdirSync(locksDir)) {
      if (name.endsWith('.lock')) {
        staleLocks.push(name);
        warnings.push(`lock が存在します: ${name}`);
      }
    }
  }

  const incompleteJournals = listIncompleteTransactions(options);
  const incomplete = incompleteJournals.map((j) => j.operationId);
  for (const journal of incompleteJournals) {
    warnings.push(
      `未完了 transaction があります: ${journal.operation}/${journal.phase}/${journal.operationId}`,
    );
    if (journal.phase === 'cleanup_pending') {
      warnings.push(
        `cleanup_pending transaction: ${journal.operationId}`,
      );
    }
    try {
      assertValidOperationId(journal.operationId);
    } catch {
      errors.push(`transaction operationId が不正です: ${journal.operationId}`);
      continue;
    }
    try {
      transactionJournalPath(
        options.rootDir,
        options.projectName,
        journal.operationId,
      );
      transactionWorktreeRoot(
        options.rootDir,
        options.projectName,
        journal.operationId,
      );
    } catch {
      errors.push(
        `transaction path が不正です: ${journal.operationId}`,
      );
    }
    for (const hash of [
      journal.oldHead.commit,
      journal.newHead.commit,
      journal.oldTree,
      journal.newTree,
      journal.newIndex.baseCommit,
      journal.newIndex.tree,
      journal.oldIndex.baseCommit,
      journal.oldIndex.tree,
    ]) {
      if (!hash) continue;
      if (!fs.existsSync(objectAbsolutePath(repo, hash))) {
        warnings.push(
          `transaction 参照 object がありません: ${hash.slice(0, 12)}`,
        );
      }
    }
    if (journal.sourceSwap) {
      const backup = transactionBackupSpecPath(
        options.rootDir,
        options.projectName,
        journal.operationId,
      );
      const next = transactionNextRoot(
        options.rootDir,
        options.projectName,
        journal.operationId,
      );
      if (
        (journal.phase === 'source_backed_up' ||
          journal.phase === 'source_installed') &&
        !fs.existsSync(backup) &&
        journal.phase === 'source_backed_up'
      ) {
        warnings.push(
          `backup TEMP がありません: ${journal.operationId}`,
        );
      }
      if (journal.phase === 'prepared' && fs.existsSync(next)) {
        warnings.push(`next TEMP が残っています: ${journal.operationId}`);
      }
    }
    try {
      const head = readVersionHead(options);
      const index = readVersionIndex(options);
      let sourceNote = 'not-applicable';
      if (journal.sourceSwap) {
        try {
          const hash = createWorkingSnapshot(options).rootTreeHash;
          sourceNote =
            hash === journal.newTree
              ? 'new'
              : journal.oldTree && hash === journal.oldTree
                ? 'old'
                : 'other';
        } catch {
          sourceNote = 'unreadable';
        }
      }
      warnings.push(
        `transaction 状態: head=${head.commit?.slice(0, 12) ?? 'none'} ` +
          `index=${index.baseCommit?.slice(0, 12) ?? 'none'} source=${sourceNote}`,
      );
    } catch {
      warnings.push(
        `transaction HEAD/index/source 状態を計算できません: ${journal.operationId}`,
      );
    }
  }

  // transactions ディレクトリの不正ファイル名
  const txDir = path.join(repo, 'transactions');
  if (fs.existsSync(txDir)) {
    try {
      const st = fs.lstatSync(txDir);
      if (st.isSymbolicLink()) {
        errors.push('transactions ディレクトリがシンボリックリンクです。');
      }
    } catch {
      errors.push('transactions ディレクトリを検証できません。');
    }
    for (const name of fs.readdirSync(txDir)) {
      if (!name.endsWith('.json') || name.startsWith('.')) continue;
      const id = name.slice(0, -'.json'.length);
      try {
        assertValidOperationId(id);
      } catch {
        errors.push(`不正な transaction ファイル名です: ${name}`);
      }
    }
  }

  // HEAD / branches / tags
  try {
    const head = readVersionHead(options);
    if (head.commit) {
      const abs = objectAbsolutePath(repo, head.commit);
      if (!fs.existsSync(abs)) {
        errors.push('HEAD commit オブジェクトがありません。');
      } else {
        try {
          const encoded = fs.readFileSync(abs);
          const decoded = decodeVersionObjectBytes(encoded, head.commit);
          if (decoded.type !== 'commit') {
            errors.push('HEAD の type が commit ではありません。');
          } else {
            const commit = assertCommitObject(
              JSON.parse(decoded.payload.toString('utf8')),
            );
            reachable.add(head.commit);
            walkTree(repo, commit.tree, reachable, errors, new Set());
            for (const parent of commit.parents) {
              if (!fs.existsSync(objectAbsolutePath(repo, parent))) {
                errors.push('commit parent がありません。');
              }
            }
          }
        } catch {
          errors.push('HEAD commit が破損しています。');
        }
      }
    }
  } catch {
    errors.push('HEAD を検証できません。');
  }

  try {
    for (const name of listRefNames({ ...options, kind: 'heads' })) {
      const hash = readVersionRef({ ...options, kind: 'heads', name });
      if (!fs.existsSync(objectAbsolutePath(repo, hash))) {
        errors.push('branch 参照先 commit がありません。');
        continue;
      }
      try {
        const encoded = fs.readFileSync(objectAbsolutePath(repo, hash));
        const decoded = decodeVersionObjectBytes(encoded, hash);
        if (decoded.type !== 'commit') {
          errors.push('branch 参照先 type が不正です。');
          continue;
        }
        const commit = assertCommitObject(
          JSON.parse(decoded.payload.toString('utf8')),
        );
        reachable.add(hash);
        walkTree(repo, commit.tree, reachable, errors, new Set());
      } catch {
        errors.push('branch 参照先が破損しています。');
      }
    }
  } catch {
    errors.push('branch ref を検証できません。');
  }

  try {
    for (const name of listRefNames({ ...options, kind: 'tags' })) {
      const hash = readVersionRef({ ...options, kind: 'tags', name });
      if (!fs.existsSync(objectAbsolutePath(repo, hash))) {
        errors.push('tag オブジェクトがありません。');
        continue;
      }
      try {
        const encoded = fs.readFileSync(objectAbsolutePath(repo, hash));
        const decoded = decodeVersionObjectBytes(encoded, hash);
        if (decoded.type !== 'tag') {
          errors.push('tag 参照先 type が不正です。');
          continue;
        }
        const tag = assertTagObject(
          JSON.parse(decoded.payload.toString('utf8')),
        );
        reachable.add(hash);
        if (!fs.existsSync(objectAbsolutePath(repo, tag.object))) {
          errors.push('tag 対象 commit がありません。');
        } else {
          reachable.add(tag.object);
        }
      } catch {
        errors.push('tag が破損しています。');
      }
    }
  } catch {
    errors.push('tag ref を検証できません。');
  }

  try {
    const index = readVersionIndex(options);
    if (!index.virtual) {
      walkTree(repo, index.tree, reachable, errors, new Set());
    }
  } catch {
    errors.push('index を検証できません。');
  }

  const all = collectObjectHashes(repo);
  const danglingObjects = all.filter((hash) => !reachable.has(hash));
  for (const hash of danglingObjects) {
    warnings.push(`dangling object: ${hash.slice(0, 12)}`);
  }

  // checkedObjects = all scanned
  if (errors.length > 0) {
    // 呼び出し側が code を欲しければ throw せず結果で返す（read-only）
  }

  return {
    errors,
    warnings,
    danglingObjects,
    staleLocks,
    incompleteTransactions: incomplete,
    reachableObjects: reachable.size,
    checkedObjects: all.length,
  };
}

/** errors があるとき例外にしたい呼び出し向け。 */
export function assertFsckClean(options: {
  rootDir: string;
  projectName: string;
}): FsckVersionResult {
  const result = fsckVersionRepository(options);
  if (result.errors.length > 0) {
    throw createVersionControlError(
      'SPEC_VERSION_FSCK_FAILED',
      'リポジトリ整合性検査でエラーが見つかりました。',
    );
  }
  return result;
}
