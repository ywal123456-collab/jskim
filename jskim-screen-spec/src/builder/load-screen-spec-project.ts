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
  schemaVersion: string; // '1.0' | '1.1' | '1.2'
  screen: {
    id: string;
    name: string;
    description?: string;
  };
  /** schemaVersion "1.1" / "1.2" で必須。1.0 には存在しない */
  itemOrder?: string[];
  /**
   * schemaVersion "1.2" で必須（空 object 可）。
   * 1.0 / 1.1 には存在しない。読込時は欠落を空とみなしてよい。
   */
  excludedItems?: Record<
    string,
    {
      name: string;
      type: string;
      description?: string;
      note?: string;
    }
  >;
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

export type ScreenSpecStatus = 'design-only' | 'implementation-only' | 'linked';

export type LoadedScreen = {
  screenId: string;
  sourcePath: string | null;
  descriptionPath: string | null;
  source: SourceSpec | null;
  description: DescriptionSpec | null;
  snapshots: LoadedSnapshot[];
  /** collect 済み styles（resources がある場合） */
  stateStyles: Record<string, LoadedStyleRef[]>;
  /** collect 済み documentContext（resources がある場合） */
  stateDocumentContexts: Record<string, DocumentContext | undefined>;
  /** Description JSON が存在するか */
  hasDescription: boolean;
  /** Source JSON（実装側）が存在するか */
  hasImplementation: boolean;
  /** 利用可能な snapshot HTML が 1 件以上あるか */
  hasPreview: boolean;
  status: ScreenSpecStatus;
};

export type ScreenSpecProject = {
  rootDir: string;
  projectName: string;
  screens: LoadedScreen[];
  /** source JSON に登場する全 screen.id（snapshot 有無を問わない） */
  allSourceScreenIds: Set<string>;
  /** Description JSON に登場する全 screen.id */
  allDescriptionScreenIds: Set<string>;
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
 * Description JSON として無視すべきファイル名か判定する。
 * 隠しファイル、writeFileAtomic / createFileAtomic の TEMP・backup 派生物
 * （例: `.{basename}.{pid}.{ts}.tmp` / `.bak`）を除外する。
 */
function isSkippableDescriptionFile(name: string): boolean {
  if (name.startsWith('.')) {
    return true;
  }
  if (name.endsWith('.tmp') || name.endsWith('.bak')) {
    return true;
  }
  if (/\.tmp\.[^.]+$/.test(name)) {
    return true;
  }
  return false;
}

type DescriptionEntry = { filePath: string; data: DescriptionSpec };

/**
 * `spec/{project}/src/data/*.json` を走査し Description JSON を読み込む。
 * 不正な内容は握りつぶさず日本語 Error を throw する。
 */
function loadDescriptions(dataDir: string): Map<string, DescriptionEntry> {
  const descriptionById = new Map<string, DescriptionEntry>();
  if (!fs.existsSync(dataDir)) {
    return descriptionById;
  }

  const resolvedDataDir = path.resolve(dataDir);
  const files = walkFiles(
    dataDir,
    (name) => name.endsWith('.json') && !isSkippableDescriptionFile(name),
  );

  for (const filePath of files) {
    const resolved = path.resolve(filePath);
    const relative = path.relative(resolvedDataDir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(
        `Description JSON のパスが不正です（data directory 外を参照しています）: ${filePath}`,
      );
    }

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Description JSON を読み込めません: ${filePath}\n原因: ${message}`,
      );
    }

    let data: DescriptionSpec;
    try {
      data = JSON.parse(raw) as DescriptionSpec;
    } catch {
      throw new Error(
        `Description JSON の形式が不正です（JSON の解析に失敗しました）: ${filePath}`,
      );
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(
        `Description JSON の内容が不正です（object ではありません）: ${filePath}`,
      );
    }

    if (
      data.schemaVersion !== '1.0' &&
      data.schemaVersion !== '1.1' &&
      data.schemaVersion !== '1.2'
    ) {
      throw new Error(
        `Description JSON の schemaVersion は "1.0" / "1.1" / "1.2" のいずれかである必要があります: ${filePath}`,
      );
    }

    const basename = path.basename(filePath, '.json');
    const screenIdFromFile =
      data.screen && typeof data.screen.id === 'string' ? data.screen.id : '';

    if (!screenIdFromFile) {
      throw new Error(
        `Description JSON に screen.id（string）がありません: ${filePath}`,
      );
    }

    if (screenIdFromFile !== basename) {
      throw new Error(
        `Description JSON の screen.id はファイル名と一致する必要があります` +
          `（screen.id="${screenIdFromFile}", file="${basename}.json"）: ${filePath}`,
      );
    }

    const existing = descriptionById.get(screenIdFromFile);
    if (existing) {
      throw new Error(
        `screenId が重複しています: "${screenIdFromFile}"` +
          `（${existing.filePath} と ${filePath}）`,
      );
    }

    descriptionById.set(screenIdFromFile, { filePath, data });
  }

  return descriptionById;
}

/**
 * Source / Description / Snapshot の Description∪Source 和集合で画面を読み込む。
 * 三者そろわない画面（design-only / implementation-only）も含まれる。
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

  const descriptionById = loadDescriptions(dataDir);
  const allDescriptionScreenIds = new Set(descriptionById.keys());

  const allScreenIds = Array.from(
    new Set<string>([...allSourceScreenIds, ...allDescriptionScreenIds]),
  );

  const screens: LoadedScreen[] = [];

  for (const screenId of allScreenIds) {
    const sourceEntry = sourceById.get(screenId) || null;
    const descriptionEntry = descriptionById.get(screenId) || null;

    const hasDescription = descriptionEntry != null;
    const hasImplementation = sourceEntry != null;

    let snapshots: LoadedSnapshot[] = [];
    const stateStyles: Record<string, LoadedStyleRef[]> = {};
    const stateDocumentContexts: Record<string, DocumentContext | undefined> = {};

    if (hasImplementation) {
      const screenSnapshotDir = path.join(snapshotsRoot, screenId);
      if (fs.existsSync(screenSnapshotDir)) {
        const snapshotFiles = fs
          .readdirSync(screenSnapshotDir)
          .filter((name) => name.endsWith('.html'))
          .sort();

        snapshots = snapshotFiles.map((name) => {
          const filePath = path.join(screenSnapshotDir, name);
          return {
            stateId: path.basename(name, '.html'),
            filePath,
            html: fs.readFileSync(filePath, 'utf8'),
          };
        });
      }

      const screenResources = resources?.screens.get(screenId);
      if (screenResources) {
        for (const [stateId, state] of Object.entries(screenResources.states)) {
          stateStyles[stateId] = state.styles || [];
          stateDocumentContexts[stateId] = state.documentContext;
        }
      }
    }

    const hasPreview = snapshots.length > 0;

    let status: ScreenSpecStatus;
    if (hasDescription && hasImplementation) {
      status = 'linked';
    } else if (hasDescription) {
      status = 'design-only';
    } else {
      status = 'implementation-only';
    }

    screens.push({
      screenId,
      sourcePath: sourceEntry?.filePath ?? null,
      descriptionPath: descriptionEntry?.filePath ?? null,
      source: sourceEntry?.data ?? null,
      description: descriptionEntry?.data ?? null,
      snapshots,
      stateStyles,
      stateDocumentContexts,
      hasDescription,
      hasImplementation,
      hasPreview,
      status,
    });
  }

  screens.sort((a, b) => a.screenId.localeCompare(b.screenId, 'en'));

  return {
    rootDir,
    projectName,
    screens,
    allSourceScreenIds,
    allDescriptionScreenIds,
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
