import { canonicalizeJsonBytes } from './canonical-json.js';
import { createVersionControlError } from './errors.js';
import {
  assertVersionProjectDocument,
  compareScreenIdOrder,
  type VersionProjectDocument,
} from './project-document.js';

export type MergeProjectResult =
  | { ok: true; document: VersionProjectDocument; bytes: Buffer }
  | { ok: false; reason: 'projectName' | 'screenOrder' };

function parseProject(bytes: Buffer | null): VersionProjectDocument | null {
  if (!bytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_SNAPSHOT_INVALID',
      'project.json が不正です。',
    );
  }
  return parsed as VersionProjectDocument;
}

function unionScreenIds(
  ...orders: Array<readonly string[] | undefined>
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const order of orders) {
    if (!order) continue;
    for (const id of order) {
      if (!seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    }
  }
  return result.sort(compareScreenIdOrder);
}

/**
 * 3-way screenOrder merge。
 * base から片側のみが移動した screen は anchor 規則で挿入する。
 * 両側が同じ screen の位置を異なる方法で変更した場合は conflict。
 */
function mergeScreenOrder3Way(options: {
  base: readonly string[];
  ours: readonly string[];
  theirs: readonly string[];
  allScreenIds: readonly string[];
}): string[] | 'conflict' {
  const all = new Set(options.allScreenIds);
  const filterKnown = (order: readonly string[]): string[] =>
    order.filter((id) => all.has(id));

  const base = filterKnown(options.base);
  const ours = filterKnown(options.ours);
  const theirs = filterKnown(options.theirs);

  if (
    ours.length === theirs.length &&
    ours.every((id, i) => id === theirs[i])
  ) {
    return assertOrderComplete(theirs, options.allScreenIds);
  }
  if (
    base.length === ours.length &&
    base.every((id, i) => id === ours[i])
  ) {
    return assertOrderComplete(theirs, options.allScreenIds);
  }
  if (
    base.length === theirs.length &&
    base.every((id, i) => id === theirs[i])
  ) {
    return assertOrderComplete(ours, options.allScreenIds);
  }

  const baseIndex = new Map(base.map((id, i) => [id, i]));
  const oursIndex = new Map(ours.map((id, i) => [id, i]));
  const theirsIndex = new Map(theirs.map((id, i) => [id, i]));

  const movedOurs = new Set<string>();
  const movedTheirs = new Set<string>();
  for (const id of all) {
    const bi = baseIndex.get(id);
    const oi = oursIndex.get(id);
    const ti = theirsIndex.get(id);
    if (bi === undefined && oi === undefined && ti === undefined) continue;
    if (bi !== undefined && oi !== undefined && bi !== oi) movedOurs.add(id);
    if (bi !== undefined && ti !== undefined && bi !== ti) movedTheirs.add(id);
    if (bi === undefined && oi !== undefined && ti !== undefined && oi !== ti) {
      movedOurs.add(id);
      movedTheirs.add(id);
    }
  }

  for (const id of movedOurs) {
    if (movedTheirs.has(id)) {
      const oi = oursIndex.get(id);
      const ti = theirsIndex.get(id);
      if (oi !== ti) {
        return 'conflict';
      }
    }
  }

  let result = [...base];
  const resultSet = new Set(result);

  for (const id of unionScreenIds(ours, theirs)) {
    if (!resultSet.has(id)) {
      result.push(id);
      resultSet.add(id);
    }
  }

  const applyMoves = (
    order: readonly string[],
    moved: Set<string>,
  ): string[] | 'conflict' => {
    let working = result.filter((id) => !moved.has(id));
    for (const screenId of order) {
      if (!moved.has(screenId)) continue;
      working = working.filter((id) => id !== screenId);
      const pos = order.indexOf(screenId);
      const workingSet = new Set(working);
      let insertAt = working.length;
      for (let i = pos - 1; i >= 0; i -= 1) {
        const pred = order[i];
        if (pred && workingSet.has(pred)) {
          insertAt = working.indexOf(pred) + 1;
          break;
        }
      }
      if (insertAt === working.length) {
        for (let i = pos + 1; i < order.length; i += 1) {
          const succ = order[i];
          if (succ && workingSet.has(succ)) {
            insertAt = working.indexOf(succ);
            break;
          }
        }
      }
      working.splice(insertAt, 0, screenId);
    }
    return working;
  };

  if (movedOurs.size > 0) {
    const next = applyMoves(ours, movedOurs);
    if (next === 'conflict') return 'conflict';
    result = next;
  }
  if (movedTheirs.size > 0) {
    const movedTheirsOnly = new Set(
      [...movedTheirs].filter((id) => !movedOurs.has(id)),
    );
    if (movedTheirsOnly.size > 0) {
      const next = applyMoves(theirs, movedTheirsOnly);
      if (next === 'conflict') return 'conflict';
      result = next;
    }
  }

  return assertOrderComplete(result, options.allScreenIds);
}

