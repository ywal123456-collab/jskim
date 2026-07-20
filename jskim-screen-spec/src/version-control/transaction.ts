import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalizeJsonBytes } from './canonical-json.js';
import { createVersionControlError } from './errors.js';
import { assertMetadataPathBoundary, assertNotSymlink } from './fs-guards.js';
import { versionRepositoryPath } from './repository-paths.js';

/** 共通 transaction phase（operation により一部のみ使用） */
export type TransactionPhase =
  | 'prepared'
  | 'source_backed_up'
  | 'source_installed'
  | 'ref_updated'
  | 'index_reset'
  | 'cleanup_pending'
  | 'completed';

export type HeadSnapshot = {
  mode: 'symbolic' | 'detached' | 'unborn';
  /** refs/heads/... または null（detached/unborn） */
  ref: string | null;
  commit: string | null;
};

export type IndexSnapshot = {
  exists: boolean;
  revision: string | null;
  baseCommit: string | null;
  tree: string | null;
};

/**
 * journal は operationId のみで path を導出する。
 * 自由な相対 path 文字列は保存しない（traversal 防止）。
 */
export type VersionTransactionJournal = {
  schemaVersion: '1.0';
  operationId: string;
  operation: 'commit' | 'checkout' | 'revert' | 'merge' | 'merge-continue' | 'merge-abort';
  phase: TransactionPhase;
  oldHead: HeadSnapshot;
  newHead: HeadSnapshot;
  oldIndex: IndexSnapshot;
  newIndex: {
    baseCommit: string;
    tree: string;
  };
  /** 変更前の HEAD/working tree hash（sourceSwap 時の検証用） */
  oldTree: string | null;
  newTree: string;
  sourceSwap: boolean;
};

const OPERATION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PHASES: ReadonlySet<TransactionPhase> = new Set([
  'prepared',
  'source_backed_up',
  'source_installed',
  'ref_updated',
  'index_reset',
  'cleanup_pending',
  'completed',
]);

export type TransactionFs = {
  mkdirSync: typeof fs.mkdirSync;
  writeFileSync: typeof fs.writeFileSync;
  readFileSync: typeof fs.readFileSync;
  existsSync: typeof fs.existsSync;
  unlinkSync: typeof fs.unlinkSync;
  renameSync: typeof fs.renameSync;
  rmSync: typeof fs.rmSync;
  openSync: typeof fs.openSync;
  writeSync: typeof fs.writeSync;
  fsyncSync: typeof fs.fsyncSync;
  closeSync: typeof fs.closeSync;
  lstatSync: typeof fs.lstatSync;
  readdirSync: typeof fs.readdirSync;
};

const defaultFs: TransactionFs = {
  mkdirSync: fs.mkdirSync.bind(fs),
  writeFileSync: fs.writeFileSync.bind(fs),
  readFileSync: fs.readFileSync.bind(fs),
  existsSync: fs.existsSync.bind(fs),
  unlinkSync: fs.unlinkSync.bind(fs),
  renameSync: fs.renameSync.bind(fs),
  rmSync: fs.rmSync.bind(fs),
  openSync: fs.openSync.bind(fs),
  writeSync: fs.writeSync.bind(fs),
  fsyncSync: fs.fsyncSync.bind(fs),
  closeSync: fs.closeSync.bind(fs),
  lstatSync: fs.lstatSync.bind(fs),
  readdirSync: fs.readdirSync.bind(fs),
};

/** operationId を厳格検証する（UUID のみ）。 */
export function assertValidOperationId(operationId: string): string {
  if (
    typeof operationId !== 'string' ||
    !OPERATION_ID_RE.test(operationId) ||
    operationId.includes('\0') ||
    operationId.includes('/') ||
    operationId.includes('\\') ||
    operationId.includes('..') ||
    path.isAbsolute(operationId)
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_RECOVERY_UNSAFE',
      'transaction operationId が不正です。',
    );
  }
  return operationId.toLowerCase();
}

export function createOperationId(): string {
  return crypto.randomUUID();
}

function repoRoot(rootDir: string, projectName: string): string {
  return versionRepositoryPath(rootDir, projectName);
}

