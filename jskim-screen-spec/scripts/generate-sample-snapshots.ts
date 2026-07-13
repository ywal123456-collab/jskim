/**
 * sample プロジェクトの preserve ビルドから画面 root outerHTML を抽出し、
 * spec/sample/src/snapshots/{screenId}/default.html に書き出す。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { extractElementOuterHtml } from '../src/builder/extract-element.js';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

const SCREEN_IDS = [
  'crud-create',
  'wizard-input',
  'wizard-confirm',
  'wizard-complete',
] as const;

export async function generateSampleSnapshots(
  workspaceRoot: string = repoRoot,
): Promise<void> {
  const { loadConfig } = require(
    path.join(workspaceRoot, 'scripts/lib/load-config.js'),
  ) as {
    loadConfig: (root: string) => { config: unknown };
  };
  const { resolveProject } = require(
    path.join(workspaceRoot, 'scripts/lib/resolve-project.js'),
  ) as {
    resolveProject: (opts: Record<string, unknown>) => {
      outputDir: string;
      build: { clean?: boolean };
      name: string;
      [key: string]: unknown;
    };
  };
  const { runBuild } = require(
    path.join(workspaceRoot, 'scripts/lib/build-project.js'),
  ) as {
    runBuild: (
      project: unknown,
      options?: Record<string, unknown>,
    ) => Promise<unknown>;
  };

  const { config } = loadConfig(workspaceRoot);
  const project = resolveProject({
    config,
    workspaceRoot,
    projectName: 'sample',
    commandName: 'build',
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-spec-snap-'));
  project.outputDir = tempDir;
  if (project.build) {
    project.build.clean = true;
  }

  console.log('[jskim-screen-spec] preserve モードで一時ビルドします…');
  await runBuild(project, {
    preserveScreenSpecAttributes: true,
    log: false,
  });

  const pagesDir = path.join(workspaceRoot, 'src/sample/pages');
  const pathByScreenId = new Map<string, string>();

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.spec.json')) {
        const data = JSON.parse(fs.readFileSync(full, 'utf8')) as {
          screen?: { id?: string; path?: string };
        };
        if (data.screen?.id && data.screen.path) {
          pathByScreenId.set(data.screen.id, data.screen.path);
        }
      }
    }
  }
  walk(pagesDir);

  const snapshotsRoot = path.join(workspaceRoot, 'spec/sample/src/snapshots');

  try {
    for (const screenId of SCREEN_IDS) {
      const screenPath = pathByScreenId.get(screenId);
      if (!screenPath) {
        throw new Error(
          `[jskim-screen-spec] Source JSON に画面「${screenId}」がありません。`,
        );
      }

      const htmlFile = path.join(
        tempDir,
        screenPath.replace(/^\//, '').split('/').join(path.sep),
      );
      if (!fs.existsSync(htmlFile)) {
        throw new Error(
          `[jskim-screen-spec] 一時ビルド成果物が見つかりません: ${htmlFile}`,
        );
      }

      const html = fs.readFileSync(htmlFile, 'utf8');
      const outer = extractElementOuterHtml(
        html,
        'data-jskim-spec-screen',
        screenId,
      );
      if (!outer) {
        throw new Error(
          `[jskim-screen-spec] data-jskim-spec-screen="${screenId}" の root を抽出できませんでした。`,
        );
      }

      const outDir = path.join(snapshotsRoot, screenId);
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, 'default.html');
      fs.writeFileSync(outFile, outer.trim() + '\n', 'utf8');
      console.log(
        `[jskim-screen-spec] snapshot を書きました: ${path.relative(workspaceRoot, outFile)}`,
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('[jskim-screen-spec] snapshot 生成が完了しました。');
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  generateSampleSnapshots().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
