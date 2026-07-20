import path from 'node:path';

/**
 * working tree 上の Feature Group 正本パス（project-relative ではない絶対 path 計算用）。
 */
export function featuresFilePath(rootDir: string, projectName: string): string {
  return path.join(rootDir, 'spec', projectName, 'src', 'features.json');
}

/** pack / ログ向けの project-relative POSIX 表記 */
export function featuresRelativePath(projectName: string): string {
  return `spec/${projectName}/src/features.json`;
}

/** project 単位の Feature mutation lock（source / version repo には含めない） */
export function featureMutationLockPath(
  rootDir: string,
  projectName: string,
): string {
  return path.join(rootDir, 'spec', projectName, '.jskim', 'features.lock');
}
