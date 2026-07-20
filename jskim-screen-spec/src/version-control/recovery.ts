import fs from 'node:fs';
import path from 'node:path';
import { createVersionControlError } from './errors.js';
import { assertMetadataPathBoundary, assertNotSymlink } from './fs-guards.js';
import { readVersionHead } from './head.js';
import { removeVersionMergeState } from './merge-state.js';
import { readVersionObject } from './object-store.js';
import { versionRepositoryPath } from './repository-paths.js';
import { createWorkingSnapshot } from './snapshot.js';
import {
  assertValidOperationId,
  listIncompleteTransactions,
  removeTransactionArtifacts,
  renamePath,
  transactionBackupPagesPath,
  transactionBackupSpecPath,
  transactionNextRoot,
  transactionWorktreeRoot,
  type HeadSnapshot,
  type VersionTransactionJournal,
} from './transaction.js';
import { assertCommitObject } from './validate-object.js';
import {
  readVersionIndex,
  removeVersionIndex,
  withIndexLock,
  writeVersionIndex,
} from './version-index.js';

export type RecoveryHeadState = 'old' | 'new' | 'other';
export type RecoveryIndexState = 'old' | 'new' | 'other' | 'missing';
export type RecoverySourceState =
  | 'old'
  | 'new'
  | 'other'
  | 'not-applicable';
export type RecoveryRecommendedAction =
  | 'rollback'
  | 'complete'
  | 'cleanup'
  | 'unsafe';

export type TransactionRecoveryPlan = {
  operation: VersionTransactionJournal['operation'];
  operationId: string;
  phase: VersionTransactionJournal['phase'];
  headState: RecoveryHeadState;
  indexState: RecoveryIndexState;
  sourceState: RecoverySourceState;
  recommendedAction: RecoveryRecommendedAction;
};

export type VersionRecoveryInspection = {
  mutationLock: {
    present: boolean;
    pid?: number;
    operation?: string;
    operationId?: string;
    startedAt?: string;
    pidAlive?: boolean | null;
  } | null;
  indexLockPresent: boolean;
  incompleteTransactions: VersionTransactionJournal[];
  /** browser-safe。絶対 path は含めない */
  plans: TransactionRecoveryPlan[];
  recoveryRequired: boolean;
};

export type RecoverVersionOptions = {
  rootDir: string;
  projectName: string;
  /** 明示確認。false/省略では変更しない。 */
  confirm: boolean;
  /** orphan lock 削除時に必要な operationId */
  expectedOperationId?: string;
  /** orphan stale lock を強制除去（PID 生存確認不可時） */
  forceRemoveOrphanLock?: boolean;
};

function isPidAlive(pid: number): boolean | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    return null;
  }
}

function readLockPayload(
  lockPath: string,
): {
  pid?: number;
  operation?: string;
  operationId?: string;
  startedAt?: string;
} | null {
  try {
    assertMetadataPathBoundary(lockPath, 'lock');
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as {
      pid?: unknown;
      operation?: unknown;
      operationId?: unknown;
      startedAt?: unknown;
    };
    return {
      pid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
      operation:
        typeof parsed.operation === 'string' ? parsed.operation : undefined,
      operationId:
        typeof parsed.operationId === 'string'
          ? parsed.operationId
          : undefined,
      startedAt:
        typeof parsed.startedAt === 'string' ? parsed.startedAt : undefined,
    };
  } catch {
    return null;
  }
}

function projectSpecSrc(rootDir: string, projectName: string): string {
  return path.join(rootDir, 'spec', projectName, 'src');
}

function projectPages(rootDir: string, projectName: string): string {
  return path.join(rootDir, 'src', projectName, 'pages');
}

function headMatches(
  current: { commit: string | null; ref: string | null; unborn: boolean },
  expected: HeadSnapshot,
): boolean {
  if (expected.mode === 'unborn') {
    return current.unborn === true && current.ref === expected.ref;
  }
  if (expected.mode === 'symbolic') {
    return (
      !current.unborn &&
      current.ref === expected.ref &&
      current.commit === expected.commit
    );
  }
  return (
    !current.unborn &&
    current.ref === null &&
    current.commit === expected.commit
  );
}

