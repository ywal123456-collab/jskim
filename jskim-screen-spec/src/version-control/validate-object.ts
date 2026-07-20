import { WINDOWS_RESERVED_NAMES } from '../util/screen-id.js';
import {
  COMMIT_FORMAT_VERSION,
  MAX_COMMIT_MESSAGE_LENGTH,
  MAX_IDENTITY_NAME_LENGTH,
  MAX_TAG_NAME_LENGTH,
  MAX_TREE_ENTRIES,
  SHA256_HEX_RE,
  TAG_FORMAT_VERSION,
  TREE_FORMAT_VERSION,
} from './constants.js';
import { createVersionControlError } from './errors.js';
import type {
  CommitObject,
  TagObject,
  TreeEntry,
  TreeObject,
  VersionPerson,
} from './types.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const TAG_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

function assertAllowedKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) {
      throw createVersionControlError(
        'SPEC_VERSION_INVALID_OBJECT',
        `${label} のフィールドが不正です。`,
      );
    }
  }
}

function assertHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_HEX_RE.test(value)) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      `${label} が不正な hash です。`,
    );
  }
  return value;
}

function assertPerson(value: unknown, label: string): VersionPerson {
  if (!isPlainObject(value)) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      `${label} が不正です。`,
    );
  }
  assertAllowedKeys(value, new Set(['name', 'email']), label);
  if (
    typeof value.name !== 'string' ||
    value.name.trim() === '' ||
    value.name.length > MAX_IDENTITY_NAME_LENGTH ||
    value.name.includes('\0')
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      `${label}.name が不正です。`,
    );
  }
  if (
    typeof value.email !== 'string' ||
    value.email.length > MAX_IDENTITY_NAME_LENGTH ||
    value.email.includes('\0') ||
    (value.email !== '' && !EMAIL_RE.test(value.email))
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      `${label}.email が不正です。`,
    );
  }
  return { name: value.name, email: value.email };
}

function assertUtcIso(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ISO_UTC_RE.test(value)) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      `${label} は UTC ISO-8601 である必要があります。`,
    );
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      `${label} が不正な日時です。`,
    );
  }
  // 正規形: ミリ秒 3 桁付き Z
  const canonical = new Date(ms).toISOString();
  if (value !== canonical && value !== canonical.replace('.000Z', 'Z')) {
    // 秒精度 Z も許容しつつ、内部では入力文字列を保持（hash 安定のため呼び出し側が canonical を渡す）
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
      throw createVersionControlError(
        'SPEC_VERSION_INVALID_OBJECT',
        `${label} の形式が不正です。`,
      );
    }
  }
  return value;
}

function assertMessage(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > MAX_COMMIT_MESSAGE_LENGTH ||
    value.includes('\0')
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      `${label} が不正です。`,
    );
  }
  return value;
}

/**
 * tree entry name の安全性。
 * - NFC 済みであること（非 NFC は拒否。既存 NFC tree の hash を維持）
 * - case-fold は NFC 後の String#toLowerCase()（Unicode 簡易。full case fold ではない）
 */
function isSafeTreeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > 255) return false;
  if (name === '.' || name === '..') return false;
  if (
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.includes(':')
  ) {
    return false;
  }
  if (name.endsWith(' ') || name.endsWith('.')) return false;
  if (name.normalize('NFC') !== name) return false;
  const base = name.split('.')[0]?.toLowerCase() || '';
  if (WINDOWS_RESERVED_NAMES.has(base)) return false;
  return true;
}

function caseFoldKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

