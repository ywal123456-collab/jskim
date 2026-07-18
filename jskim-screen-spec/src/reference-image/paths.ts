import path from 'node:path';
import type { ViewportId } from './presets.js';

export function referencesRootDir(
  rootDir: string,
  projectName: string,
): string {
  return path.join(rootDir, 'spec', projectName, 'src', 'references');
}

export function referenceViewportDir(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
  viewport: ViewportId;
}): string {
  return path.join(
    referencesRootDir(options.rootDir, options.projectName),
    options.screenId,
    options.viewport,
  );
}

export function referenceMetaPath(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
  viewport: ViewportId;
}): string {
  return path.join(referenceViewportDir(options), 'meta.json');
}