function classifyHead(
  current: { commit: string | null; ref: string | null; unborn: boolean },
  journal: VersionTransactionJournal,
): RecoveryHeadState {
  const headUnchanged =
    journal.oldHead.commit &&
    journal.newHead.commit &&
    journal.oldHead.commit === journal.newHead.commit &&
    journal.oldHead.ref === journal.newHead.ref;
  if (headUnchanged && headMatches(current, journal.oldHead)) {
    return 'old';
  }
  if (headMatches(current, journal.newHead)) return 'new';
  if (headMatches(current, journal.oldHead)) return 'old';
  return 'other';
}

function classifyIndex(
  index: {
    virtual: boolean;
    baseCommit: string | null;
    tree: string;
  },
  journal: VersionTransactionJournal,
): RecoveryIndexState {
  if (index.virtual) {
    return 'missing';
  }
  if (
    index.baseCommit === journal.newIndex.baseCommit &&
    index.tree === journal.newIndex.tree
  ) {
    return 'new';
  }
  if (
    journal.oldIndex.exists &&
    index.baseCommit === journal.oldIndex.baseCommit &&
    index.tree === journal.oldIndex.tree
  ) {
    return 'old';
  }
  // oldIndex が無かった場合、virtual 相当の base/tree 一致を old とみなす
  if (
    !journal.oldIndex.exists &&
    index.baseCommit === journal.oldIndex.baseCommit &&
    index.tree === journal.oldIndex.tree
  ) {
    return 'old';
  }
  return 'other';
}

function classifySource(
  options: { rootDir: string; projectName: string },
  journal: VersionTransactionJournal,
): RecoverySourceState {
  if (
    !journal.sourceSwap ||
    journal.operation === 'commit' ||
    journal.operation === 'merge-continue'
  ) {
    return 'not-applicable';
  }
  try {
    const hash = createWorkingSnapshot(options).rootTreeHash;
    if (hash === journal.newTree) return 'new';
    if (journal.oldTree && hash === journal.oldTree) return 'old';
    return 'other';
  } catch {
    return 'other';
  }
}

function decideAction(
  journal: VersionTransactionJournal,
  headState: RecoveryHeadState,
  indexState: RecoveryIndexState,
  sourceState: RecoverySourceState,
): RecoveryRecommendedAction {
  if (headState === 'other' || indexState === 'other') {
    return 'unsafe';
  }
  if (sourceState === 'other') {
    return 'unsafe';
  }

  if (
    journal.operation === 'merge' &&
    journal.phase === 'cleanup_pending' &&
    headState === 'old' &&
    indexState === 'new' &&
    sourceState === 'new'
  ) {
    return 'cleanup';
  }

  if (
    journal.operation === 'merge-abort' &&
    (journal.phase === 'index_reset' || journal.phase === 'cleanup_pending') &&
    (headState === 'old' || headState === 'new') &&
    indexState === 'new' &&
    sourceState === 'new'
  ) {
    return 'cleanup';
  }

  const commitLike =
    journal.operation === 'commit' || journal.operation === 'merge-continue';
  const checkoutLike =
    journal.operation === 'checkout' ||
    journal.operation === 'revert' ||
    journal.operation === 'merge' ||
    journal.operation === 'merge-abort';

  if (commitLike) {
    if (headState === 'new') {
      if (journal.sourceSwap && sourceState === 'old') {
        return 'unsafe';
      }
      if (
        (sourceState === 'new' || sourceState === 'not-applicable') &&
        (indexState === 'old' || indexState === 'missing')
      ) {
        return 'complete';
      }
      if (
        (sourceState === 'new' || sourceState === 'not-applicable') &&
        indexState === 'new'
      ) {
        return 'cleanup';
      }
      return 'unsafe';
    }
    if (headState === 'old') {
      if (
        journal.sourceSwap &&
        sourceState === 'new' &&
        (journal.phase === 'source_installed' ||
          journal.phase === 'source_backed_up' ||
          journal.phase === 'prepared')
      ) {
        return 'rollback';
      }
      if (
        (sourceState === 'old' || sourceState === 'not-applicable') &&
        (indexState === 'old' || indexState === 'missing')
      ) {
        return 'cleanup';
      }
      return 'unsafe';
    }
    return 'unsafe';
  }

  if (checkoutLike) {
    if (headState === 'new') {
      if (journal.sourceSwap && sourceState === 'old') {
        return 'unsafe';
      }
      if (
        (sourceState === 'new' || sourceState === 'not-applicable') &&
        (indexState === 'old' || indexState === 'missing')
      ) {
        return 'complete';
      }
      if (
        (sourceState === 'new' || sourceState === 'not-applicable') &&
        indexState === 'new'
      ) {
        return 'cleanup';
      }
      return 'unsafe';
    }

    if (headState === 'old') {
      if (
        journal.sourceSwap &&
        sourceState === 'new' &&
        (journal.phase === 'source_installed' ||
          journal.phase === 'source_backed_up' ||
          journal.phase === 'prepared' ||
          journal.phase === 'ref_updated')
      ) {
        if (journal.phase === 'ref_updated') {
          return 'unsafe';
        }
        return 'rollback';
      }

      if (
        (sourceState === 'old' || sourceState === 'not-applicable') &&
        (indexState === 'old' || indexState === 'missing')
      ) {
        return 'cleanup';
      }

      return 'unsafe';
    }

    return 'unsafe';
  }

  return 'unsafe';
}