function assertInside(root: string, candidate: string, label: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.includes('\0')) {
    throw createVersionControlError(
      'SPEC_VERSION_RECOVERY_UNSAFE',
      `${label} が transaction root の外です。`,
    );
  }
  return resolved;
}

export function transactionJournalPath(
  rootDir: string,
  projectName: string,
  operationId: string,
): string {
  const id = assertValidOperationId(operationId);
  const repo = repoRoot(rootDir, projectName);
  const dir = path.join(repo, 'transactions');
  const target = path.join(dir, `${id}.json`);
  return assertInside(dir, target, 'journal');
}

export function transactionWorktreeRoot(
  rootDir: string,
  projectName: string,
  operationId: string,
): string {
  const id = assertValidOperationId(operationId);
  const repo = repoRoot(rootDir, projectName);
  const worktrees = path.join(repo, 'worktrees');
  const target = path.join(worktrees, id);
  return assertInside(worktrees, target, 'worktree');
}

export function transactionNextRoot(
  rootDir: string,
  projectName: string,
  operationId: string,
): string {
  return path.join(
    transactionWorktreeRoot(rootDir, projectName, operationId),
    'next',
  );
}

export function transactionBackupSpecPath(
  rootDir: string,
  projectName: string,
  operationId: string,
): string {
  return path.join(
    transactionWorktreeRoot(rootDir, projectName, operationId),
    'backup-spec-src',
  );
}

export function transactionBackupPagesPath(
  rootDir: string,
  projectName: string,
  operationId: string,
): string {
  return path.join(
    transactionWorktreeRoot(rootDir, projectName, operationId),
    'backup-pages',
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertHeadSnapshot(value: unknown, label: string): HeadSnapshot {
  if (!isPlainObject(value)) {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      `${label} が不正です。`,
    );
  }
  const mode = value.mode;
  if (mode !== 'symbolic' && mode !== 'detached' && mode !== 'unborn') {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      `${label}.mode が不正です。`,
    );
  }
  const ref =
    value.ref === null
      ? null
      : typeof value.ref === 'string'
        ? value.ref
        : undefined;
  const commit =
    value.commit === null
      ? null
      : typeof value.commit === 'string'
        ? value.commit
        : undefined;
  if (ref === undefined || commit === undefined) {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      `${label} の ref/commit が不正です。`,
    );
  }
  if (ref !== null && (!ref.startsWith('refs/heads/') || ref.includes('..'))) {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      `${label}.ref が不正です。`,
    );
  }
  if (commit !== null && !/^[a-f0-9]{64}$/.test(commit)) {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      `${label}.commit が不正です。`,
    );
  }
  return { mode, ref, commit };
}

function assertIndexSnapshot(value: unknown, label: string): IndexSnapshot {
  if (!isPlainObject(value) || typeof value.exists !== 'boolean') {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      `${label} が不正です。`,
    );
  }
  const revision =
    value.revision === null
      ? null
      : typeof value.revision === 'string'
        ? value.revision
        : null;
  const baseCommit =
    value.baseCommit === null
      ? null
      : typeof value.baseCommit === 'string'
        ? value.baseCommit
        : null;
  const tree =
    value.tree === null
      ? null
      : typeof value.tree === 'string'
        ? value.tree
        : null;
  if (baseCommit !== null && !/^[a-f0-9]{64}$/.test(baseCommit)) {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      `${label}.baseCommit が不正です。`,
    );
  }
  if (tree !== null && !/^[a-f0-9]{64}$/.test(tree)) {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      `${label}.tree が不正です。`,
    );
  }
  return {
    exists: value.exists,
    revision,
    baseCommit,
    tree,
  };
}

