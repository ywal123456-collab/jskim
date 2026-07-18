export type SpecEditBootstrap = {
  enabled: boolean;
  apiBase: string;
};

export type EditableItem = {
  id: string;
  name: string;
  type: string;
  description: string;
  note: string;
};

export type EditableDocument = {
  schemaVersion: string;
  screen: {
    id: string;
    name: string;
    description: string;
  };
  itemOrder: string[];
  items: Record<
    string,
    {
      name: string;
      type: string;
      description: string;
      note: string;
    }
  >;
};

export type DescriptionApiGetResponse = {
  screenId: string;
  revision: string;
  exists: boolean;
  document: EditableDocument;
  /** 最新 snapshot 由来の collected item ID（削除可否判定用） */
  collectedItemIds?: string[];
};

export type DescriptionApiPutResponse = {
  screenId: string;
  revision: string;
  saved: boolean;
  written?: boolean;
};

export type DescriptionApiError = {
  code: string;
  message: string;
  expectedRevision?: string;
  currentRevision?: string;
};

declare global {
  interface Window {
    __JSKIM_SPEC_EDIT__?: SpecEditBootstrap;
  }
}

export function getSpecEditBootstrap(): SpecEditBootstrap | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const boot = window.__JSKIM_SPEC_EDIT__;
  if (!boot || !boot.enabled || typeof boot.apiBase !== 'string') {
    return null;
  }
  return boot;
}

export function cloneEditableDocument(
  document: EditableDocument,
): EditableDocument {
  return JSON.parse(JSON.stringify(document)) as EditableDocument;
}

export function documentsEqual(
  a: EditableDocument | null,
  b: EditableDocument | null,
): boolean {
  if (!a || !b) {
    return a === b;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}
