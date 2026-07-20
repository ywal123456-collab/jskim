import fs from 'node:fs';
import path from 'node:path';
import { canonicalizeJsonBytes } from './canonical-json.js';
import { createVersionControlError } from './errors.js';
import { assertMetadataPathBoundary, assertNotSymlink } from './fs-guards.js';
import type { MergeConflict } from './merge-conflict.js';
import { versionRepositoryPath } from './repository-paths.js';

export type VersionMergeState = {
  schemaVersion: '1.0';
  ours: string;
  theirs: string;
  base: string;
  targetRevision: string;
  currentBranch: string;
  defaultMessage: string;
  conflicts: MergeConflict[];
  resolvedPaths: string[];
  startedAt: string;
  workingTreeHash: string;
  /** conflict setup 直後の merge index tree（auto-merge + ours conflict） */
  mergeIndexTree: string;
  /** conflict setup 直後の index revision（CAS 用） */
  mergeIndexRevision: string;
};

const ISO_UTC_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_IN_PROGRESS',
      `${label} が不正です。`,
    );
  }
  return value;
}

function assertConflict(value: unknown, index: number): MergeConflict {
  if (!isPlainObject(value)) {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_IN_PROGRESS',
      `conflicts[${index}] が不正です。`,
    );
  }
  const allowed = new Set([
    'path',
    'kind',
    'baseHash',
    'oursHash',
    'theirsHash',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw createVersionControlError(
        'SPEC_VERSION_MERGE_IN_PROGRESS',
        `conflicts[${index}] に不正なフィールドがあります。`,
      );
    }
  }
  if (typeof value.path !== 'string' || value.path.includes('\0')) {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_IN_PROGRESS',
      `conflicts[${index}].path が不正です。`,
    );
  }
  const kind = value.kind;
  if (
    kind !== 'content' &&
    kind !== 'projectName' &&
    kind !== 'screenOrder' &&
    kind !== 'features' &&
    kind !== 'delete-modify' &&
    kind !== 'add-add'
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_IN_PROGRESS',
      `conflicts[${index}].kind が不正です。`,
    );
  }
  const nullableHash = (field: unknown, label: string): string | null => {
    if (field === null) return null;
    return assertHash(field, label);
  };
  return {
    path: value.path,
    kind,
    baseHash: nullableHash(value.baseHash, `conflicts[${index}].baseHash`),
    oursHash: nullableHash(value.oursHash, `conflicts[${index}].oursHash`),
    theirsHash: nullableHash(
      value.theirsHash,
      `conflicts[${index}].theirsHash`,
    ),
  };
}

export function mergeStatePath(
  rootDir: string,
  projectName: string,
): string {
  return path.join(
    versionRepositoryPath(rootDir, projectName),
    'MERGE_STATE.json',
  );
}

