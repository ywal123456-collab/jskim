import { isValidScreenId } from '../util/screen-id.js';
import { createVersionControlError } from './errors.js';

export type VersionProjectDocument = {
  schemaVersion: '1.0';
  projectName: string;
  /** project 全体の画面順（Feature 所属に関係なく全 screenId をちょうど 1 回含む） */
  screenOrder: string[];
};

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function caseFoldKey(id: string): string {
  return id.normalize('NFC').toLowerCase();
}

/**
 * loadScreenSpecProject と同じ comparator（screenId localeCompare 'en'）。
 * screenId は /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/ の ASCII のみなので、
 * localeCompare('en') の順序は locale 差の影響を受けず hash 互換性を維持できる。
 * tree entry の binary ソートとは別意味（製品 screen 順）。
 */
export function compareScreenIdOrder(a: string, b: string): number {
  return a.localeCompare(b, 'en');
}

/**
 * project.json を検証する。
 * screenOrder は knownScreenIds と集合一致・重複なし・NFC/case-fold 衝突なし。
 */
export function assertVersionProjectDocument(
  value: unknown,
  options: { knownScreenIds: readonly string[]; expectedProjectName?: string },
): VersionProjectDocument {
  if (!isPlainObject(value)) {
    throw createVersionControlError(
      'SPEC_VERSION_SNAPSHOT_INVALID',
      'project.json が不正です。',
    );
  }
  for (const key of Object.keys(value)) {
    if (
      FORBIDDEN_KEYS.has(key) ||
      (key !== 'schemaVersion' &&
        key !== 'projectName' &&
        key !== 'screenOrder')
    ) {
      throw createVersionControlError(
        'SPEC_VERSION_SNAPSHOT_INVALID',
        'project.json のフィールドが不正です。',
      );
    }
  }
  if (value.schemaVersion !== '1.0') {
    throw createVersionControlError(
      'SPEC_VERSION_SNAPSHOT_INVALID',
      '未対応の project.json schemaVersion です。',
    );
  }
  if (typeof value.projectName !== 'string' || value.projectName.trim() === '') {
    throw createVersionControlError(
      'SPEC_VERSION_SNAPSHOT_INVALID',
      'projectName が不正です。',
    );
  }
  if (
    options.expectedProjectName != null &&
    value.projectName !== options.expectedProjectName
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_SNAPSHOT_INVALID',
      'projectName が一致しません。',
    );
  }
  if (!Array.isArray(value.screenOrder)) {
    throw createVersionControlError(
      'SPEC_VERSION_SNAPSHOT_INVALID',
      'screenOrder は配列である必要があります。',
    );
  }

  const known = new Set(options.knownScreenIds);
  const seen = new Set<string>();
  const seenFold = new Set<string>();
  const screenOrder: string[] = [];

  for (let i = 0; i < value.screenOrder.length; i += 1) {
    const id = value.screenOrder[i];
    if (typeof id !== 'string' || !isValidScreenId(id)) {
      throw createVersionControlError(
        'SPEC_VERSION_SNAPSHOT_INVALID',
        `screenOrder[${i}] が不正です。`,
      );
    }
    if (id.normalize('NFC') !== id) {
      throw createVersionControlError(
        'SPEC_VERSION_SNAPSHOT_INVALID',
        `screenOrder[${i}] は NFC である必要があります。`,
      );
    }
    if (seen.has(id)) {
      throw createVersionControlError(
        'SPEC_VERSION_SNAPSHOT_INVALID',
        'screenOrder に重複があります。',
      );
    }
    const folded = caseFoldKey(id);
    if (seenFold.has(folded)) {
      throw createVersionControlError(
        'SPEC_VERSION_SNAPSHOT_INVALID',
        'screenOrder が case-fold 後に衝突しています。',
      );
    }
    if (!known.has(id)) {
      throw createVersionControlError(
        'SPEC_VERSION_SNAPSHOT_INVALID',
        'screenOrder に未知の screenId があります。',
      );
    }
    seen.add(id);
    seenFold.add(folded);
    screenOrder.push(id);
  }

  for (const id of known) {
    if (!seen.has(id)) {
      throw createVersionControlError(
        'SPEC_VERSION_SNAPSHOT_INVALID',
        'screenOrder に screenId が不足しています。',
      );
    }
  }

  return {
    schemaVersion: '1.0',
    projectName: value.projectName,
    screenOrder,
  };
}

export function buildVersionProjectDocument(options: {
  projectName: string;
  screenIds: readonly string[];
}): VersionProjectDocument {
  const screenOrder = [...options.screenIds].sort(compareScreenIdOrder);
  return assertVersionProjectDocument(
    {
      schemaVersion: '1.0',
      projectName: options.projectName,
      screenOrder,
    },
    { knownScreenIds: screenOrder, expectedProjectName: options.projectName },
  );
}

/**
 * stageScreen 用: index の screenOrder に working 上の screenId 位置を semantic merge する。
 * - working に存在する: index から除去後、working の前後 anchor で再挿入
 * - working に無い（削除）: index から除去のみ
 * 選択していない screen の相対順は index 側を維持する。
 */
export function mergeScreenOrderForStage(options: {
  indexOrder: readonly string[];
  workingOrder: readonly string[];
  screenId: string;
  screenInWorking: boolean;
}): string[] {
  const index = options.indexOrder.filter((id) => id !== options.screenId);
  if (!options.screenInWorking) {
    return index;
  }

  const working = options.workingOrder;
  const pos = working.indexOf(options.screenId);
  if (pos < 0) {
    throw createVersionControlError(
      'SPEC_VERSION_SNAPSHOT_INVALID',
      'working screenOrder に対象 screen がありません。',
    );
  }

  const indexSet = new Set(index);
  let insertAt = index.length;
  for (let i = pos - 1; i >= 0; i -= 1) {
    const pred = working[i];
    if (pred && indexSet.has(pred)) {
      insertAt = index.indexOf(pred) + 1;
      break;
    }
  }
  if (insertAt === index.length) {
    for (let i = pos + 1; i < working.length; i += 1) {
      const succ = working[i];
      if (succ && indexSet.has(succ)) {
        insertAt = index.indexOf(succ);
        break;
      }
    }
  }

  const next = [...index];
  next.splice(insertAt, 0, options.screenId);
  return next;
}
