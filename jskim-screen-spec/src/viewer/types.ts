export type ScreenSpecStatus = 'design-only' | 'implementation-only' | 'linked';

/** Viewer 公開用 source（fileKey/nodeId なし） */
export type BrowserSafeReferenceSource =
  | { type: 'upload' }
  | { type: 'figma'; frameName: string; importedAt: string }
  | { type: 'unknown' };

export type ReferenceImageManifestEntry =
  | { status: 'missing' }
  | { status: 'invalid'; diagnosticCode?: string }
  | {
      status: 'current';
      imagePath: string;
      imageRevision: string;
      imageWidth: number;
      imageHeight: number;
      viewportWidth: number;
      viewportHeight: number;
      uploadedAt: string;
      /** 旧 manifest 互換のため optional */
      source?: BrowserSafeReferenceSource;
    };

export type ManifestFeature = {
  featureId: string;
  name: string;
  displayOrder: number;
  screenIds: string[];
};

export type ManifestScreen = {
  id: string;
  name: string;
  path: string;
  dataFile: string;
  status: ScreenSpecStatus;
  hasDescription: boolean;
  hasImplementation: boolean;
  hasPreview: boolean;
  hasReferenceImage?: boolean;
  hasAnyPreview?: boolean;
};

export type ViewerManifest = {
  schemaVersion: string;
  projectName: string;
  base: string;
  screens: ManifestScreen[];
  features?: ManifestFeature[];
  ungroupedScreenIds?: string[];
};

export type ScreenItem = {
  name: string;
  type: string;
  description: string;
  note: string;
};

export type ScreenInteraction = {
  itemId: string;
  type: string;
  category?: string;
  targetStateId?: string;
  targetScreenId?: string;
  url?: string;
  label?: string;
  unregisteredTarget?: boolean;
};

export type ScreenStateStyle = {
  kind: 'link' | 'style';
  href: string;
  media: string;
  disabled?: boolean;
};

export type DocumentContextNode = {
  class: string[];
  attributes: Record<string, string>;
};

export type DocumentContext = {
  html: DocumentContextNode;
  body: DocumentContextNode;
};

export type DeviceCaptureManifestEntry =
  | { status: 'missing' }
  | { status: 'invalid'; diagnosticCode?: string }
  | {
      status: 'current' | 'stale';
      imagePath: string;
      inputRevision: string;
      imageRevision: string;
      capturedAt: string;
      viewportWidth: number;
      viewportHeight: number;
      imageWidth: number;
      imageHeight: number;
    };

export type ScreenState = {
  id: string;
  name: string;
  viewer: {
    visible: boolean;
    order: number;
  };
  snapshotFile: string;
  styles?: ScreenStateStyle[];
  documentContext?: DocumentContext;
  /** Device Capture（PC/SP）。runtime 状態は含まない */
  deviceCaptures?: {
    pc: DeviceCaptureManifestEntry;
    sp: DeviceCaptureManifestEntry;
  };
};

export type ScreenData = {
  id: string;
  name: string;
  description: string;
  path: string;
  itemOrder: string[];
  items: Record<string, ScreenItem>;
  states: ScreenState[];
  interactions: ScreenInteraction[];
  status: ScreenSpecStatus;
  hasDescription: boolean;
  hasImplementation: boolean;
  hasPreview: boolean;
  hasReferenceImage?: boolean;
  hasAnyPreview?: boolean;
  /** screen 単位の Reference Image（PC/SP）。runtime は含めない */
  referenceImages?: {
    pc: ReferenceImageManifestEntry;
    sp: ReferenceImageManifestEntry;
  };
};

/** status ごとの日本語表示ラベル（badge 用） */
export const SCREEN_SPEC_STATUS_LABEL: Record<ScreenSpecStatus, string> = {
  'design-only': '設計のみ',
  'implementation-only': '実装のみ',
  linked: '連携済み',
};
