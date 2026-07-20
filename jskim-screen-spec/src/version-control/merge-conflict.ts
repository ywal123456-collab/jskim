/** merge conflict の種別（論理 path 単位）。 */
export type MergeConflictKind =
  | 'content'
  | 'projectName'
  | 'screenOrder'
  | 'features'
  | 'delete-modify'
  | 'add-add';

/** 未解決 merge conflict。 */
export type MergeConflict = {
  path: string;
  kind: MergeConflictKind;
  baseHash: string | null;
  oursHash: string | null;
  theirsHash: string | null;
};
