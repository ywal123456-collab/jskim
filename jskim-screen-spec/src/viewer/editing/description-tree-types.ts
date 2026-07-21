import type { DescriptionTreeApiDocument } from '../../editing/description-document/format-description-tree-response.js';

export type DescriptionTreeNodeRef = {
  type: 'group' | 'item';
  id: string;
};

export type SelectedTreeNode = DescriptionTreeNodeRef;

export type DescriptionTreeApiError = {
  code: string;
  message: string;
};

export type DescriptionTreeGetResponse = {
  revision: string;
  sourceSchemaVersion: string;
  /** snapshot 由来の collected item ID（UI 表示用。delete/exclude 判定は server-side） */
  collectedItemIds?: string[];
  description: DescriptionTreeApiDocument;
};

export type DescriptionTreeGroupRow = {
  groupId: string;
  name: string;
  kind: string;
  description?: string;
  children: DescriptionTreeNodeRef[];
};

export const DESCRIPTION_TREE_API_PREFIX = '/_jskim/spec/description-tree';

export function getDescriptionTreeApiBase(): string {
  return DESCRIPTION_TREE_API_PREFIX.replace(/\/$/, '');
}

export function formatRevisionPreview(revision: string): string {
  if (revision.length <= 16) {
    return revision;
  }
  return `${revision.slice(0, 16)}…`;
}