function assertOrderComplete(
  order: readonly string[],
  allScreenIds: readonly string[],
): string[] | 'conflict' {
  const seen = new Set<string>();
  for (const id of order) {
    if (seen.has(id)) return 'conflict';
    seen.add(id);
  }
  if (seen.size !== allScreenIds.length) return 'conflict';
  for (const id of allScreenIds) {
    if (!seen.has(id)) return 'conflict';
  }
  return [...order];
}

function mergeField<T>(base: T, ours: T, theirs: T): T | 'conflict' {
  if (ours === theirs) return ours;
  if (ours === base) return theirs;
  if (theirs === base) return ours;
  return 'conflict';
}

/**
 * project.json の domain-aware 3-way merge。
 */
export function mergeProjectDocument(options: {
  projectName: string;
  knownScreenIds: readonly string[];
  base: Buffer | null;
  ours: Buffer | null;
  theirs: Buffer | null;
}): MergeProjectResult {
  const baseDoc = parseProject(options.base);
  const oursDoc = parseProject(options.ours);
  const theirsDoc = parseProject(options.theirs);

  const baseName = baseDoc?.projectName ?? options.projectName;
  const oursName = oursDoc?.projectName ?? baseName;
  const theirsName = theirsDoc?.projectName ?? baseName;

  const mergedName = mergeField(baseName, oursName, theirsName);
  if (mergedName === 'conflict') {
    return { ok: false, reason: 'projectName' };
  }

  const baseOrder = baseDoc?.screenOrder ?? [];
  const oursOrder = oursDoc?.screenOrder ?? baseOrder;
  const theirsOrder = theirsDoc?.screenOrder ?? baseOrder;

  const mergedOrder = mergeScreenOrder3Way({
    base: baseOrder,
    ours: oursOrder,
    theirs: theirsOrder,
    allScreenIds: options.knownScreenIds,
  });
  if (mergedOrder === 'conflict') {
    return { ok: false, reason: 'screenOrder' };
  }

  try {
    const document = assertVersionProjectDocument(
      {
        schemaVersion: '1.0',
        projectName: mergedName,
        screenOrder: mergedOrder,
      },
      {
        knownScreenIds: options.knownScreenIds,
        expectedProjectName: options.projectName,
      },
    );
    return {
      ok: true,
      document,
      bytes: canonicalizeJsonBytes(document),
    };
  } catch {
    return { ok: false, reason: 'screenOrder' };
  }
}

/** flat logical paths から screenId 集合を抽出する。 */
export function collectScreenIdsFromPaths(paths: Iterable<string>): string[] {
  const ids = new Set<string>();
  for (const p of paths) {
    const m = /^screens\/([^/]+)\//.exec(p);
    if (m?.[1]) ids.add(m[1]);
  }
  return [...ids].sort(compareScreenIdOrder);
}
