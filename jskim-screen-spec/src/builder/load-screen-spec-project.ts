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

export type LoadedStyleRef = {
  kind: 'link' | 'style';
  resourceId: string;
  media: string;
  disabled: boolean;
};

export type DocumentContextNode = {
  class: string[];
  attributes: Record<string, string>;
};

export type DocumentContext = {
  html: DocumentContextNode;
  body: DocumentContextNode;
};

export type LoadedScreenResources = {
  screenId: string;
  states: Record<
    string,
    {
      styles: LoadedStyleRef[];
      documentContext?: DocumentContext;
    }
  >;
};

export type LoadedResourceFile = {
  id: string;
  hash: string;
  ext: string;
  kind: string;
  byteLength: number;
  filePath: string;
  bytes: Buffer;
};

export type LoadedResources = {
  manifestPath: string;
  files: Map<string, LoadedResourceFile>;
  screens: Map<string, LoadedScreenResources>;
};

export type LoadedScreen = {
  screenId: string;
  sourcePath: string;
  descriptionPath: string;
  source: SourceSpec;
  description: DescriptionSpec;
  snapshots: LoadedSnapshot[];
  /** collect 済み styles（resources がある場合） */
  stateStyles: Record<string, LoadedStyleRef[]>;
  /** collect 済み documentContext（resources がある場合） */
  stateDocumentContexts: Record<string, DocumentContext | undefined>;
};

export type ScreenSpecProject = {
  rootDir: string;
  projectName: string;
  screens: LoadedScreen[];
  /** source JSON に登場する全 screen.id（snapshot 有無を問わない） */
  allSourceScreenIds: Set<string>;
  previewCssPath: string | null;
  resources: LoadedResources | null;
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
  const resourcesRoot = path.join(
    rootDir,
    'spec',
    projectName,
    'src',
    'resources',
  );
  const previewCssPath = path.join(
    rootDir,
    'spec',
    projectName,
    'src',
    'theme',
    'preview.css',
  );

  const resources = loadResources(resourcesRoot);

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

    const screenResources = resources?.screens.get(screenId);
    const stateStyles: Record<string, LoadedStyleRef[]> = {};
    const stateDocumentContexts: Record<
      string,
      DocumentContext | undefined
    > = {};
    if (screenResources) {
      for (const [stateId, state] of Object.entries(screenResources.states)) {
        stateStyles[stateId] = state.styles || [];
        stateDocumentContexts[stateId] = state.documentContext;
      }
    }

    screens.push({
      screenId,
      sourcePath: sourceEntry.filePath,
      descriptionPath: descriptionEntry.filePath,
      source: sourceEntry.data,
      description: descriptionEntry.data,
      snapshots,
      stateStyles,
      stateDocumentContexts,
    });
  }

  screens.sort((a, b) => a.screenId.localeCompare(b.screenId, 'en'));

  return {
    rootDir,
    projectName,
    screens,
    allSourceScreenIds,
    previewCssPath: fs.existsSync(previewCssPath) ? previewCssPath : null,
    resources,
  };
}

function loadResources(resourcesRoot: string): LoadedResources | null {
  const manifestPath = path.join(resourcesRoot, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const manifest = readJson<{
    files?: Record<
      string,
      { hash: string; ext: string; kind: string; byteLength: number }
    >;
    screens?: string[];
  }>(manifestPath);

  const files = new Map<string, LoadedResourceFile>();
  const filesDir = path.join(resourcesRoot, 'files');
  for (const [id, meta] of Object.entries(manifest.files || {})) {
    const filePath = path.join(filesDir, id);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const bytes = fs.readFileSync(filePath);
    files.set(id, {
      id,
      hash: meta.hash,
      ext: meta.ext,
      kind: meta.kind,
      byteLength: meta.byteLength,
      filePath,
      bytes,
    });
  }

  const screens = new Map<string, LoadedScreenResources>();
  const screensDir = path.join(resourcesRoot, 'screens');
  if (fs.existsSync(screensDir)) {
    for (const name of fs.readdirSync(screensDir)) {
      if (!name.endsWith('.json')) {
        continue;
      }
      const data = readJson<LoadedScreenResources>(
        path.join(screensDir, name),
      );
      if (data.screenId) {
        screens.set(data.screenId, data);
      }
    }
  }

  return { manifestPath, files, screens };
}