function buildPlan(
  options: { rootDir: string; projectName: string },
  journal: VersionTransactionJournal,
): TransactionRecoveryPlan {
  const head = readVersionHead(options);
  const index = readVersionIndex(options);
  const headState = classifyHead(head, journal);
  const indexState = classifyIndex(index, journal);
  const sourceState = classifySource(options, journal);
  const recommendedAction = decideAction(
    journal,
    headState,
    indexState,
    sourceState,
  );
  return {
    operation: journal.operation,
    operationId: journal.operationId,
    phase: journal.phase,
    headState,
    indexState,
    sourceState,
    recommendedAction,
  };
}

function assertCommitIntegrity(
  options: { rootDir: string; projectName: string },
  commitHash: string,
  expectedTree: string,
): void {
  const object = readVersionObject({
    ...options,
    hash: commitHash,
    expectedType: 'commit',
  });
  const commit = assertCommitObject(
    JSON.parse(object.payload.toString('utf8')),
  );
  if (commit.tree !== expectedTree) {
    throw createVersionControlError(
      'SPEC_VERSION_RECOVERY_UNSAFE',
      'new commit の tree が journal と一致しません。',
    );
  }
}

function restoreIndex(
  options: { rootDir: string; projectName: string },
  journal: VersionTransactionJournal,
  which: 'old' | 'new',
): void {
  if (which === 'new') {
    assertCommitIntegrity(
      options,
      journal.newIndex.baseCommit,
      journal.newIndex.tree,
    );
    writeVersionIndex({
      ...options,
      index: {
        schemaVersion: '1.0',
        baseCommit: journal.newIndex.baseCommit,
        tree: journal.newIndex.tree,
      },
      alreadyLocked: true,
    });
    return;
  }
  if (!journal.oldIndex.exists) {
    removeVersionIndex({ ...options, alreadyLocked: true });
    return;
  }
  if (!journal.oldIndex.baseCommit || !journal.oldIndex.tree) {
    throw createVersionControlError(
      'SPEC_VERSION_RECOVERY_UNSAFE',
      'old index メタデータが不足しています。',
    );
  }
  writeVersionIndex({
    ...options,
    index: {
      schemaVersion: '1.0',
      baseCommit: journal.oldIndex.baseCommit,
      tree: journal.oldIndex.tree,
    },
    alreadyLocked: true,
  });
}

function removeDerivedBestEffort(
  rootDir: string,
  projectName: string,
): boolean {
  try {
    const paths = [
      path.join(rootDir, 'spec', projectName, 'src', 'resources', 'manifest.json'),
      path.join(rootDir, 'spec', projectName, 'dist'),
    ];
    for (const abs of paths) {
      if (!fs.existsSync(abs)) continue;
      assertNotSymlink(abs, 'derived');
      fs.rmSync(abs, { recursive: true, force: true });
    }
    return true;
  } catch {
    return false;
  }
}

