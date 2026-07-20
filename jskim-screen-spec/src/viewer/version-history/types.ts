/**
 * 改訂履歴 Viewer 用型（browser-safe）。
 */

export type SpecVersionBootstrap = {
  available: true;
  mode: 'local-read-only';
  apiBase: string;
  featuresApiBase: string;
};

declare global {
  interface Window {
    __JSKIM_SPEC_VERSION__?: SpecVersionBootstrap;
  }
}

export type BrowserVersionStatus =
  | {
      initialized: false;
      capability: 'local-read-only';
    }
  | {
      initialized: true;
      capability: 'local-read-only';
      head: {
        mode: 'symbolic' | 'detached';
        branch?: string;
        commit?: string;
        shortHash?: string;
        unborn: boolean;
      };
      workingTree: {
        clean: boolean;
        stagedCount: number;
        unstagedCount: number;
      };
      recovery: {
        required: boolean;
        operation?: string;
        phase?: string;
      };
    };

export type BrowserRevisionSummary = {
  changedFeatureCount: number;
  changedScreenCount: number;
  changedItemCount: number;
  changedReferenceCount: number;
  changedCaptureCount: number;
};

export type BrowserRevisionListItem = {
  hash: string;
  shortHash: string;
  parents: string[];
  message: string;
  author: { name: string };
  committedAt: string;
  tags: string[];
  summary: BrowserRevisionSummary;
};

export type BrowserFeatureChange = {
  featureId: string;
  kind: 'added' | 'modified' | 'deleted';
  membershipChanged: boolean;
  orderChanged: boolean;
  name?: string;
};

export type BrowserScreenChange = {
  screenId: string;
  kind: 'added' | 'modified' | 'deleted';
  sections: string[];
};

export type BrowserItemChange = {
  itemId: string;
  kind: 'added' | 'modified' | 'deleted';
  changedFields?: string[];
  label?: string;
};

export type BrowserAssetChange = {
  screenId: string;
  viewport?: string;
  stateId?: string;
  kind: 'added' | 'modified' | 'deleted';
  assetType: 'reference' | 'capture';
};

export type BrowserRevisionDetail = {
  hash: string;
  shortHash: string;
  parents: string[];
  message: string;
  author: { name: string };
  committedAt: string;
  tags: string[];
  isMerge: boolean;
  summary: BrowserRevisionSummary;
  featureChanges: BrowserFeatureChange[];
  screenChanges: BrowserScreenChange[];
  itemChanges: BrowserItemChange[];
  assetChanges: BrowserAssetChange[];
  truncated: boolean;
};

export type BrowserFeatureList = {
  features: Array<{
    featureId: string;
    name: string;
    displayOrder: number;
    screenIds: string[];
  }>;
  ungroupedScreenIds: string[];
};

export type ListRevisionsResponse = {
  historyHead: string | null;
  revisions: BrowserRevisionListItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type VersionHistoryApiError = {
  code: string;
  message: string;
};

export type RevisionScope = 'project' | 'feature' | 'screen';

export function getSpecVersionBootstrap(): SpecVersionBootstrap | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const boot = window.__JSKIM_SPEC_VERSION__;
  if (
    !boot ||
    boot.available !== true ||
    boot.mode !== 'local-read-only' ||
    typeof boot.apiBase !== 'string' ||
    typeof boot.featuresApiBase !== 'string'
  ) {
    return null;
  }
  return boot;
}
