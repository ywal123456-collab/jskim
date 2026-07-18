import { loadScreenSpecProject } from '../builder/load-screen-spec-project.js';
import { createReferenceImageError } from './errors.js';

/**
 * Description ∪ implementation の screen union に screenId があるか検証する。
 * references/ だけの孤児は拒否する。
 */
export function assertReferenceImageScreenExists(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
}): void {
  const project = loadScreenSpecProject({
    rootDir: options.rootDir,
    projectName: options.projectName,
  });
  const found = project.screens.some((s) => s.screenId === options.screenId);
  if (!found) {
    throw createReferenceImageError(
      'SPEC_REFERENCE_IMAGE_SCREEN_NOT_FOUND',
      `画面が見つかりません: screenId=${options.screenId}`,
    );
  }
}
