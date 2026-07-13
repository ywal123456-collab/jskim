import { createHash } from 'node:crypto';

/**
 * 内容バイトの SHA-256 先頭 12 桁（hex）を返す。
 */
export function contentHash12(bytes: Buffer | Uint8Array | string): string {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes);
  return createHash('sha256').update(buf).digest('hex').slice(0, 12);
}

/**
 * resourceId = `{hash12}.{ext}`
 */
export function resourceIdFromContent(
  bytes: Buffer | Uint8Array | string,
  ext: string,
): string {
  const normalizedExt = ext.replace(/^\./, '').toLowerCase();
  return `${contentHash12(bytes)}.${normalizedExt}`;
}
