import fs from 'node:fs';
import path from 'node:path';

export type WriteSnapshotResult = 'updated' | 'unchanged';

/**
 * snapshot HTML を原子的に書き込む。
 * 既存と同一内容なら unchanged（書き込みスキップ可だが mtime は変えない）。
 * 末尾改行を付与する。
 */
export function writeSnapshot(
  filePath: string,
  html: string,
): WriteSnapshotResult {
  const normalized = html.endsWith('\n') ? html : `${html}\n`;
  const nextBuf = Buffer.from(normalized, 'utf8');

  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath);
    if (Buffer.compare(existing, nextBuf) === 0) {
      return 'unchanged';
    }
  }

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    fs.writeFileSync(tempPath, nextBuf);
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // temp 掃除失敗は無視
    }
    throw err;
  }

  return 'updated';
}

/**
 * 既存ファイルと内容が同じかを Buffer.compare で判定する（テスト用）。
 */
export function isSnapshotUnchanged(filePath: string, html: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const normalized = html.endsWith('\n') ? html : `${html}\n`;
  const nextBuf = Buffer.from(normalized, 'utf8');
  const existing = fs.readFileSync(filePath);
  return Buffer.compare(existing, nextBuf) === 0;
}
