export type SpecFeatureBootstrap = {
  enabled: boolean;
  mode: 'local-mutation';
  apiBase: string;
};

export type ApiFeature = {
  featureId: string;
  name: string;
  description?: string;
  displayOrder: number;
  screenIds: string[];
};

export type FeatureWorkingResponse = {
  revision: string | null;
  sourceExists: boolean;
  features: ApiFeature[];
  ungroupedScreenIds: string[];
};

export type FeatureMutationResponse = FeatureWorkingResponse & {
  status: 'created' | 'updated' | 'deleted' | 'unchanged';
  movedScreenIds?: string[];
};

export type FeatureApiError = {
  code: string;
  message: string;
  expectedRevision?: string | null;
  currentRevision?: string | null;
};

declare global {
  interface Window {
    __JSKIM_SPEC_FEATURE__?: SpecFeatureBootstrap;
  }
}

export function getSpecFeatureBootstrap(): SpecFeatureBootstrap | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const boot = window.__JSKIM_SPEC_FEATURE__;
  if (!boot || !boot.enabled || typeof boot.apiBase !== 'string') {
    return null;
  }
  return boot;
}

export function featureEditingEnabled(): boolean {
  return getSpecFeatureBootstrap() !== null;
}
