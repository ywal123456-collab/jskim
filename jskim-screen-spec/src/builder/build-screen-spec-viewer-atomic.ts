import fs from 'node:fs';
import path from 'node:path';
import {
  buildScreenSpecViewer,
  type BuildScreenSpecViewerOptions,
} from './build-screen-spec-viewer.js';
import { replaceDirAtomic } from '../util/replace-dir-atomic.js';

/**
 * viewer を TEMP に build してから dist へ原子的に差し替える。
 * 失敗時は既存の dist を保持する。
 */
export async function buildScreenSpecViewerAtomic(
  options: BuildScreenSpecViewerOptions,
): Promise<{ outDir: string }> {
  const rootDir = path.resolve(options.rootDir);
  const projectName = options.projectName;
  const finalDir = path.resolve(
    options.outDir ?? path.join(rootDir, 'spec', projectName, 'dist'),
  );
  const parent = path.dirname(finalDir);
  fs.mkdirSync(parent, { recursive: true });

  const tmpDir = path.join(
    parent,
    `.dist.tmp-${process.pid}-${Date.now().toString(36)}`,
  );

  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  try {
    await buildScreenSpecViewer({
      ...options,
      outDir: tmpDir,
    });
    replaceDirAtomic(finalDir, tmpDir);
    return { outDir: finalDir };
  } catch (err) {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // TEMP 掃除失敗は無視
    }
    throw err;
  }
}
