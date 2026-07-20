export const REPOSITORY_FORMAT_VERSION = '1.0' as const;
export const HASH_ALGORITHM = 'sha256' as const;
export const DEFAULT_BRANCH = 'main' as const;
export const HEAD_MAIN_REF = 'ref: refs/heads/main' as const;

export const VERSION_DIR_SEGMENTS = ['.jskim', 'version'] as const;

/** generic object の保護上限（Reference 20MiB より低くしない） */
export const MAX_VERSION_OBJECT_BYTES = 64 * 1024 * 1024;

export const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

export const OBJECT_TYPES = ['blob', 'tree', 'commit', 'tag'] as const;
export type VersionObjectType = (typeof OBJECT_TYPES)[number];

export const TREE_FORMAT_VERSION = '1.0' as const;
export const COMMIT_FORMAT_VERSION = '1.0' as const;
export const TAG_FORMAT_VERSION = '1.0' as const;

export const MAX_IDENTITY_NAME_LENGTH = 200;
export const MAX_COMMIT_MESSAGE_LENGTH = 2048;
export const MAX_TAG_NAME_LENGTH = 128;
export const MAX_TREE_ENTRIES = 100_000;
