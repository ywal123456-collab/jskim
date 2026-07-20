import type { VersionObjectType } from './constants.js';

export type RepositoryFormatDocument = {
  repositoryFormatVersion: '1.0';
  hashAlgorithm: 'sha256';
};

export type InitVersionRepositoryOptions = {
  rootDir: string;
  projectName: string;
};

export type InitVersionRepositoryResult = {
  status: 'created' | 'existing';
  /** project-relative POSIX path（絶対 path ではない） */
  repositoryRelativePath: string;
  headRef: 'refs/heads/main';
};

export type VersionPerson = {
  name: string;
  email: string;
};

export type TreeEntry = {
  name: string;
  objectType: 'blob' | 'tree';
  hash: string;
};

export type TreeObject = {
  formatVersion: '1.0';
  entries: TreeEntry[];
};

export type CommitObject = {
  formatVersion: '1.0';
  tree: string;
  parents: string[];
  author: VersionPerson;
  committer: VersionPerson;
  committedAt: string;
  message: string;
};

export type TagObject = {
  formatVersion: '1.0';
  object: string;
  objectType: 'commit';
  name: string;
  tagger: VersionPerson;
  taggedAt: string;
  message: string;
};

export type VersionObjectPayload =
  | Buffer
  | Uint8Array
  | TreeObject
  | CommitObject
  | TagObject;

export type WriteVersionObjectOptions = {
  rootDir: string;
  projectName: string;
  type: VersionObjectType;
  payload: VersionObjectPayload;
  /** 未指定時は MAX_VERSION_OBJECT_BYTES */
  maxBytes?: number;
};

export type WriteVersionObjectResult = {
  status: 'created' | 'unchanged';
  hash: string;
  type: VersionObjectType;
};

export type ReadVersionObjectOptions = {
  rootDir: string;
  projectName: string;
  hash: string;
  /** 期待 type。不一致なら TYPE_MISMATCH */
  expectedType?: VersionObjectType;
  maxBytes?: number;
};

export type ReadVersionObjectResult = {
  hash: string;
  type: VersionObjectType;
  /** raw payload bytes（header 除く） */
  payload: Buffer;
};
