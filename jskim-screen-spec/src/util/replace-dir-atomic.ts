import fs from 'node:fs';
import path from 'node:path';

/**
 * tmpDir の内容で targetDir を原子的に置き換える。
 * 失敗時は可能な限り backup から復元する。
 */
export function replaceDirAtomic(targetDir: string, tmpDir: string): void {
  const parent = path.dirname(targetDir);
  const backupDir = path.join(parent, `.dir.bak-${process.pid}-${Date.now()}`);

  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }

  if (fs.existsSync(targetDir)) {
    try {
      fs.renameSync(targetDir, backupDir);
    } catch {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  }

  try {
    fs.renameSync(tmpDir, targetDir);
  } catch (err) {
    if (fs.existsSync(backupDir) && !fs.existsSync(targetDir)) {
      try {
        fs.renameSync(backupDir, targetDir);
      } catch {
        // ignore
      }
    }
    throw err;
  }

  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}
