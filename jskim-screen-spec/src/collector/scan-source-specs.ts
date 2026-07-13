import fs from 'node:fs';
import path from 'node:path';
import type { SourceSpec } from '../builder/load-screen-spec-project.js';

export type ScannedSourceSpec = {
  filePath: string;
  source: SourceSpec;
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

/**
 * src/{project}/pages 配下の *.spec.json を走査して Source JSON を読み込む。
 */
export function scanSourceSpecs(
  rootDir: string,
  projectName: string,
): ScannedSourceSpec[] {
  const pagesDir = path.join(rootDir, 'src', projectName, 'pages');
  const files = walkFiles(pagesDir, (name) => name.endsWith('.spec.json'));
  const scanned: ScannedSourceSpec[] = [];

  for (const filePath of files) {
    const source = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SourceSpec;
    if (!source?.screen?.id) {
      continue;
    }
    scanned.push({ filePath, source });
  }

  scanned.sort((a, b) =>
    a.source.screen.id.localeCompare(b.source.screen.id, 'en'),
  );

  return scanned;
}

export type SourceState = SourceSpec['states'][number];

/**
 * viewer.visible に関わらず全 state を対象にし、
 * viewer.order 昇順 → JSON 出現順で並べる。
 */
export function sortStatesForCollect(states: SourceState[]): SourceState[] {
  return states
    .map((state, index) => ({ state, index }))
    .sort((a, b) => {
      const orderA = a.state.viewer?.order ?? 0;
      const orderB = b.state.viewer?.order ?? 0;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.index - b.index;
    })
    .map(({ state }) => state);
}
