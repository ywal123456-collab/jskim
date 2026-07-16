export type ScreenSpecStatus = 'design-only' | 'implementation-only' | 'linked';

export type ManifestScreen = {
  id: string;
  name: string;
  path: string;
  dataFile: string;
  status: ScreenSpecStatus;
  hasDescription: boolean;
  hasImplementation: boolean;
  hasPreview: boolean;
};

export type ViewerManifest = {
  schemaVersion: string;
  projectName: string;
  base: string;
  screens: ManifestScreen[];
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
};

/** status ごとの日本語表示ラベル（badge 用） */
export const SCREEN_SPEC_STATUS_LABEL: Record<ScreenSpecStatus, string> = {
  'design-only': '設計のみ',
  'implementation-only': '実装のみ',
  linked: '連携済み',
};