export function assertVersionMergeState(value: unknown): VersionMergeState {
  if (!isPlainObject(value)) {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_IN_PROGRESS',
      'MERGE_STATE が不正です。',
    );
  }
  const allowed = new Set([
    'schemaVersion',
    'ours',
    'theirs',
    'base',
    'targetRevision',
    'currentBranch',
    'defaultMessage',
    'conflicts',
    'resolvedPaths',
    'startedAt',
    'workingTreeHash',
    'mergeIndexTree',
    'mergeIndexRevision',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw createVersionControlError(
        'SPEC_VERSION_MERGE_IN_PROGRESS',
        'MERGE_STATE に不正なフィールドがあります。',
      );
    }
  }
  if (value.schemaVersion !== '1.0') {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_IN_PROGRESS',
      '未対応の MERGE_STATE schemaVersion です。',
    );
  }
  if (
    typeof value.targetRevision !== 'string' ||
    typeof value.currentBranch !== 'string' ||
    typeof value.defaultMessage !== 'string' ||
    typeof value.startedAt !== 'string' ||
    !ISO_UTC_RE.test(value.startedAt)
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_IN_PROGRESS',
      'MERGE_STATE の文字列フィールドが不正です。',
    );
  }
  if (!Array.isArray(value.conflicts) || !Array.isArray(value.resolvedPaths)) {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_IN_PROGRESS',
      'MERGE_STATE の配列フィールドが不正です。',
    );
  }
  const conflicts = value.conflicts.map((item, i) => assertConflict(item, i));
  const conflictPaths = new Set(conflicts.map((c) => c.path));
  const resolvedPaths: string[] = [];
  const seenResolved = new Set<string>();
  for (let i = 0; i < value.resolvedPaths.length; i += 1) {
    const p = value.resolvedPaths[i];
    if (typeof p !== 'string' || p.includes('\0')) {
      throw createVersionControlError(
        'SPEC_VERSION_MERGE_IN_PROGRESS',
        `resolvedPaths[${i}] が不正です。`,
      );
    }
    if (!conflictPaths.has(p)) {
      throw createVersionControlError(
        'SPEC_VERSION_MERGE_IN_PROGRESS',
        `resolvedPaths[${i}] が conflicts に含まれていません。`,
      );
    }
    if (seenResolved.has(p)) {
      throw createVersionControlError(
        'SPEC_VERSION_MERGE_IN_PROGRESS',
        `resolvedPaths[${i}] が重複しています。`,
      );
    }
    seenResolved.add(p);
    resolvedPaths.push(p);
  }
  const mergeIndexRevision = value.mergeIndexRevision;
  if (typeof mergeIndexRevision !== 'string' || mergeIndexRevision.trim() === '') {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_IN_PROGRESS',
      'mergeIndexRevision が不正です。',
    );
  }
  return {
    schemaVersion: '1.0',
    ours: assertHash(value.ours, 'ours'),
    theirs: assertHash(value.theirs, 'theirs'),
    base: assertHash(value.base, 'base'),
    targetRevision: value.targetRevision,
    currentBranch: value.currentBranch,
    defaultMessage: value.defaultMessage,
    conflicts,
    resolvedPaths,
    startedAt: value.startedAt,
    workingTreeHash: assertHash(value.workingTreeHash, 'workingTreeHash'),
    mergeIndexTree: assertHash(value.mergeIndexTree, 'mergeIndexTree'),
    mergeIndexRevision,
  };
}

function writeMergeStateDurably(target: string, state: VersionMergeState): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  assertMetadataPathBoundary(dir, 'version');
  assertMetadataPathBoundary(target, 'MERGE_STATE');
  if (fs.existsSync(dir)) {
    assertNotSymlink(dir, 'version');
  }
  const temp = path.join(
    dir,
    `.MERGE_STATE.${process.pid}.${Date.now()}.tmp`,
  );
  const bytes = Buffer.concat([
    canonicalizeJsonBytes(state),
    Buffer.from('\n'),
  ]);
  let fd: number | null = null;
  try {
    fd = fs.openSync(temp, 'wx');
    fs.writeSync(fd, bytes, 0, bytes.byteLength, 0);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temp, target);
  } catch {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // ignore
    }
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_IN_PROGRESS',
      'MERGE_STATE を書き込めませんでした。',
    );
  }
}

export function writeVersionMergeState(options: {
  rootDir: string;
  projectName: string;
  state: VersionMergeState;
}): void {
  const state = assertVersionMergeState(options.state);
  const target = mergeStatePath(options.rootDir, options.projectName);
  writeMergeStateDurably(target, state);
}

export function readVersionMergeState(options: {
  rootDir: string;
  projectName: string;
}): VersionMergeState | null {
  const target = mergeStatePath(options.rootDir, options.projectName);
  if (!fs.existsSync(target)) return null;
  assertMetadataPathBoundary(target, 'MERGE_STATE');
  assertNotSymlink(target, 'MERGE_STATE');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_MERGE_IN_PROGRESS',
      'MERGE_STATE が不正です。',
    );
  }
  return assertVersionMergeState(parsed);
}

export function removeVersionMergeState(options: {
  rootDir: string;
  projectName: string;
}): void {
  const target = mergeStatePath(options.rootDir, options.projectName);
  if (!fs.existsSync(target)) return;
  assertNotSymlink(target, 'MERGE_STATE');
  fs.unlinkSync(target);
}

export function hasVersionMergeState(options: {
  rootDir: string;
  projectName: string;
}): boolean {
  return fs.existsSync(mergeStatePath(options.rootDir, options.projectName));
}
