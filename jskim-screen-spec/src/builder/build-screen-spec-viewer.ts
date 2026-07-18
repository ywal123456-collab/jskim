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

  // 0 画面（Description/Source ともに無い）でも viewer は空 manifest として build する。
  const registeredScreenIds = new Set(project.screens.map((s) => s.screenId));
  const payload = createViewerManifest({
    projectName,
    base,
    screens: project.screens,
    registeredScreenIds,
    resourceFiles: project.resources?.files,
    rootDir,
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
  fs.mkdirSync(path.join(dataDir, 'resources', 'files'), { recursive: true });

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

  for (const file of payload.resourceFiles) {
    const target = path.join(dataDir, file.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.bytes);
  }

  // Device Capture: 参照されている generation PNG のみ（emptyOutDir で旧出力は消える）
  for (const file of payload.deviceCaptureFiles) {
    const target = path.join(dataDir, file.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.bytes);
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
