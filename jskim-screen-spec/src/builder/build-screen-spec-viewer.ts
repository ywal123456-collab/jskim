import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as viteBuild } from 'vite';
import { loadScreenSpecProject } from './load-screen-spec-project.js';
import { createViewerManifest } from './create-viewer-manifest.js';

export type BuildScreenSpecViewerOptions = {
  rootDir: string;
  projectName: string;
  outDir?: string;
  base?: string;
};

function packageRootDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

/**
 * Screen Spec viewer SPA と data を outDir に出力する。
 */
export async function buildScreenSpecViewer(
  options: BuildScreenSpecViewerOptions,
): Promise<{ outDir: string }> {
  const rootDir = path.resolve(options.rootDir);
  const projectName = options.projectName;
  const base = options.base ?? '/spec/';
  const outDir = path.resolve(
    options.outDir ?? path.join(rootDir, 'spec', projectName, 'dist'),
  );

  const project = loadScreenSpecProject({ rootDir, projectName });

  if (project.screens.length === 0) {
    throw new Error(
      `[jskim-screen-spec] 登録画面がありません。` +
        ` Source JSON・Description JSON・snapshot が揃った画面が必要です` +
        `（project=${projectName}）。`,
    );
  }

  const registeredScreenIds = new Set(project.screens.map((s) => s.screenId));
  const payload = createViewerManifest({
    projectName,
    base,
    screens: project.screens,
    registeredScreenIds,
  });

  const pkgRoot = packageRootDir();
  const viteConfigPath = path.join(pkgRoot, 'vite.config.ts');

  await viteBuild({
    configFile: viteConfigPath,
    base,
    build: {
      outDir,
      emptyOutDir: true,
    },
    logLevel: 'warn',
  });

  const dataDir = path.join(outDir, 'data');
  fs.mkdirSync(path.join(dataDir, 'screens'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'snapshots'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'theme'), { recursive: true });

  fs.writeFileSync(
    path.join(dataDir, 'manifest.json'),
    JSON.stringify(payload.manifest, null, 2) + '\n',
    'utf8',
  );

  for (const screen of payload.screens) {
    fs.writeFileSync(
      path.join(dataDir, 'screens', `${screen.id}.json`),
      JSON.stringify(screen, null, 2) + '\n',
      'utf8',
    );
  }

  for (const snap of payload.snapshotFiles) {
    const target = path.join(dataDir, snap.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, snap.html, 'utf8');
  }

  if (project.previewCssPath) {
    fs.copyFileSync(
      project.previewCssPath,
      path.join(dataDir, 'theme', 'preview.css'),
    );
  } else {
    fs.writeFileSync(
      path.join(dataDir, 'theme', 'preview.css'),
      '/* preview.css 未配置 */\n',
      'utf8',
    );
  }

  return { outDir };
}

/** ESM から CommonJS パスを import するためのヘルパー（スクリプト用） */
export function toImportUrl(filePath: string): string {
  return pathToFileURL(filePath).href;
}
