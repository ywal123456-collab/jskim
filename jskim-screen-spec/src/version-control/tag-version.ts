import { resolveVersionAuthor } from './author-config.js';
import { MAX_COMMIT_MESSAGE_LENGTH } from './constants.js';
import { createVersionControlError } from './errors.js';
import { readVersionHead } from './head.js';
import { withMutationLock } from './mutation-lock.js';
import { writeVersionObject, readVersionObject } from './object-store.js';
import {
  compareAndSwapVersionRef,
  listRefNames,
  readVersionRef,
  validateRefName,
} from './refs.js';
import { resolveVersionRevision } from './revision-resolver.js';
import { assertNoIncompleteTransaction } from './transaction.js';
import type { TagObject, VersionPerson } from './types.js';
import { assertTagObject } from './validate-object.js';

export type VersionTagInfo = {
  name: string;
  tagObjectHash: string;
  targetCommitHash: string;
  message: string;
  tagger: VersionPerson;
  taggedAt: string;
};

export type CreateVersionTagOptions = {
  rootDir: string;
  projectName: string;
  name: string;
  message: string;
  target?: string;
  author?: VersionPerson;
  taggedAt?: string;
};

const ISO_UTC_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function assertTagMessage(message: string): string {
  if (
    typeof message !== 'string' ||
    message.trim() === '' ||
    message.length > MAX_COMMIT_MESSAGE_LENGTH ||
    message.includes('\0')
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_COMMIT_MESSAGE_INVALID',
      'tag message が不正です。',
    );
  }
  return message;
}

function assertTaggedAt(value: string | undefined): string {
  const taggedAt = value ?? new Date().toISOString();
  if (!ISO_UTC_RE.test(taggedAt)) {
    throw createVersionControlError(
      'SPEC_VERSION_COMMIT_MESSAGE_INVALID',
      'taggedAt は UTC ISO-8601 である必要があります。',
    );
  }
  const ms = Date.parse(taggedAt);
  if (!Number.isFinite(ms)) {
    throw createVersionControlError(
      'SPEC_VERSION_COMMIT_MESSAGE_INVALID',
      'taggedAt が不正な日時です。',
    );
  }
  return taggedAt.includes('.') ? taggedAt : new Date(ms).toISOString();
}

function loadTag(
  options: { rootDir: string; projectName: string },
  hash: string,
): TagObject {
  const object = readVersionObject({
    ...options,
    hash,
    expectedType: 'tag',
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(object.payload.toString('utf8'));
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_CORRUPT',
      'tag オブジェクトが不正です。',
    );
  }
  return assertTagObject(parsed);
}

export function listVersionTags(options: {
  rootDir: string;
  projectName: string;
}): VersionTagInfo[] {
  const names = listRefNames({ ...options, kind: 'tags' });
  return names.map((name) => {
    const tagObjectHash = readVersionRef({
      ...options,
      kind: 'tags',
      name,
    });
    const tag = loadTag(options, tagObjectHash);
    return {
      name,
      tagObjectHash,
      targetCommitHash: tag.object,
      message: tag.message,
      tagger: tag.tagger,
      taggedAt: tag.taggedAt,
    };
  });
}

/**
 * annotated tag のみ作成する。上書き・移動・lightweight・削除は初期範囲外。
 */
export function createVersionTag(
  options: CreateVersionTagOptions,
): VersionTagInfo {
  return withMutationLock(options, 'tag-create', () => {
    assertNoIncompleteTransaction(options);
    const name = validateRefName('tags', options.name);
    if (listRefNames({ ...options, kind: 'tags' }).includes(name)) {
      throw createVersionControlError(
        'SPEC_VERSION_TAG_EXISTS',
        '同名の tag がすでに存在します。',
      );
    }

    let targetCommitHash: string;
    if (options.target !== undefined) {
      targetCommitHash = resolveVersionRevision({
        rootDir: options.rootDir,
        projectName: options.projectName,
        revision: options.target,
      }).commitHash;
    } else {
      const head = readVersionHead(options);
      if (head.unborn || !head.commit) {
        throw createVersionControlError(
          'SPEC_VERSION_REVISION_NOT_FOUND',
          'HEAD に commit がありません。',
        );
      }
      targetCommitHash = head.commit;
    }

    const tagger = resolveVersionAuthor({
      rootDir: options.rootDir,
      projectName: options.projectName,
      author: options.author,
    });
    const taggedAt = assertTaggedAt(options.taggedAt);
    const message = assertTagMessage(options.message);
    const payload: TagObject = {
      formatVersion: '1.0',
      object: targetCommitHash,
      objectType: 'commit',
      name,
      tagger,
      taggedAt,
      message,
    };
    assertTagObject(payload);

    const tagObjectHash = writeVersionObject({
      rootDir: options.rootDir,
      projectName: options.projectName,
      type: 'tag',
      payload,
    }).hash;

    try {
      compareAndSwapVersionRef({
        rootDir: options.rootDir,
        projectName: options.projectName,
        kind: 'tags',
        name,
        expectedOldHash: null,
        newHash: tagObjectHash,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'SPEC_VERSION_REF_CONFLICT'
      ) {
        throw createVersionControlError(
          'SPEC_VERSION_TAG_EXISTS',
          '同名の tag がすでに存在します。',
        );
      }
      throw error;
    }

    return {
      name,
      tagObjectHash,
      targetCommitHash,
      message,
      tagger,
      taggedAt,
    };
  });
}
