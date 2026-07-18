import path from 'node:path';
import type { ViewportId } from './presets.js';

export function capturesRootDir(rootDir: string, projectName: string): string {
  return path.join(rootDir, 'spec', projectName, 'src', 'captures');
}

export function captureViewportDir(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
  stateId: string;
  viewport: ViewportId;
}): string {
  return path.join(
    capturesRootDir(options.rootDir, options.projectName),
    options.screenId,
    options.stateId,
    options.viewport,
  );
}

export function captureMetaPath(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
  stateId: string;
  viewport: ViewportId;
}): string {
  return path.join(captureViewportDir(options), 'meta.json');
}

export function snapshotHtmlPath(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
  stateId: string;
}): string {
  return path.join(
    options.rootDir,
    'spec',
    options.projectName,
    'src',
    'snapshots',
    options.screenId,
    `${options.stateId}.html`,
  );
}

export function screenResourcesPath(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
}): string {
  return path.join(
    options.rootDir,
    'spec',
    options.projectName,
    'src',
    'resources',
    'screens',
    `${options.screenId}.json`,
  );
}

export function resourcesManifestPath(
  rootDir: string,
  projectName: string,
): string {
  return path.join(
    rootDir,
    'spec',
    projectName,
    'src',
    'resources',
    'manifest.json',
  );
}