export function assertTreeObject(value: unknown): TreeObject {
  if (!isPlainObject(value)) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      'tree オブジェクトが不正です。',
    );
  }
  assertAllowedKeys(value, new Set(['formatVersion', 'entries']), 'tree');
  if (value.formatVersion !== TREE_FORMAT_VERSION) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      '未対応の tree formatVersion です。',
    );
  }
  if (!Array.isArray(value.entries)) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      'tree.entries は配列である必要があります。',
    );
  }
  if (value.entries.length > MAX_TREE_ENTRIES) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      'tree.entries が多すぎます。',
    );
  }

  const entries: TreeEntry[] = [];
  const seenNames = new Set<string>();
  const seenCaseFold = new Set<string>();
  for (let i = 0; i < value.entries.length; i += 1) {
    const raw = value.entries[i];
    if (!isPlainObject(raw)) {
      throw createVersionControlError(
        'SPEC_VERSION_INVALID_OBJECT',
        `tree.entries[${i}] が不正です。`,
      );
    }
    assertAllowedKeys(
      raw,
      new Set(['name', 'objectType', 'hash']),
      `tree.entries[${i}]`,
    );
    if (typeof raw.name !== 'string' || !isSafeTreeEntryName(raw.name)) {
      throw createVersionControlError(
        'SPEC_VERSION_INVALID_OBJECT',
        `tree.entries[${i}].name が不正です。`,
      );
    }
    if (seenNames.has(raw.name)) {
      throw createVersionControlError(
        'SPEC_VERSION_INVALID_OBJECT',
        `tree.entries の name が重複しています。`,
      );
    }
    seenNames.add(raw.name);
    const folded = caseFoldKey(raw.name);
    if (seenCaseFold.has(folded)) {
      throw createVersionControlError(
        'SPEC_VERSION_INVALID_OBJECT',
        `tree.entries の name が case-fold 後に衝突しています。`,
      );
    }
    seenCaseFold.add(folded);
    if (raw.objectType !== 'blob' && raw.objectType !== 'tree') {
      throw createVersionControlError(
        'SPEC_VERSION_INVALID_OBJECT',
        `tree.entries[${i}].objectType が不正です。`,
      );
    }
    entries.push({
      name: raw.name,
      objectType: raw.objectType,
      hash: assertHash(raw.hash, `tree.entries[${i}].hash`),
    });
  }

  entries.sort((a, b) => {
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });

  return { formatVersion: '1.0', entries };
}

export function assertCommitObject(value: unknown): CommitObject {
  if (!isPlainObject(value)) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      'commit オブジェクトが不正です。',
    );
  }
  assertAllowedKeys(
    value,
    new Set([
      'formatVersion',
      'tree',
      'parents',
      'author',
      'committer',
      'committedAt',
      'message',
    ]),
    'commit',
  );
  if (value.formatVersion !== COMMIT_FORMAT_VERSION) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      '未対応の commit formatVersion です。',
    );
  }
  if (!Array.isArray(value.parents)) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      'commit.parents は配列である必要があります。',
    );
  }
  const parents: string[] = [];
  const seenParents = new Set<string>();
  for (let i = 0; i < value.parents.length; i += 1) {
    const p = assertHash(value.parents[i], `commit.parents[${i}]`);
    if (seenParents.has(p)) {
      throw createVersionControlError(
        'SPEC_VERSION_INVALID_OBJECT',
        'commit.parents に重複があります。',
      );
    }
    seenParents.add(p);
    parents.push(p);
  }

  return {
    formatVersion: '1.0',
    tree: assertHash(value.tree, 'commit.tree'),
    parents,
    author: assertPerson(value.author, 'commit.author'),
    committer: assertPerson(value.committer, 'commit.committer'),
    committedAt: assertUtcIso(value.committedAt, 'commit.committedAt'),
    message: assertMessage(value.message, 'commit.message'),
  };
}

export function assertTagObject(value: unknown): TagObject {
  if (!isPlainObject(value)) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      'tag オブジェクトが不正です。',
    );
  }
  assertAllowedKeys(
    value,
    new Set([
      'formatVersion',
      'object',
      'objectType',
      'name',
      'tagger',
      'taggedAt',
      'message',
    ]),
    'tag',
  );
  if (value.formatVersion !== TAG_FORMAT_VERSION) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      '未対応の tag formatVersion です。',
    );
  }
  if (value.objectType !== 'commit') {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      'tag.objectType は commit のみ対応しています。',
    );
  }
  if (
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    value.name.length > MAX_TAG_NAME_LENGTH ||
    !TAG_NAME_RE.test(value.name) ||
    value.name.includes('..') ||
    value.name.endsWith('/') ||
    value.name.endsWith('.')
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      'tag.name が不正です。',
    );
  }

  return {
    formatVersion: '1.0',
    object: assertHash(value.object, 'tag.object'),
    objectType: 'commit',
    name: value.name,
    tagger: assertPerson(value.tagger, 'tag.tagger'),
    taggedAt: assertUtcIso(value.taggedAt, 'tag.taggedAt'),
    message: assertMessage(value.message, 'tag.message'),
  };
}

/** canonical 書き込み用に entries を name 昇順へ並べた tree を返す */
export function normalizeTreeObject(tree: TreeObject): TreeObject {
  const validated = assertTreeObject(tree);
  return {
    formatVersion: '1.0',
    entries: [...validated.entries].sort((a, b) => {
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      return 0;
    }),
  };
}
