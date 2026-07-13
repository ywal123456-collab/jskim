import fs from 'node:fs';
import path from 'node:path';
import type { DocumentContext } from '../capture-document-context.js';
import type { ResourceBag, StyleRef } from './resource-bag.js';
import { replaceDirAtomic } from '../../util/replace-dir-atomic.js';

export type ScreenResourcesJson = {
  screenId: string;
  states: Record<
    string,
    {
      styles: StyleRef[];
      documentContext?: DocumentContext;
    }
  >;
};

export type ResourcesManifest = {
  schemaVersion: '1.0';
  projectName: string;
  files: Record<
    string,
    {
      hash: string;
      ext: string;
      kind: string;
      byteLength: number;
    }
  >;
  screens: string[];
};

export type WriteResourcesInput = {
  resourcesDir: string;
  projectName: string;
  bag: ResourceBag;
  screens: ScreenResourcesJson[];
};

/**
 * `src/resources` を TEMP へ書いてから原子的に置き換える。
 * 成功時は旧ディレクトリを丸ごと捨て、新セットだけが残る（orphan 除去）。
 */
export function writeResourcesAtomic(input: WriteResourcesInput): void {
  const { resourcesDir, projectName, bag, screens } = input;
  const parent = path.dirname(resourcesDir);
  const tmpDir = path.join(parent, `.resources.tmp-${process.pid}`);

  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  try {
    fs.mkdirSync(path.join(tmpDir, 'files'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'screens'), { recursive: true });

    const filesMeta: ResourcesManifest['files'] = {};
    for (const file of bag.list()) {
      fs.writeFileSync(path.join(tmpDir, 'files', file.id), file.bytes);
      filesMeta[file.id] = {
        hash: file.hash,
        ext: file.ext,
        kind: file.kind,
        byteLength: file.byteLength,
      };
    }

    const screenIds = screens
      .map((s) => s.screenId)
      .sort((a, b) => a.localeCompare(b, 'en'));

    for (const screen of screens) {
      const payload = {
        screenId: screen.screenId,
        states: screen.states,
      };
      fs.writeFileSync(
        path.join(tmpDir, 'screens', `${screen.screenId}.json`),
        `${JSON.stringify(payload, null, 2)}\n`,
        'utf8',
      );
    }

    const manifest: ResourcesManifest = {
      schemaVersion: '1.0',
      projectName,
      files: filesMeta,
      screens: screenIds,
    };

    fs.writeFileSync(
      path.join(tmpDir, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    replaceDirAtomic(resourcesDir, tmpDir);
  } catch (err) {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // temp 掃除失敗は無視
    }
    throw err;
  }
}