export function assertVersionTransactionJournal(
  value: unknown,
): VersionTransactionJournal {
  if (!isPlainObject(value)) {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      'transaction journal が不正です。',
    );
  }
  const allowed = new Set([
    'schemaVersion',
    'operationId',
    'operation',
    'phase',
    'oldHead',
    'newHead',
    'oldIndex',
    'newIndex',
    'oldTree',
    'newTree',
    'sourceSwap',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw createVersionControlError(
        'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
        'transaction journal に不正なフィールドがあります。',
      );
    }
  }
  if (value.schemaVersion !== '1.0') {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      '未対応の transaction schemaVersion です。',
    );
  }
  const operationId = assertValidOperationId(String(value.operationId ?? ''));
  if (
    value.operation !== 'commit' &&
    value.operation !== 'checkout' &&
    value.operation !== 'revert' &&
    value.operation !== 'merge' &&
    value.operation !== 'merge-continue' &&
    value.operation !== 'merge-abort'
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      'transaction operation が不正です。',
    );
  }
  if (
    typeof value.phase !== 'string' ||
    !PHASES.has(value.phase as TransactionPhase)
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      'transaction phase が不正です。',
    );
  }
  if (!isPlainObject(value.newIndex)) {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      'newIndex が不正です。',
    );
  }
  const newBase = value.newIndex.baseCommit;
  const newTreeIdx = value.newIndex.tree;
  if (
    typeof newBase !== 'string' ||
    !/^[a-f0-9]{64}$/.test(newBase) ||
    typeof newTreeIdx !== 'string' ||
    !/^[a-f0-9]{64}$/.test(newTreeIdx)
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      'newIndex の hash が不正です。',
    );
  }
  const oldTree =
    value.oldTree === null
      ? null
      : typeof value.oldTree === 'string' && /^[a-f0-9]{64}$/.test(value.oldTree)
        ? value.oldTree
        : null;
  if (value.oldTree !== null && oldTree === null) {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      'oldTree が不正です。',
    );
  }
  if (typeof value.newTree !== 'string' || !/^[a-f0-9]{64}$/.test(value.newTree)) {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      'newTree が不正です。',
    );
  }
  if (typeof value.sourceSwap !== 'boolean') {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      'sourceSwap が不正です。',
    );
  }
  return {
    schemaVersion: '1.0',
    operationId,
    operation: value.operation,
    phase: value.phase as TransactionPhase,
    oldHead: assertHeadSnapshot(value.oldHead, 'oldHead'),
    newHead: assertHeadSnapshot(value.newHead, 'newHead'),
    oldIndex: assertIndexSnapshot(value.oldIndex, 'oldIndex'),
    newIndex: { baseCommit: newBase, tree: newTreeIdx },
    oldTree,
    newTree: value.newTree,
    sourceSwap: value.sourceSwap,
  };
}

function writeJournalDurably(
  target: string,
  journal: VersionTransactionJournal,
  io: TransactionFs,
): void {
  const dir = path.dirname(target);
  io.mkdirSync(dir, { recursive: true });
  assertMetadataPathBoundary(dir, 'transactions');
  assertMetadataPathBoundary(target, 'transaction journal');
  if (io.existsSync(dir)) {
    assertNotSymlink(dir, 'transactions');
  }
  const temp = path.join(
    dir,
    `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`,
  );
  const bytes = Buffer.concat([
    canonicalizeJsonBytes(journal),
    Buffer.from('\n'),
  ]);
  let fd: number | null = null;
  try {
    fd = io.openSync(temp, 'wx');
    io.writeSync(fd, bytes, 0, bytes.byteLength, 0);
    io.fsyncSync(fd);
    io.closeSync(fd);
    fd = null;
    io.renameSync(temp, target);
  } catch {
    if (fd != null) {
      try {
        io.closeSync(fd);
      } catch {
        // ignore
      }
    }
    try {
      if (io.existsSync(temp)) io.unlinkSync(temp);
    } catch {
      // ignore
    }
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      'transaction journal を書き込めませんでした。',
    );
  }
}

export function writeTransactionJournal(options: {
  rootDir: string;
  projectName: string;
  journal: VersionTransactionJournal;
  fs?: TransactionFs;
}): void {
  const journal = assertVersionTransactionJournal(options.journal);
  const target = transactionJournalPath(
    options.rootDir,
    options.projectName,
    journal.operationId,
  );
  writeJournalDurably(target, journal, options.fs ?? defaultFs);
}

export function updateTransactionPhase(options: {
  rootDir: string;
  projectName: string;
  journal: VersionTransactionJournal;
  phase: TransactionPhase;
  fs?: TransactionFs;
}): VersionTransactionJournal {
  const next = { ...options.journal, phase: options.phase };
  writeTransactionJournal({
    rootDir: options.rootDir,
    projectName: options.projectName,
    journal: next,
    fs: options.fs,
  });
  return next;
}

