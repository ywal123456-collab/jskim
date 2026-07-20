import { validateScreenFeatureFile } from '../features/validate-features.js';
import type { ScreenFeature, ScreenFeatureFile } from '../features/types.js';
import { canonicalizeJsonBytes } from './canonical-json.js';
import { createVersionControlError } from './errors.js';

export type MergeFeaturesResult =
  | { ok: true; document: ScreenFeatureFile; bytes: Buffer }
  | { ok: false; reason: 'features' };

function parseFeatures(bytes: Buffer | null): ScreenFeatureFile | null {
  if (!bytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_SNAPSHOT_INVALID',
      'features.json が不正です。',
    );
  }
  return parsed as ScreenFeatureFile;
}

function featureMap(
  doc: ScreenFeatureFile | null,
): Map<string, ScreenFeature> {
  const map = new Map<string, ScreenFeature>();
  if (!doc) return map;
  for (const f of doc.features) {
    map.set(f.featureId, f);
  }
  return map;
}

function screenOwner(
  doc: ScreenFeatureFile | null,
): Map<string, string | null> {
  const owners = new Map<string, string | null>();
  if (!doc) return owners;
  for (const feature of doc.features) {
    for (const screenId of feature.screenIds) {
      owners.set(screenId, feature.featureId);
    }
  }
  return owners;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function mergeScalarField<T>(
  base: T,
  ours: T,
  theirs: T,
): T | 'conflict' {
  if (ours === theirs) return ours;
  if (ours === base) return theirs;
  if (theirs === base) return ours;
  return 'conflict';
}

function mergeScreenIds3Way(
  base: readonly string[],
  ours: readonly string[],
  theirs: readonly string[],
): string[] | 'conflict' {
  if (arraysEqual(ours, theirs)) return [...ours];
  if (arraysEqual(base, ours)) return [...theirs];
  if (arraysEqual(base, theirs)) return [...ours];
  return 'conflict';
}

/**
 * features.json の domain-aware 3-way merge（§16.3 / §4）。
 * 二重所属・競合する移動・削除と変更の組み合わせは conflict。
 */
export function mergeFeaturesDocument(options: {
  knownScreenIds: readonly string[];
  base: Buffer | null;
  ours: Buffer | null;
  theirs: Buffer | null;
}): MergeFeaturesResult {
  const baseRaw = parseFeatures(options.base);
  const oursRaw = parseFeatures(options.ours);
  const theirsRaw = parseFeatures(options.theirs);

  let baseDoc: ScreenFeatureFile;
  let oursDoc: ScreenFeatureFile;
  let theirsDoc: ScreenFeatureFile;
  try {
    baseDoc = baseRaw
      ? validateScreenFeatureFile(baseRaw, {
          knownScreenIds: options.knownScreenIds,
        })
      : { schemaVersion: '1.0', features: [] };
    oursDoc = oursRaw
      ? validateScreenFeatureFile(oursRaw, {
          knownScreenIds: options.knownScreenIds,
        })
      : baseDoc;
    theirsDoc = theirsRaw
      ? validateScreenFeatureFile(theirsRaw, {
          knownScreenIds: options.knownScreenIds,
        })
      : baseDoc;
  } catch {
    return { ok: false, reason: 'features' };
  }

  const baseMap = featureMap(baseDoc);
  const oursMap = featureMap(oursDoc);
  const theirsMap = featureMap(theirsDoc);

  const allFeatureIds = new Set([
    ...baseMap.keys(),
    ...oursMap.keys(),
    ...theirsMap.keys(),
  ]);

  const mergedFeatures: ScreenFeature[] = [];

  for (const featureId of [...allFeatureIds].sort()) {
    const baseF = baseMap.get(featureId);
    const oursF = oursMap.get(featureId);
    const theirsF = theirsMap.get(featureId);

    if (!oursF && !theirsF) {
      continue;
    }
    if (!oursF && theirsF) {
      if (baseF && !arraysEqual(baseF.screenIds, theirsF.screenIds)) {
        return { ok: false, reason: 'features' };
      }
      mergedFeatures.push(theirsF);
      continue;
    }
    if (oursF && !theirsF) {
      if (baseF && !arraysEqual(baseF.screenIds, oursF.screenIds)) {
        return { ok: false, reason: 'features' };
      }
      mergedFeatures.push(oursF);
      continue;
    }
    if (!oursF || !theirsF) {
      return { ok: false, reason: 'features' };
    }

    const baseName = baseF?.name ?? oursF.name;
    const mergedName = mergeScalarField(baseName, oursF.name, theirsF.name);
    if (mergedName === 'conflict') return { ok: false, reason: 'features' };

    const baseDesc = baseF?.description;
    const oursDesc = oursF.description;
    const theirsDesc = theirsF.description;
    let mergedDescription: string | undefined;
    if (oursDesc === theirsDesc) {
      mergedDescription = oursDesc;
    } else if (oursDesc === baseDesc) {
      mergedDescription = theirsDesc;
    } else if (theirsDesc === baseDesc) {
      mergedDescription = oursDesc;
    } else if (oursDesc !== undefined || theirsDesc !== undefined) {
      return { ok: false, reason: 'features' };
    }

    const baseOrder = baseF?.displayOrder ?? oursF.displayOrder;
    const mergedOrder = mergeScalarField(
      baseOrder,
      oursF.displayOrder,
      theirsF.displayOrder,
    );
    if (mergedOrder === 'conflict') return { ok: false, reason: 'features' };

    const baseScreenIds = baseF?.screenIds ?? [];
    const mergedScreenIds = mergeScreenIds3Way(
      baseScreenIds,
      oursF.screenIds,
      theirsF.screenIds,
    );
    if (mergedScreenIds === 'conflict') {
      return { ok: false, reason: 'features' };
    }

    const merged: ScreenFeature = {
      featureId,
      name: mergedName,
      displayOrder: mergedOrder,
      screenIds: mergedScreenIds,
    };
    if (mergedDescription !== undefined) {
      merged.description = mergedDescription;
    }
    mergedFeatures.push(merged);
  }

  const baseOwners = screenOwner(baseDoc);
  const oursOwners = screenOwner(oursDoc);
  const theirsOwners = screenOwner(theirsDoc);

  for (const screenId of options.knownScreenIds) {
    const b = baseOwners.get(screenId) ?? null;
    const o = oursOwners.get(screenId) ?? null;
    const t = theirsOwners.get(screenId) ?? null;

    if (o === t) continue;
    if (o === b && t !== b) continue;
    if (t === b && o !== b) continue;
    if (o !== t) {
      return { ok: false, reason: 'features' };
    }
  }

  const mergedDoc: ScreenFeatureFile = {
    schemaVersion: '1.0',
    features: mergedFeatures,
  };

  try {
    const validated = validateScreenFeatureFile(mergedDoc, {
      knownScreenIds: options.knownScreenIds,
    });
    return {
      ok: true,
      document: validated,
      bytes: canonicalizeJsonBytes(validated),
    };
  } catch {
    return { ok: false, reason: 'features' };
  }
}
