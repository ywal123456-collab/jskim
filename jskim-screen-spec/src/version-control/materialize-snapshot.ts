import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createVersionControlError } from './errors.js';
import { readVersionObject } from './object-store.js';
import { flattenVersionTree } from './status.js';
import { assertIndexTreeReachable } from './index-integrity.js';

export type PhysicalFilePlan = {
  /** rootDir からの相対 POSIX path */
  relativePath: string;
  bytes: Buffer;
};

export type MaterializePlan = {
  files: PhysicalFilePlan[];
  /** 管理対象として削除・置換する相対 path（存在すれば） */
  managedRelativePaths: string[];
  /** checkout 後に除去する derived 相対 path */
  derivedRelativePaths: string[];
};

function fail(message: string): never {
  throw createVersionControlError('SPEC_VERSION_CHECKOUT_FAILED', message);
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join('/');
}

function readBlob(
  options: { rootDir: string; projectName: string },
  hash: string,
): Buffer {
  return readVersionObject({
    ...options,
    hash,
    expectedType: 'blob',
  }).payload;
}

function parseMetaImageFile(bytes: Buffer): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('media meta.json が不正です。');
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    typeof (parsed as { imageFile?: unknown }).imageFile !== 'string'
  ) {
    fail('media meta.json に imageFile がありません。');
  }
  const imageFile = (parsed as { imageFile: string }).imageFile;
  if (
    imageFile.includes('/') ||
    imageFile.includes('\\') ||
    imageFile.includes('\0') ||
    imageFile.includes('..') ||
    path.isAbsolute(imageFile)
  ) {
    fail('media meta.json の imageFile が不正です。');
  }
  return imageFile;
}

/**
 * logical tree path → 物理 source 相対 path（rootDir 基準）。
 * project.json は物理ファイルを持たない（screenOrder は screen 集合で再現）。
 */
export function logicalPathToPhysicalRelative(
  projectName: string,
  logicalPath: string,
  imageFileName?: string,
): string | null {
  if (logicalPath === 'project.json') return null;
  if (logicalPath === 'features.json') {
    return `spec/${projectName}/src/features.json`;
  }
  if (logicalPath === 'theme/preview.css') {
    return `spec/${projectName}/src/theme/preview.css`;
  }

  const desc = /^screens\/([^/]+)\/description\.json$/.exec(logicalPath);
  if (desc) return `spec/${projectName}/src/data/${desc[1]}.json`;

  const source = /^screens\/([^/]+)\/source\.json$/.exec(logicalPath);
  if (source) return `src/${projectName}/pages/${source[1]}.spec.json`;

  const snap = /^screens\/([^/]+)\/snapshots\/([^/]+)\.html$/.exec(logicalPath);
  if (snap) {
    return `spec/${projectName}/src/snapshots/${snap[1]}/${snap[2]}.html`;
  }

  const screenRes = /^screens\/([^/]+)\/resources\/screen\.json$/.exec(
    logicalPath,
  );
  if (screenRes) {
    return `spec/${projectName}/src/resources/screens/${screenRes[1]}.json`;
  }

  const fileRes = /^screens\/([^/]+)\/resources\/files\/([^/]+)$/.exec(
    logicalPath,
  );
  if (fileRes) {
    return `spec/${projectName}/src/resources/files/${fileRes[2]}`;
  }

  const refMeta =
    /^screens\/([^/]+)\/references\/([^/]+)\/meta\.json$/.exec(logicalPath);
  if (refMeta) {
    return `spec/${projectName}/src/references/${refMeta[1]}/${refMeta[2]}/meta.json`;
  }

  const refPng =
    /^screens\/([^/]+)\/references\/([^/]+)\/reference\.png$/.exec(
      logicalPath,
    );
  if (refPng) {
    if (!imageFileName) fail('reference.png の imageFile が必要です。');
    return `spec/${projectName}/src/references/${refPng[1]}/${refPng[2]}/${imageFileName}`;
  }

  const capMeta =
    /^screens\/([^/]+)\/captures\/([^/]+)\/([^/]+)\/meta\.json$/.exec(
      logicalPath,
    );
  if (capMeta) {
    return `spec/${projectName}/src/captures/${capMeta[1]}/${capMeta[2]}/${capMeta[3]}/meta.json`;
  }

  const capPng =
    /^screens\/([^/]+)\/captures\/([^/]+)\/([^/]+)\/capture\.png$/.exec(
      logicalPath,
    );
  if (capPng) {
    if (!imageFileName) fail('capture.png の imageFile が必要です。');
    return `spec/${projectName}/src/captures/${capPng[1]}/${capPng[2]}/${capPng[3]}/${imageFileName}`;
  }

  fail(`未対応の論理 path です: ${logicalPath}`);
}