function rollbackSourceSwap(
  options: { rootDir: string; projectName: string },
  journal: VersionTransactionJournal,
): void {
  if (!journal.sourceSwap || !journal.oldTree) {
    throw createVersionControlError(
      'SPEC_VERSION_RECOVERY_UNSAFE',
      'source rollback に必要な情報が不足しています。',
    );
  }
  const id = assertValidOperationId(journal.operationId);
  const backupSpec = transactionBackupSpecPath(
    options.rootDir,
    options.projectName,
    id,
  );
  const backupPages = transactionBackupPagesPath(
    options.rootDir,
    options.projectName,
    id,
  );
  const holdRoot = path.join(
    transactionWorktreeRoot(options.rootDir, options.projectName, id),
    'installed-hold',
  );
  const holdSpec = path.join(holdRoot, 'spec-src');
  const holdPages = path.join(holdRoot, 'pages');
  const specSrc = projectSpecSrc(options.rootDir, options.projectName);
  const pages = projectPages(options.rootDir, options.projectName);

  if (!fs.existsSync(backupSpec)) {
    throw createVersionControlError(
      'SPEC_VERSION_RECOVERY_UNSAFE',
      'backup source がありません。',
    );
  }
  assertNotSymlink(backupSpec, 'backup-spec-src');
  if (fs.existsSync(backupPages)) {
    assertNotSymlink(backupPages, 'backup-pages');
  }

  const installed = createWorkingSnapshot(options).rootTreeHash;
  if (installed !== journal.newTree) {
    throw createVersionControlError(
      'SPEC_VERSION_RECOVERY_UNSAFE',
      'installed source が journal.newTree と一致しないため自動 rollback できません。',
    );
  }

  fs.mkdirSync(holdRoot, { recursive: true });
  if (fs.existsSync(specSrc)) {
    if (fs.existsSync(holdSpec)) {
      fs.rmSync(holdSpec, { recursive: true, force: true });
    }
    renamePath(specSrc, holdSpec);
  }
  if (fs.existsSync(pages)) {
    if (fs.existsSync(holdPages)) {
      fs.rmSync(holdPages, { recursive: true, force: true });
    }
    renamePath(pages, holdPages);
  }

  renamePath(backupSpec, specSrc);
  if (fs.existsSync(backupPages)) {
    fs.mkdirSync(path.dirname(pages), { recursive: true });
    renamePath(backupPages, pages);
  }

  const restored = createWorkingSnapshot(options).rootTreeHash;
  if (restored !== journal.oldTree) {
    // 可能な限り hold を戻す
    try {
      if (fs.existsSync(specSrc)) {
        fs.rmSync(specSrc, { recursive: true, force: true });
      }
      if (fs.existsSync(holdSpec)) renamePath(holdSpec, specSrc);
      if (fs.existsSync(pages)) {
        fs.rmSync(pages, { recursive: true, force: true });
      }
      if (fs.existsSync(holdPages)) renamePath(holdPages, pages);
    } catch {
      // ignore
    }
    throw createVersionControlError(
      'SPEC_VERSION_RECOVERY_UNSAFE',
      'backup 復元後の snapshot が oldTree と一致しません。',
    );
  }
}

function forwardMaterializeFromObjects(
  options: { rootDir: string; projectName: string },
  journal: VersionTransactionJournal,
): void {
  // HEAD new + source old: 安全な next があり unmanaged 保全できる場合のみ
  const id = assertValidOperationId(journal.operationId);
  const nextRoot = transactionNextRoot(
    options.rootDir,
    options.projectName,
    id,
  );
  if (!fs.existsSync(nextRoot)) {
    throw createVersionControlError(
      'SPEC_VERSION_RECOVERY_UNSAFE',
      'HEAD は新・source は旧ですが安全な next source がありません。',
    );
  }
  throw createVersionControlError(
    'SPEC_VERSION_RECOVERY_UNSAFE',
    'HEAD は新・source は旧のため自動 forward は行いません。',
  );
}

/** recovery 状態を read-only で点検する。 */
export function inspectVersionRecovery(options: {
  rootDir: string;
  projectName: string;
}): VersionRecoveryInspection {
  const repo = versionRepositoryPath(options.rootDir, options.projectName);
  if (!fs.existsSync(path.join(repo, 'format.json'))) {
    throw createVersionControlError(
      'SPEC_VERSION_NOT_INITIALIZED',
      '版管理リポジトリが初期化されていません。',
    );
  }

  const mutationPath = path.join(repo, 'locks', 'mutation.lock');
  const indexPath = path.join(repo, 'locks', 'index.lock');
  let mutationLock: VersionRecoveryInspection['mutationLock'] = null;
  if (fs.existsSync(mutationPath)) {
    const payload = readLockPayload(mutationPath);
    mutationLock = {
      present: true,
      pid: payload?.pid,
      operation: payload?.operation,
      operationId: payload?.operationId,
      startedAt: payload?.startedAt,
      pidAlive:
        payload?.pid !== undefined ? isPidAlive(payload.pid) : null,
    };
  }

  const incompleteTransactions = listIncompleteTransactions(options);
  const plans = incompleteTransactions.map((journal) =>
    buildPlan(options, journal),
  );

  return {
    mutationLock,
    indexLockPresent: fs.existsSync(indexPath),
    incompleteTransactions,
    plans,
    recoveryRequired:
      incompleteTransactions.length > 0 ||
      mutationLock?.present === true ||
      fs.existsSync(indexPath),
  };
}

