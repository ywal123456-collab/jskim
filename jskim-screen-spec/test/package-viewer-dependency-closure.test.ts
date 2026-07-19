import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * package.json files エントリから、配布対象となり得る絶対 path 集合を作る。
 * ディレクトリは配下のファイルを再帰列挙する。
 */
function collectPackagedAbsolutePaths(filesField: string[]): Set<string> {
  const out = new Set<string>();
  for (const entry of filesField) {
    const abs = path.resolve(packageRoot, entry);
    if (!fs.existsSync(abs)) {
      continue;
    }
    const st = fs.statSync(abs);
    if (st.isFile()) {
      out.add(path.normalize(abs));
      continue;
    }
    if (st.isDirectory()) {
      walkFiles(abs, out);
    }
  }
  return out;
}

function walkFiles(dir: string, out: Set<string>): void {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      walkFiles(p, out);
    } else if (st.isFile()) {
      out.add(path.normalize(p));
    }
  }
}

/**
 * ランタイムで解決される相対 import だけを拾う。
 * `import type` / `export type` は Vite bundle から除去されるため除外する。
 */
function extractRelativeSpecifiers(source: string): string[] {
  const found: string[] = [];
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith('import type ') ||
      trimmed.startsWith('export type ') ||
      /^import\s+type\s*\{/.test(trimmed) ||
      /^export\s+type\s*\{/.test(trimmed)
    ) {
      continue;
    }
    const fromMatch = trimmed.match(
      /(?:import|export)\s+[^'"\n]*?\s+from\s+['"](\.[^'"]+)['"]/,
    );
    if (fromMatch?.[1]) {
      found.push(fromMatch[1]);
      continue;
    }
    const sideEffect = trimmed.match(/^import\s+['"](\.[^'"]+)['"]/);
    if (sideEffect?.[1]) {
      found.push(sideEffect[1]);
      continue;
    }
    const dyn = trimmed.match(/import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/);
    if (dyn?.[1]) {
      found.push(dyn[1]);
    }
  }
  return found;
}

const RESOLVE_EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.vue',
  '.json',
  '/index.ts',
  '/index.js',
  '/index.vue',
];

function resolveRelativeImport(
  fromFile: string,
  specifier: string,
): string | null {
  const cleaned = specifier.replace(/\.js$/i, '');
  const base = path.resolve(path.dirname(fromFile), cleaned);
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = path.normalize(base + ext);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/**
 * src/viewer から相対 import を辿り、package files 外への依存を検出する。
 * type-only import も Vite/tsc が参照し得るため検査対象に含める。
 */
function findUnpackagedViewerDependencies(
  packaged: Set<string>,
): { file: string; specifier: string; resolved: string }[] {
  const viewerRoot = path.join(packageRoot, 'src', 'viewer');
  const queue: string[] = [];
  // seed: viewer 配下の全 .ts/.vue
  function collectSources(dir: string): void {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        collectSources(p);
      } else if (/\.(ts|tsx|vue|js|mjs)$/.test(name)) {
        queue.push(path.normalize(p));
      }
    }
  }
  collectSources(viewerRoot);

  const visited = new Set<string>();
  const missing: { file: string; specifier: string; resolved: string }[] = [];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) {
      continue;
    }
    visited.add(file);
    if (!packaged.has(file)) {
      // viewer 起点以外は「不足」として既に記録済みの想定
      continue;
    }
    const source = fs.readFileSync(file, 'utf8');
    for (const spec of extractRelativeSpecifiers(source)) {
      const resolved = resolveRelativeImport(file, spec);
      if (!resolved) {
        missing.push({
          file: path.relative(packageRoot, file),
          specifier: spec,
          resolved: '(unresolved)',
        });
        continue;
      }
      if (!packaged.has(resolved)) {
        missing.push({
          file: path.relative(packageRoot, file),
          specifier: spec,
          resolved: path.relative(packageRoot, resolved),
        });
        continue;
      }
      if (/\.(ts|tsx|vue|js|mjs)$/.test(resolved) && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return missing;
}

describe('Viewer package dependency closure', () => {
  it('src/viewer の相対依存は package files 対象に閉じている', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    ) as { files: string[] };
    expect(Array.isArray(pkg.files)).toBe(true);
    expect(pkg.files).toContain('src/viewer');
    expect(pkg.files).toContain('src/editing/exclude-description-item.ts');

    const packaged = collectPackagedAbsolutePaths(pkg.files);
    const missing = findUnpackagedViewerDependencies(packaged);
    expect(missing).toEqual([]);
  });
});