function isManagedRelativePath(projectName: string, relative: string): boolean {
  const p = toPosix(relative);
  const prefixes = [
    `spec/${projectName}/src/features.json`,
    `spec/${projectName}/src/theme/preview.css`,
    `spec/${projectName}/src/data/`,
    `spec/${projectName}/src/snapshots/`,
    `spec/${projectName}/src/resources/screens/`,
    `spec/${projectName}/src/resources/files/`,
    `spec/${projectName}/src/references/`,
    `spec/${projectName}/src/captures/`,
    `src/${projectName}/pages/`,
  ];
  if (p === `spec/${projectName}/src/features.json`) return true;
  if (p === `spec/${projectName}/src/theme/preview.css`) return true;
  for (const prefix of prefixes) {
    if (prefix.endsWith('/') && p.startsWith(prefix)) {
      if (prefix === `src/${projectName}/pages/`) {
        return p.endsWith('.spec.json');
      }
      return true;
    }
  }
  return false;
}

function walkFiles(absDir: string, rootDir: string, out: string[]): void {
  if (!fs.existsSync(absDir)) return;
  const st = fs.lstatSync(absDir);
  if (st.isSymbolicLink()) {
    throw createVersionControlError(
      'SPEC_VERSION_SYMLINK_NOT_ALLOWED',
      'シンボリックリンクは許可されていません。',
    );
  }
  if (!st.isDirectory()) return;
  for (const entry of fs.readdirSync(absDir)) {
    const abs = path.join(absDir, entry);
    const est = fs.lstatSync(abs);
    if (est.isSymbolicLink()) {
      throw createVersionControlError(
        'SPEC_VERSION_SYMLINK_NOT_ALLOWED',
        'シンボリックリンクは許可されていません。',
      );
    }
    if (est.isDirectory()) {
      walkFiles(abs, rootDir, out);
    } else if (est.isFile()) {
      out.push(toPosix(path.relative(rootDir, abs)));
    }
  }
}

/**
 * target tree を物理 source へ展開する計画を作る。
 * unmanaged ファイルは現状 working からコピーして保全する。
 * aggregate manifest / dist は derived として除去対象にする。
 */
export function buildMaterializePlan(options: {
  rootDir: string;
  projectName: string;
  treeHash: string;
}): MaterializePlan {
  assertIndexTreeReachable({
    rootDir: options.rootDir,
    projectName: options.projectName,
    treeHash: options.treeHash,
  });

  const flat = flattenVersionTree(options, options.treeHash);
  const files: PhysicalFilePlan[] = [];
  const managed = new Set<string>();
  const metaImageFile = new Map<string, string>();

  for (const [logical, entry] of flat) {
    if (logical.endsWith('/meta.json')) {
      const bytes = readBlob(options, entry.hash);
      metaImageFile.set(logical.replace(/\/meta\.json$/, ''), parseMetaImageFile(bytes));
    }
  }

  for (const [logical, entry] of flat) {
    const bytes = readBlob(options, entry.hash);
    let imageFile: string | undefined;
    if (logical.endsWith('/reference.png') || logical.endsWith('/capture.png')) {
      const prefix = logical.replace(/\/(reference|capture)\.png$/, '');
      imageFile = metaImageFile.get(prefix);
      if (!imageFile) {
        // meta が無い場合は revision 由来の安定名を使う
        const hex = crypto.createHash('sha256').update(bytes).digest('hex');
        imageFile = logical.endsWith('/reference.png')
          ? `reference-${hex}.png`
          : `capture-${hex}.png`;
      }
    }
    const relative = logicalPathToPhysicalRelative(
      options.projectName,
      logical,
      imageFile,
    );
    if (relative === null) continue;
    files.push({ relativePath: relative, bytes });
    managed.add(relative);
  }

  // 現状 unmanaged を保全
  const existing: string[] = [];
  walkFiles(
    path.join(options.rootDir, 'spec', options.projectName, 'src'),
    options.rootDir,
    existing,
  );
  walkFiles(
    path.join(options.rootDir, 'src', options.projectName, 'pages'),
    options.rootDir,
    existing,
  );

  const written = new Set(files.map((f) => f.relativePath));
  for (const relative of existing) {
    if (relative === `spec/${options.projectName}/src/resources/manifest.json`) {
      continue;
    }
    if (isManagedRelativePath(options.projectName, relative)) {
      // 管理対象で新 tree に無いものは書かない（＝削除される）
      managed.add(relative);
      continue;
    }
    if (written.has(relative)) {
      fail('unmanaged ファイルが管理 path と衝突しています。');
    }
    const abs = path.join(options.rootDir, ...relative.split('/'));
    if (fs.lstatSync(abs).isSymbolicLink()) {
      throw createVersionControlError(
        'SPEC_VERSION_SYMLINK_NOT_ALLOWED',
        'シンボリックリンクは許可されていません。',
      );
    }
    files.push({ relativePath: relative, bytes: fs.readFileSync(abs) });
    written.add(relative);
  }

  return {
    files,
    managedRelativePaths: [...managed].sort(),
    derivedRelativePaths: [
      `spec/${options.projectName}/src/resources/manifest.json`,
      `spec/${options.projectName}/dist`,
    ],
  };
}

/** TEMP ディレクトリへ計画どおりファイルを書き出す。 */
export function writeMaterializePlanToDirectory(options: {
  rootDir: string;
  destinationRoot: string;
  plan: MaterializePlan;
}): void {
  for (const file of options.plan.files) {
    const abs = path.join(options.destinationRoot, ...file.relativePath.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.bytes);
  }
}
