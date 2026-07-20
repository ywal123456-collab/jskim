import type { ScreenFeature } from './types.js';

/** Viewer manifest / mutation API 向け browser-safe Feature 行 */
export type BrowserSafeFeature = {
  featureId: string;
  name: string;
  displayOrder: number;
  screenIds: string[];
};

/** spec dev mutation API 向け working state（revision は static manifest には含めない） */
export type BrowserSafeFeatureState = {
  revision: string | null;
  sourceExists: boolean;
  features: BrowserSafeFeature[];
  ungroupedScreenIds: string[];
};

/** static manifest 向け（revision / sourceExists なし） */
export type BrowserSafeFeatureManifest = {
  features: BrowserSafeFeature[];
  ungroupedScreenIds: string[];
};

export function projectBrowserSafeFeature(
  feature: ScreenFeature,
): BrowserSafeFeature {
  return {
    featureId: feature.featureId,
    name: feature.name,
    displayOrder: feature.displayOrder,
    screenIds: [...feature.screenIds],
  };
}

export function projectBrowserSafeFeatures(
  features: readonly ScreenFeature[],
): BrowserSafeFeature[] {
  return features.map(projectBrowserSafeFeature);
}

export function projectBrowserSafeFeatureState(input: {
  revision: string | null;
  sourceExists: boolean;
  features: readonly ScreenFeature[];
  ungroupedScreenIds: readonly string[];
}): BrowserSafeFeatureState {
  return {
    revision: input.revision,
    sourceExists: input.sourceExists,
    features: projectBrowserSafeFeatures(input.features),
    ungroupedScreenIds: [...input.ungroupedScreenIds],
  };
}

export function projectBrowserSafeFeatureManifest(input: {
  features: readonly ScreenFeature[];
  ungroupedScreenIds: readonly string[];
}): BrowserSafeFeatureManifest {
  return {
    features: projectBrowserSafeFeatures(input.features),
    ungroupedScreenIds: [...input.ungroupedScreenIds],
  };
}
