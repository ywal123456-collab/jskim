import path from 'node:path';

export function descriptionDataFilePath(
  rootDir: string,
  projectName: string,
  screenId: string,
): string {
  return path.join(rootDir, 'spec', projectName, 'src', 'data', `${screenId}.json`);
}

export function descriptionDataRelativePath(
  projectName: string,
  screenId: string,
): string {
  return `spec/${projectName}/src/data/${screenId}.json`;
}

/** screen 単位の Description mutation lock（source / version repo には含めない） */
export function descriptionScreenMutationLockPath(
  rootDir: string,
  projectName: string,
  screenId: string,
): string {
  return path.join(
    rootDir,
    'spec',
    projectName,
    '.jskim',
    'description-mutation',
    `${screenId}.lock`,
  );
}
