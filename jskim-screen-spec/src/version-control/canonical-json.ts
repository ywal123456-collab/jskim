import { createVersionControlError } from './errors.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function fail(message: string): never {
  throw createVersionControlError('SPEC_VERSION_CANONICAL_JSON_INVALID', message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function normalizeString(value: string): string {
  return value.normalize('NFC');
}

function encodeString(value: string): string {
  return JSON.stringify(normalizeString(value));
}

function encodeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    fail('有限でない数値は canonical JSON に含められません。');
  }
  const n = Object.is(value, -0) ? 0 : value;
  return JSON.stringify(n);
}

function encodeArray(value: unknown[], seen: Set<object>): string {
  if (seen.has(value)) {
    fail('循環参照は許可されていません。');
  }
  seen.add(value);
  // sparse 検出
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, i)) {
      fail('sparse 配列は許可されていません。');
    }
  }
  const parts = value.map((item) => encodeValue(item, seen));
  seen.delete(value);
  return `[${parts.join(',')}]`;
}

function encodeObject(value: Record<string, unknown>, seen: Set<object>): string {
  if (seen.has(value)) {
    fail('循環参照は許可されていません。');
  }
  seen.add(value);

  const rawKeys = Object.keys(value);
  for (const key of rawKeys) {
    if (FORBIDDEN_KEYS.has(key)) {
      fail('禁止されたオブジェクトキーが含まれています。');
    }
  }

  const normalizedPairs: Array<{ key: string; encodedKey: string; value: unknown }> =
    [];
  const seenNormKeys = new Set<string>();
  for (const key of rawKeys) {
    const norm = normalizeString(key);
    if (seenNormKeys.has(norm)) {
      fail('Unicode 正規化後にオブジェクトキーが衝突しました。');
    }
    seenNormKeys.add(norm);
    normalizedPairs.push({
      key: norm,
      encodedKey: encodeString(norm),
      value: value[key],
    });
  }

  normalizedPairs.sort((a, b) => {
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  });

  const parts = normalizedPairs.map(
    (p) => `${p.encodedKey}:${encodeValue(p.value, seen)}`,
  );
  seen.delete(value);
  return `{${parts.join(',')}}`;
}

function encodeValue(value: unknown, seen: Set<object>): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    fail('undefined は許可されていません。');
  }
  const t = typeof value;
  if (t === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (t === 'string') {
    return encodeString(value as string);
  }
  if (t === 'number') {
    return encodeNumber(value as number);
  }
  if (t === 'bigint' || t === 'function' || t === 'symbol') {
    fail(`${t} は許可されていません。`);
  }
  if (t !== 'object') {
    fail('未対応の値型です。');
  }
  if (Buffer.isBuffer(value)) {
    fail('Buffer を JSON 値として直接は使えません。');
  }
  if (value instanceof Date) {
    fail('Date は許可されていません。');
  }
  if (value instanceof Map || value instanceof Set) {
    fail('Map / Set は許可されていません。');
  }
  if (Array.isArray(value)) {
    return encodeArray(value, seen);
  }
  if (!isPlainObject(value)) {
    fail('plain object 以外のオブジェクトは許可されていません。');
  }
  return encodeObject(value, seen);
}

/**
 * hash 入力用 canonical JSON（compact・NFC・key 安定ソート・末尾改行なし）。
 */
export function canonicalizeJson(value: unknown): string {
  return encodeValue(value, new Set<object>());
}

export function canonicalizeJsonBytes(value: unknown): Buffer {
  return Buffer.from(canonicalizeJson(value), 'utf8');
}