export function readTransactionJournal(options: {
  rootDir: string;
  projectName: string;
  operationId: string;
  fs?: TransactionFs;
}): VersionTransactionJournal | null {
  const io = options.fs ?? defaultFs;
  const target = transactionJournalPath(
    options.rootDir,
    options.projectName,
    options.operationId,
  );
  if (!io.existsSync(target)) return null;
  assertMetadataPathBoundary(target, 'transaction journal');
  assertNotSymlink(target, 'transaction journal');
  let parsed: unknown;
  try {
    parsed = JSON.parse(io.readFileSync(target, 'utf8'));
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_TRANSACTION_INCOMPLETE',
      'transaction journal が不正です。',
    );
  }
  return assertVersionTransactionJournal(parsed);
}

export function listIncompleteTransactions(options: {
  rootDir: string;
  projectName: string;
  fs?: TransactionFs;
}): VersionTransactionJournal[] {
  const io = options.fs ?? defaultFs;
  const repo = repoRoot(options.rootDir, options.projectName);
  const dir = path.join(repo, 'transactions');
  if (!io.existsSync(dir)) return [];
  assertNotSymlink(dir, 'transactions');
  const result: VersionTransactionJournal[] = [];
  for (const name of io.readdirSync(dir) as string[]) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue;
    const operationId = name.slice(0, -'.json'.length);
    try {
      assertValidOperationId(operationId);
    } catch {
      continue;
    }
    const journal = readTransactionJournal({
      ...options,
      operationId,
      fs: io,
    });
    if (journal && journal.phase !== 'completed') {
      result.push(journal);
    }
  }
  return result;
}

/** 未完了 transaction があれば mutation を拒否する。 */
export function assertNoIncompleteTransaction(options: {
  rootDir: string;
  projectName: string;
}): void {
  const incomplete = listIncompleteTransactions(options);
  if (incomplete.length > 0) {
    throw createVersionControlError(
      'SPEC_VERSION_RECOVERY_REQUIRED',
      '未完了の transaction があるため変更操作を続行できません。',
    );
  }
}

export function removeTransactionArtifacts(options: {
  rootDir: string;
  projectName: string;
  operationId: string;
  fs?: TransactionFs;
}): void {
  const io = options.fs ?? defaultFs;
  const id = assertValidOperationId(options.operationId);
  const journal = transactionJournalPath(
    options.rootDir,
    options.projectName,
    id,
  );
  const work = transactionWorktreeRoot(
    options.rootDir,
    options.projectName,
    id,
  );
  try {
    if (io.existsSync(journal)) {
      assertNotSymlink(journal, 'transaction journal');
      io.unlinkSync(journal);
    }
  } catch {
    // best-effort
  }
  try {
    if (io.existsSync(work)) {
      assertNotSymlink(work, 'worktree');
      io.rmSync(work, { recursive: true, force: true });
    }
  } catch {
    // best-effort
  }
}

/** Windows でも使える rename（同一 volume 前提）。 */
export function renamePath(
  from: string,
  to: string,
  io: TransactionFs = defaultFs,
): void {
  try {
    io.renameSync(from, to);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EPERM' || code === 'EACCES' || code === 'EEXIST') {
      try {
        if (io.existsSync(to)) {
          io.rmSync(to, { recursive: true, force: true });
        }
        io.renameSync(from, to);
        return;
      } catch {
        // fall through
      }
    }
    throw createVersionControlError(
      'SPEC_VERSION_CHECKOUT_FAILED',
      'ソースディレクトリの置換に失敗しました。',
    );
  }
}

export function headSnapshotFromVersionHead(head: {
  commit: string | null;
  ref: string | null;
  unborn: boolean;
}): HeadSnapshot {
  if (head.unborn) {
    return {
      mode: 'unborn',
      ref: head.ref,
      commit: null,
    };
  }
  if (head.ref) {
    return { mode: 'symbolic', ref: head.ref, commit: head.commit };
  }
  return { mode: 'detached', ref: null, commit: head.commit };
}