/**
 * 明示的 recovery。inspect が単一の安全 action を示したときのみ変更する。
 */
export function recoverVersionRepository(
  options: RecoverVersionOptions,
): VersionRecoveryInspection {
  if (!options.confirm) {
    throw createVersionControlError(
      'SPEC_VERSION_RECOVERY_UNSAFE',
      'recovery には明示的な confirm が必要です。',
    );
  }

  const repo = versionRepositoryPath(options.rootDir, options.projectName);
  const inspection = inspectVersionRecovery(options);
  const mutationPath = path.join(repo, 'locks', 'mutation.lock');
  const indexLockPath = path.join(repo, 'locks', 'index.lock');

  if (inspection.mutationLock?.present) {
    if (inspection.mutationLock.pidAlive === true) {
      throw createVersionControlError(
        'SPEC_VERSION_RECOVERY_UNSAFE',
        'active とみられる mutation lock は除去できません。',
      );
    }

    const linked = inspection.incompleteTransactions.some(
      (journal) =>
        journal.operationId === inspection.mutationLock?.operationId,
    );

    if (!linked) {
      if (
        !options.forceRemoveOrphanLock ||
        !options.expectedOperationId ||
        options.expectedOperationId !== inspection.mutationLock.operationId
      ) {
        throw createVersionControlError(
          'SPEC_VERSION_RECOVERY_UNSAFE',
          'orphan lock の除去には expectedOperationId と forceRemoveOrphanLock が必要です。',
        );
      }
    }

    try {
      assertMetadataPathBoundary(mutationPath, 'mutation.lock');
      fs.unlinkSync(mutationPath);
    } catch {
      throw createVersionControlError(
        'SPEC_VERSION_RECOVERY_REQUIRED',
        'mutation lock を除去できませんでした。',
      );
    }
  }

  if (inspection.indexLockPresent) {
    // crash 後の stale index.lock。未完了 transaction がある場合は除去して続行。
    // それ以外は force 条件を要求する。
    const allow =
      inspection.incompleteTransactions.length > 0 ||
      (options.forceRemoveOrphanLock === true &&
        typeof options.expectedOperationId === 'string');
    if (!allow) {
      throw createVersionControlError(
        'SPEC_VERSION_RECOVERY_UNSAFE',
        'index lock の除去には明示的 force が必要です。',
      );
    }
    try {
      assertMetadataPathBoundary(indexLockPath, 'index.lock');
      fs.unlinkSync(indexLockPath);
    } catch {
      throw createVersionControlError(
        'SPEC_VERSION_RECOVERY_REQUIRED',
        'index lock を除去できませんでした。',
      );
    }
  }

  // 再検査（lock 除去後）
  const afterLocks = inspectVersionRecovery(options);
  if (afterLocks.plans.length === 0) {
    return afterLocks;
  }

  if (afterLocks.plans.length > 1) {
    throw createVersionControlError(
      'SPEC_VERSION_RECOVERY_UNSAFE',
      '複数の未完了 transaction があるため自動回復できません。',
    );
  }

  const plan = afterLocks.plans[0];
  if (!plan || plan.recommendedAction === 'unsafe') {
    throw createVersionControlError(
      'SPEC_VERSION_RECOVERY_UNSAFE',
      '状態が曖昧なため自動回復できません。',
    );
  }

  const journal = afterLocks.incompleteTransactions[0];
  if (!journal) {
    throw createVersionControlError(
      'SPEC_VERSION_RECOVERY_UNSAFE',
      'transaction journal が見つかりません。',
    );
  }

  // 実行直前に再判定
  const fresh = buildPlan(options, journal);
  if (fresh.recommendedAction !== plan.recommendedAction) {
    throw createVersionControlError(
      'SPEC_VERSION_RECOVERY_UNSAFE',
      'recovery 判定が安定しません。',
    );
  }

  withIndexLock(options, () => {
    const live = buildPlan(options, journal);
    if (live.recommendedAction === 'unsafe') {
      throw createVersionControlError(
        'SPEC_VERSION_RECOVERY_UNSAFE',
        '状態が曖昧なため自動回復できません。',
      );
    }

    if (live.recommendedAction === 'complete') {
      if (live.headState !== 'new') {
        throw createVersionControlError(
          'SPEC_VERSION_RECOVERY_UNSAFE',
          'forward recovery には new HEAD が必要です。',
        );
      }
      if (
        journal.sourceSwap &&
        live.sourceState !== 'new' &&
        live.sourceState !== 'not-applicable'
      ) {
        if (live.sourceState === 'old') {
          forwardMaterializeFromObjects(options, journal);
        }
        throw createVersionControlError(
          'SPEC_VERSION_RECOVERY_UNSAFE',
          'source が new ではないため forward recovery できません。',
        );
      }
      assertCommitIntegrity(
        options,
        journal.newIndex.baseCommit,
        journal.newIndex.tree,
      );
      restoreIndex(options, journal, 'new');
      if (journal.operation === 'merge-continue') {
        removeVersionMergeState(options);
      }
      if (journal.sourceSwap) {
        if (!removeDerivedBestEffort(options.rootDir, options.projectName)) {
          // cleanup_pending 相当で journal を残す → 呼び出し側が再実行
          throw createVersionControlError(
            'SPEC_VERSION_RECOVERY_REQUIRED',
            'index は回復しましたが derived cleanup に失敗しました。',
          );
        }
      }
      removeTransactionArtifacts({
        rootDir: options.rootDir,
        projectName: options.projectName,
        operationId: journal.operationId,
      });
      return;
    }

    if (live.recommendedAction === 'rollback') {
      if (live.headState !== 'old') {
        throw createVersionControlError(
          'SPEC_VERSION_RECOVERY_UNSAFE',
          'rollback には old HEAD が必要です。',
        );
      }
      rollbackSourceSwap(options, journal);
      restoreIndex(options, journal, 'old');
      removeTransactionArtifacts({
        rootDir: options.rootDir,
        projectName: options.projectName,
        operationId: journal.operationId,
      });
      return;
    }

    if (live.recommendedAction === 'cleanup') {
      if (live.headState === 'old') {
        if (
          journal.operation === 'merge' &&
          journal.phase === 'cleanup_pending' &&
          live.indexState === 'new'
        ) {
          removeTransactionArtifacts({
            rootDir: options.rootDir,
            projectName: options.projectName,
            operationId: journal.operationId,
          });
          return;
        }
        if (
          journal.operation === 'merge-abort' &&
          (journal.phase === 'index_reset' ||
            journal.phase === 'cleanup_pending') &&
          live.indexState === 'new'
        ) {
          removeVersionMergeState(options);
          removeTransactionArtifacts({
            rootDir: options.rootDir,
            projectName: options.projectName,
            operationId: journal.operationId,
          });
          return;
        }
        // old 完了相当: index を old に揃え journal 掃除
        if (live.indexState !== 'old' && live.indexState !== 'missing') {
          restoreIndex(options, journal, 'old');
        }
        removeTransactionArtifacts({
          rootDir: options.rootDir,
          projectName: options.projectName,
          operationId: journal.operationId,
        });
        return;
      }
      if (live.headState === 'new') {
        if (live.indexState !== 'new') {
          restoreIndex(options, journal, 'new');
        }
        if (journal.sourceSwap) {
          removeDerivedBestEffort(options.rootDir, options.projectName);
        }
        // status 確認（commit は unstaged 維持）
        removeTransactionArtifacts({
          rootDir: options.rootDir,
          projectName: options.projectName,
          operationId: journal.operationId,
        });
        return;
      }
      throw createVersionControlError(
        'SPEC_VERSION_RECOVERY_UNSAFE',
        'cleanup 対象の HEAD 状態が不正です。',
      );
    }

    throw createVersionControlError(
      'SPEC_VERSION_RECOVERY_UNSAFE',
      '未知の recovery action です。',
    );
  });

  return inspectVersionRecovery(options);
}
