const PNG_SIG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export type PngIhdrParseResult =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: string };

/**
 * PNG signature + IHDR から width/height を読む最小パーサ。
 * 上限チェックは呼び出し側の責任。
 */
export function parsePngIhdr(bytes: Buffer): PngIhdrParseResult {
  if (bytes.length < 33) {
    return { ok: false, reason: 'PNG が短すぎます。' };
  }
  if (!bytes.subarray(0, 8).equals(PNG_SIG)) {
    return { ok: false, reason: 'PNG シグネチャが不正です。' };
  }
  const length = bytes.readUInt32BE(8);
  const type = bytes.subarray(12, 16).toString('ascii');
  if (type !== 'IHDR' || length !== 13) {
    return { ok: false, reason: 'PNG IHDR が見つかりません。' };
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0) {
    return { ok: false, reason: 'PNG の幅または高さが 0 です。' };
  }
  return { ok: true, width, height };
}
