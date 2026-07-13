import fs from 'node:fs';
import path from 'node:path';

export type SourceSpec = {
  schemaVersion: string;
  screen: {
    id: string;
    path: string;
  };
  states: Array<{
    id: string;
    name: string;
    viewer?: {
      visible?: boolean;
      order?: number;
    };
    collect?: {
      actions?: unknown[];
    };
  }>;
  interactions: Array<{
    itemId: string;
    type: string;
    category?: string;
    targetStateId?: string;
    targetScreenId?: string;
    url?: string;
    label?: string;
  }>;
};

export type DescriptionSpec = {
  schemaVersion: string;
  screen: {
    id: string;
    name: string;
    description?: string;
  };
  items: Record<
    string,
    {
      name: string;
      type: string;
      description?: string;
      note?: string;
    }
  >;
};

export type LoadedSnapshot = {
  stateId: string;
  filePath: string;
  html: string;
};

export type LoadedScreen = {
  screenId: string;
  sourcePath: string;
  descriptionPath: string;
  source: SourceSpec;
  description: DescriptionSpec;
  snapshots: LoadedSnapshot[];
};

export type ScreenSpecProject = {
  rootDir: string;
  projectName: string;
  screens: LoadedScreen[];
  /** source JSON に登場する全 screen.id（snapshot 有無を問わない） */
  allSourceScreenIds: Set<string>;
  previewCssPath: string | null;
};

function walkFiles(dir: string, predicate: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, predicate));
    } else if (entry.isFile() && predicate(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

/**
 * Source / Description / Snapshot を読み込み、三者そろった画面だけを返す。
 */
export function loadScreenSpecProject(options: {
  rootDir: string;
  projectName: string;
}): ScreenSpecProject {
  const { rootDir, projectName } = options;
  const pagesDir = path.join(rootDir, 'src', projectName, 'pages');
  const dataDir = path.join(rootDir, 'spec', projectName, 'src', 'data');
  const snapshotsRoot = path.join(rootDir, 'spec', projectName, 'src', 'snapshots');
  const previewCssPath = path.join(
    rootDir,
    'spec',
    projectName,
    'src',
    'theme',
    'preview.css',
  );

  const sourceFiles = walkFiles(pagesDir, (name) => name.endsWith('.spec.json'));
  const allSourceScreenIds = new Set<string>();
  const sourceById = new Map<string, { filePath: string; data: SourceSpec }>();

  for (const filePath of sourceFiles) {
    const data = readJson<SourceSpec>(filePath);
    const id = data.screen?.id;
    if (!id) {
      continue;
    }
    allSourceScreenIds.add(id);
    sourceById.set(id, { filePath, data });
  }

  const descriptionFiles = walkFiles(dataDir, (name) => name.endsWith('.json'));
  const descriptionById = new Map<
    string,
    { filePath: string; data: DescriptionSpec }
  >();

  for (const filePath of descriptionFiles) {
    const data = readJson<DescriptionSpec>(filePath);
    const id = data.screen?.id || path.basename(filePath, '.json');
    descriptionById.set(id, { filePath, data });
  }

  const screens: LoadedScreen[] = [];

  for (const [screenId, sourceEntry] of sourceById) {
    const descriptionEntry = descriptionById.get(screenId);
    if (!descriptionEntry) {
      continue;
    }

    const screenSnapshotDir = path.join(snapshotsRoot, screenId);
    if (!fs.existsSync(screenSnapshotDir)) {
      continue;
    }

    const snapshotFiles = fs
      .readdirSync(screenSnapshotDir)
      .filter((name) => name.endsWith('.html'))
      .sort();

    if (snapshotFiles.length === 0) {
      continue;
    }

    const snapshots: LoadedSnapshot[] = snapshotFiles.map((name) => {
      const filePath = path.join(screenSnapshotDir, name);
      return {
        stateId: path.basename(name, '.html'),
        filePath,
        html: fs.readFileSync(filePath, 'utf8'),
      };
    });

    screens.push({
      screenId,
      sourcePath: sourceEntry.filePath,
      descriptionPath: descriptionEntry.filePath,
      source: sourceEntry.data,
      description: descriptionEntry.data,
      snapshots,
    });
  }

  screens.sort((a, b) => a.screenId.localeCompare(b.screenId, 'en'));

  return {
    rootDir,
    projectName,
    screens,
    allSourceScreenIds,
    previewCssPath: fs.existsSync(previewCssPath) ? previewCssPath : null,
  };
}
