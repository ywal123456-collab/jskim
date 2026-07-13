/**
 * sample の画面設計書 viewer を spec/sample/dist にビルドする。
 * snapshot が無い場合は先に生成する。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScreenSpecViewer } from '../src/builder/build-screen-spec-viewer.js';
import { generateSampleSnapshots } from './generate-sample-snapshots.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

const REQUIRED_SCREENS = [
  'crud-create',
  'wizard-input',
  'wizard-confirm',
  'wizard-complete',
] as const;

function snapshotsReady(): boolean {
  const root = path.join(repoRoot, 'spec/sample/src/snapshots');
  return REQUIRED_SCREENS.every((screenId) =>
    fs.existsSync(path.join(root, screenId, 'default.html')),
  );
}

async function main(): Promise<void> {
  if (!snapshotsReady()) {
    console.log(
      '[jskim-screen-spec] snapshot が不足しているため生成します…',
    );
    await generateSampleSnapshots(repoRoot);
  }

  const { outDir } = await buildScreenSpecViewer({
    rootDir: repoRoot,
    projectName: 'sample',
    base: '/spec/',
  });

  console.log(`[jskim-screen-spec] viewer を出力しました: ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
