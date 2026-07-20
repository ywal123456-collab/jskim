import path from 'node:path';

export type ScreenSpecWatchKind =
  | 'COLLECT_AND_BUILD'
  | 'BUILD_ONLY'
  | 'IGNORE';

export type ClassifyScreenSpecWatchPathOptions = {
  rootDir: string;
  projectName: string;
  /** 解決済み project の sourceDir（絶対パス） */
  sourceDir: string;
  filePath: string;
};

/**
 * Screen Spec watch 用に変更パスを分類する。
 *
 * - COLLECT_AND_BUILD: 実装画面 / Source sidecar
 * - BUILD_ONLY: Description JSON / theme
 * - IGNORE: collector 生成物（snapshots / resources / dist）と
 *   captures / references の generation PNG / TEMP（meta.json 以外）
 * - BUILD_ONLY: Description/theme、および captures / references 配下の meta.json
 */
export function classifyScreenSpecWatchPath(
  options: ClassifyScreenSpecWatchPathOptions,
): ScreenSpecWatchKind {
  const rootDir = path.resolve(options.rootDir);
  const sourceDir = path.resolve(options.sourceDir);
  const filePath = path.resolve(options.filePath);
  const projectName = options.projectName;

  const relFromRoot = toPosixRelative(rootDir, filePath);
  if (!relFromRoot) {
    return 'IGNORE';
  }

  const specPrefix = `spec/${projectName}/`;
  if (relFromRoot === `spec/${projectName}` || relFromRoot.startsWith(specPrefix)) {
    const underSpec = relFromRoot.slice(specPrefix.length);
    if (
      underSpec === 'dist' ||
      underSpec.startsWith('dist/') ||
      underSpec.startsWith('.dist.tmp-') ||
      underSpec.startsWith('.dir.bak-')
    ) {
      return 'IGNORE';
    }
    if (
      underSpec === 'src/snapshots' ||
      underSpec.startsWith('src/snapshots/') ||
      underSpec === 'src/resources' ||
      underSpec.startsWith('src/resources/')
    ) {
      return 'IGNORE';
    }
    if (
      underSpec === 'src/captures' ||
      underSpec.startsWith('src/captures/') ||
      underSpec === 'src/references' ||
      underSpec.startsWith('src/references/')
    ) {
      // meta.json のみ BUILD_ONLY（commit point）。PNG / TEMP は IGNORE。
      if (
        underSpec === 'src/captures/meta.json' ||
        underSpec === 'src/references/meta.json' ||
        underSpec.endsWith('/meta.json')
      ) {
        return 'BUILD_ONLY';
      }
      return 'IGNORE';
    }
    if (
      underSpec === 'src/data' ||
      underSpec.startsWith('src/data/') ||
      underSpec === 'src/theme' ||
      underSpec.startsWith('src/theme/') ||
      underSpec === 'src/features.json'
    ) {
      return 'BUILD_ONLY';
    }
    // spec 配下のその他（例: src 直下の未定義）は無視
    return 'IGNORE';
  }

  if (isInsideOrSame(sourceDir, filePath)) {
    return 'COLLECT_AND_BUILD';
  }

  return 'IGNORE';
}

/**
 * 複数パスの分類結果を優先度付きでマージする。
 * COLLECT_AND_BUILD > BUILD_ONLY > IGNORE
 */
export function mergeScreenSpecWatchKinds(
  kinds: Iterable<ScreenSpecWatchKind>,
): ScreenSpecWatchKind {
  let hasCollect = false;
  let hasBuildOnly = false;
  for (const kind of kinds) {
    if (kind === 'COLLECT_AND_BUILD') {
      hasCollect = true;
    } else if (kind === 'BUILD_ONLY') {
      hasBuildOnly = true;
    }
  }
  if (hasCollect) {
    return 'COLLECT_AND_BUILD';
  }
  if (hasBuildOnly) {
    return 'BUILD_ONLY';
  }
  return 'IGNORE';
}

function toPosixRelative(rootDir: string, filePath: string): string | null {
  const rel = path.relative(path.resolve(rootDir), path.resolve(filePath));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return rel.split(path.sep).join('/');
}

function isInsideOrSame(parent: string, child: string): boolean {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  if (samePath(p, c)) {
    return true;
  }
  const rel = path.relative(p, c);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function samePath(a: string, b: string): boolean {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  if (process.platform === 'win32') {
    return na.toLowerCase() === nb.toLowerCase();
  }
  return na === nb;
}
