import fs from 'node:fs';
import { computeContentRevision } from '../../util/write-file-atomic.js';
import { descriptionDataFilePath } from './paths.js';

/**
 * 永続化済み Description JSON の実 bytes から revision を計算する。
 * ファイルが無い場合は null。
 */
export function readDescriptionRevision(
  rootDir: string,
  projectName: string,
  screenId: string,
): string | null {
  const filePath = descriptionDataFilePath(rootDir, projectName, screenId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const bytes = fs.readFileSync(filePath);
  return computeContentRevision(bytes);
}
