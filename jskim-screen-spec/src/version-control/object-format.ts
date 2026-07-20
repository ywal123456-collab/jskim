import crypto from 'node:crypto';
import {
  MAX_VERSION_OBJECT_BYTES,
  OBJECT_TYPES,
  type VersionObjectType,
} from './constants.js';
import { createVersionControlError } from './errors.js';
import { canonicalizeJsonBytes } from './canonical-json.js';
import type {
  CommitObject,
  TagObject,
  TreeObject,
  VersionObjectPayload,
} from './types.js';
import {
  assertCommitObject,
  assertTagObject,
  assertTreeObject,
} from './validate-object.js';

const TYPE_SET = new Set<string>(OBJECT_TYPES);

export type EncodedVersionObject = {
  type: VersionObjectType;
  payload: Buffer;
  encoded: Buffer;
  hash: string;
};

function toPayloadBuffer(
  type: VersionObjectType,
  payload: VersionObjectPayload,
): Buffer {
  if (type === 'blob') {
    if (Buffer.isBuffer(payload)) {
      return payload;
    }
    if (payload instanceof Uint8Array) {
      return Buffer.from(payload);
    }
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      'blob の payload は Buffer または Uint8Array である必要があります。',
    );
  }

  if (type === 'tree') {
    const tree = assertTreeObject(payload);
    return canonicalizeJsonBytes(tree);
  }
  if (type === 'commit') {
    const commit = assertCommitObject(payload);
    return canonicalizeJsonBytes(commit);
  }
  if (type === 'tag') {
    const tag = assertTagObject(payload);
    return canonicalizeJsonBytes(tag);
  }
  throw createVersionControlError(
    'SPEC_VERSION_INVALID_OBJECT',
    '未対応の object type です。',
  );
}

/**
 * `type <len>\0payload` を組み立て、SHA-256（lowercase hex）を計算する。
 */
export function encodeVersionObject(
  type: VersionObjectType,
  payload: VersionObjectPayload,
  maxBytes: number = MAX_VERSION_OBJECT_BYTES,
): EncodedVersionObject {
  if (!TYPE_SET.has(type)) {
    throw createVersionControlError(
      'SPEC_VERSION_INVALID_OBJECT',
      '未対応の object type です。',
    );
  }
  const payloadBuf = toPayloadBuffer(type, payload);
  if (payloadBuf.byteLength > maxBytes) {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_TOO_LARGE',
      'オブジェクトサイズが上限を超えています。',
    );
  }
  const header = Buffer.from(`${type} ${payloadBuf.byteLength}\0`, 'utf8');
  const encoded = Buffer.concat([header, payloadBuf]);
  const hash = crypto.createHash('sha256').update(encoded).digest('hex');
  return { type, payload: payloadBuf, encoded, hash };
}

export function hashVersionObject(
  type: VersionObjectType,
  payload: VersionObjectPayload,
  maxBytes?: number,
): string {
  return encodeVersionObject(type, payload, maxBytes).hash;
}

export type DecodedVersionObject = {
  type: VersionObjectType;
  payload: Buffer;
  hash: string;
};

/**
 * 保存済み encoded bytes を検証し、type / payload / 再計算 hash を返す。
 */
export function decodeVersionObjectBytes(
  encoded: Buffer,
  expectedHash: string,
  maxBytes: number = MAX_VERSION_OBJECT_BYTES,
): DecodedVersionObject {
  if (encoded.byteLength > maxBytes + 64) {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_TOO_LARGE',
      'オブジェクトサイズが上限を超えています。',
    );
  }

  const nul = encoded.indexOf(0);
  if (nul <= 0) {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_CORRUPT',
      'オブジェクトヘッダが破損しています。',
    );
  }

  const header = encoded.subarray(0, nul).toString('utf8');
  // length は非正規（leading zero / 符号 / 空白 / 指数）を明示拒否する。
  // 許可: "0", "1", "10", ...（十進・先頭ゼロ無し。0 のみ単独 "0"）
  const match = /^(blob|tree|commit|tag) (0|[1-9]\d*)$/.exec(header);
  if (!match) {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_CORRUPT',
      'オブジェクトヘッダが不正です。',
    );
  }

  const type = match[1] as VersionObjectType;
  const declared = Number(match[2]);
  if (!Number.isSafeInteger(declared) || declared < 0) {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_CORRUPT',
      'オブジェクト長が不正です。',
    );
  }
  if (declared > maxBytes) {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_TOO_LARGE',
      'オブジェクトサイズが上限を超えています。',
    );
  }

  const payload = encoded.subarray(nul + 1);
  if (payload.byteLength !== declared) {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_CORRUPT',
      'オブジェクトの実長がヘッダと一致しません。',
    );
  }

  const actualHash = crypto.createHash('sha256').update(encoded).digest('hex');
  if (actualHash !== expectedHash) {
    throw createVersionControlError(
      'SPEC_VERSION_OBJECT_HASH_MISMATCH',
      'オブジェクト hash が一致しません。',
    );
  }

  if (type !== 'blob') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload.toString('utf8')) as unknown;
    } catch {
      throw createVersionControlError(
        'SPEC_VERSION_OBJECT_CORRUPT',
        'オブジェクト payload が不正な JSON です。',
      );
    }
    if (type === 'tree') {
      assertTreeObject(parsed);
    } else if (type === 'commit') {
      assertCommitObject(parsed);
    } else {
      assertTagObject(parsed);
    }
  }

  return { type, payload, hash: actualHash };
}

export type {
  TreeObject,
  CommitObject,
  TagObject,
};
