import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadScreenSpecProject } from '../builder/load-screen-spec-project.js';
import { loadScreenFeatures } from '../features/load-features.js';
import { parseReferenceImageMetadata } from '../reference-image/validate-metadata.js';
import { parseDeviceCaptureMetadata } from '../device-capture/validate-metadata.js';
import { parsePngIhdr } from '../util/png-ihdr.js';
import type { VersionObjectType } from './constants.js';
import { canonicalizeJsonBytes } from './canonical-json.js';
import { createVersionControlError } from './errors.js';
import { encodeVersionObject } from './object-format.js';
import { writeVersionObject } from './object-store.js';
import {
  buildVersionProjectDocument,
  assertVersionProjectDocument,
} from './project-document.js';
import type { TreeObject } from './types.js';

export type WorkingSnapshotObject = {
  type: VersionObjectType;
  encoded: Buffer;
};

export type WorkingSnapshot = {
  projectName: string;
  rootTreeHash: string;
  rootTree: TreeObject;
  objects: Map<string, WorkingSnapshotObject>;
  logicalPaths: string[];
  screens: string[];
};

function fail(message: string): never {
  throw createVersionControlError('SPEC_VERSION_SNAPSHOT_INVALID', message);
}

function compareName(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function readFile(filePath: string): Buffer {
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      throw createVersionControlError(
        'SPEC_VERSION_SYMLINK_NOT_ALLOWED',
        'シンボリックリンクは許可されていません。',
      );
    }
    return fs.readFileSync(filePath);
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      throw error;
    }
    return fail('スナップショット対象を読み取れませんでした。');
  }
}

function directories(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  if (fs.lstatSync(dir).isSymbolicLink()) {
    throw createVersionControlError(
      'SPEC_VERSION_SYMLINK_NOT_ALLOWED',
      'シンボリックリンクは許可されていません。',
    );
  }
  return fs.readdirSync(dir).sort(compareName);
}

function addObject(
  objects: Map<string, WorkingSnapshotObject>,
  type: VersionObjectType,
  payload: Buffer | TreeObject,
): string {
  const object = encodeVersionObject(type, payload);
  objects.set(object.hash, { type, encoded: object.encoded });
  return object.hash;
}

function buildTree(
  files: Map<string, Buffer>,
  objects: Map<string, WorkingSnapshotObject>,
): { hash: string; tree: TreeObject } {
  type Node = { files: Map<string, Buffer>; dirs: Map<string, Node> };
  const root: Node = { files: new Map(), dirs: new Map() };
  const sortedPaths = [...files.keys()].sort(compareName);
  for (const logical of sortedPaths) {
    const bytes = files.get(logical);
    if (!bytes) continue;
    const names = logical.split('/');
    let node = root;
    for (const name of names.slice(0, -1)) {
      let child = node.dirs.get(name);
      if (!child) {
        child = { files: new Map(), dirs: new Map() };
        node.dirs.set(name, child);
      }
      node = child;
    }
    const leaf = names[names.length - 1];
    if (!leaf) {
      fail('論理 path が不正です。');
    }
    if (node.files.has(leaf) || node.dirs.has(leaf)) {
      throw createVersionControlError(
        'SPEC_VERSION_LOGICAL_PATH_CONFLICT',
        '論理 path が衝突しています。',
      );
    }
    node.files.set(leaf, bytes);
  }

  const visit = (node: Node): { hash: string; tree: TreeObject } => {
    const entries: TreeObject['entries'] = [];
    const fileNames = [...node.files.keys()].sort(compareName);
    for (const name of fileNames) {
      const bytes = node.files.get(name);
      if (!bytes) continue;
      entries.push({
        name,
        objectType: 'blob',
        hash: addObject(objects, 'blob', bytes),
      });
    }
    const dirNames = [...node.dirs.keys()].sort(compareName);
    for (const name of dirNames) {
      const child = node.dirs.get(name);
      if (!child) continue;
      if (node.files.has(name)) {
        throw createVersionControlError(
          'SPEC_VERSION_LOGICAL_PATH_CONFLICT',
          '論理 path が衝突しています。',
        );
      }
      entries.push({
        name,
        objectType: 'tree',
        hash: visit(child).hash,
      });
    }
    entries.sort((a, b) => compareName(a.name, b.name));
    const tree: TreeObject = { formatVersion: '1.0', entries };
    return { hash: addObject(objects, 'tree', tree), tree };
  };
  return visit(root);
}

function assertImageBytes(bytes: Buffer, imageRevision: string): void {
  const png = parsePngIhdr(bytes);
  if (!png.ok) {
    fail(png.reason);
  }
  const hex = crypto.createHash('sha256').update(bytes).digest('hex');
  const expected = `sha256:${hex}`;
  if (imageRevision !== expected) {
    fail('画像内容と imageRevision が一致しません。');
  }
}

function addMedia(
  files: Map<string, Buffer>,
  root: string,
  screenIds: Set<string>,
  kind: 'references' | 'captures',
): void {
  for (const screenId of directories(root)) {
    if (!screenIds.has(screenId)) {
      fail(`${kind} に孤立した画面があります。`);
    }
    const screenDir = path.join(root, screenId);
    for (const stateOrViewport of directories(screenDir)) {
      const stateDirs =
        kind === 'captures'
          ? directories(path.join(screenDir, stateOrViewport))
          : [stateOrViewport];
      for (const viewport of stateDirs) {
        const dir =
          kind === 'captures'
            ? path.join(screenDir, stateOrViewport, viewport)
            : path.join(screenDir, viewport);
        const metaPath = path.join(dir, 'meta.json');
        if (!fs.existsSync(metaPath)) {
          fail(`${kind} の meta.json がありません。`);
        }
        const metaBytes = readFile(metaPath);
        let parsed: unknown;
        try {
          parsed = JSON.parse(metaBytes.toString('utf8'));
        } catch {
          fail(`${kind} の meta.json が不正です。`);
        }
        const result =
          kind === 'references'
            ? parseReferenceImageMetadata(parsed)
            : parseDeviceCaptureMetadata(parsed);
        if (!result.ok) {
          fail(`${kind} の meta.json が不正です。`);
        }
        const metadata = result.metadata;
        if (
          metadata.screenId !== screenId ||
          metadata.viewport.id !== viewport ||
          (kind === 'captures' &&
            'stateId' in metadata &&
            metadata.stateId !== stateOrViewport)
        ) {
          fail(`${kind} の経路と meta が一致しません。`);
        }
        const imagePath = path.join(dir, metadata.imageFile);
        if (!fs.existsSync(imagePath)) {
          fail(`${kind} の PNG がありません。`);
        }
        const imageBytes = readFile(imagePath);
        assertImageBytes(imageBytes, metadata.imageRevision);
        const prefix =
          kind === 'references'
            ? `screens/${screenId}/references/${viewport}`
            : `screens/${screenId}/captures/${stateOrViewport}/${viewport}`;
        files.set(`${prefix}/meta.json`, metaBytes);
        files.set(
          `${prefix}/${kind === 'references' ? 'reference.png' : 'capture.png'}`,
          imageBytes,
        );
      }
    }
  }
}

/**
 * 作業ツリーをメモリ上だけで object tree に変換する。
 * object store / index / repository init は行わない。
 */
export function createWorkingSnapshot(options: {
  rootDir: string;
  projectName: string;
}): WorkingSnapshot {
  const project = loadScreenSpecProject(options);
  // loadScreenSpecProject は screenId localeCompare('en') 済み。製品 screenOrder の正とする。
  const screenIds = project.screens.map((s) => s.screenId);
  if (new Set(screenIds).size !== screenIds.length) {
    fail('screenId が重複しています。');
  }
  // Feature membership を検証（knownScreenIds 重複もここで拒否）
  loadScreenFeatures({
    ...options,
    knownScreenIds: screenIds,
  });

  const projectDoc = buildVersionProjectDocument({
    projectName: options.projectName,
    screenIds,
  });
  assertVersionProjectDocument(projectDoc, {
    knownScreenIds: screenIds,
    expectedProjectName: options.projectName,
  });

  const files = new Map<string, Buffer>();
  files.set('project.json', canonicalizeJsonBytes(projectDoc));

  const specRoot = path.join(
    options.rootDir,
    'spec',
    options.projectName,
    'src',
  );
  if (fs.existsSync(specRoot) && fs.lstatSync(specRoot).isSymbolicLink()) {
    throw createVersionControlError(
      'SPEC_VERSION_SYMLINK_NOT_ALLOWED',
      'spec src がシンボリックリンクです。',
    );
  }

  const featurePath = path.join(specRoot, 'features.json');
  if (fs.existsSync(featurePath)) {
    files.set('features.json', readFile(featurePath));
  }
  if (project.previewCssPath && fs.existsSync(project.previewCssPath)) {
    files.set('theme/preview.css', readFile(project.previewCssPath));
  }

  for (const screen of project.screens) {
    const base = `screens/${screen.screenId}`;
    if (screen.descriptionPath) {
      files.set(`${base}/description.json`, readFile(screen.descriptionPath));
    }
    if (screen.sourcePath) {
      files.set(`${base}/source.json`, readFile(screen.sourcePath));
    }
    for (const snapshot of screen.snapshots) {
      files.set(
        `${base}/snapshots/${snapshot.stateId}.html`,
        readFile(snapshot.filePath),
      );
    }
    const resourcePath = path.join(
      specRoot,
      'resources',
      'screens',
      `${screen.screenId}.json`,
    );
    if (fs.existsSync(resourcePath)) {
      files.set(`${base}/resources/screen.json`, readFile(resourcePath));
      const resources = project.resources?.screens.get(screen.screenId);
      const ids = new Set<string>();
      for (const state of Object.values(resources?.states ?? {})) {
        for (const style of state.styles ?? []) {
          ids.add(style.resourceId);
        }
      }
      for (const id of [...ids].sort(compareName)) {
        const resource = path.join(specRoot, 'resources', 'files', id);
        if (!fs.existsSync(resource)) {
          fail('画面 resource がありません。');
        }
        files.set(`${base}/resources/files/${id}`, readFile(resource));
      }
    }
  }

  addMedia(files, path.join(specRoot, 'references'), new Set(screenIds), 'references');
  addMedia(files, path.join(specRoot, 'captures'), new Set(screenIds), 'captures');

  const objects = new Map<string, WorkingSnapshotObject>();
  const built = buildTree(files, objects);
  return {
    projectName: options.projectName,
    rootTreeHash: built.hash,
    rootTree: built.tree,
    objects,
    logicalPaths: [...files.keys()].sort(compareName),
    screens: screenIds,
  };
}

/**
 * in-memory snapshot の object を store へ保存する。
 * ref / index は変更しない。dangling object は許容する。
 */
export function persistSnapshotObjects(options: {
  rootDir: string;
  projectName: string;
  snapshot: WorkingSnapshot;
}): void {
  for (const object of options.snapshot.objects.values()) {
    const nul = object.encoded.indexOf(0);
    const header = object.encoded.subarray(0, nul).toString('utf8');
    const type = header.slice(0, header.indexOf(' ')) as VersionObjectType;
    const payloadBytes = object.encoded.subarray(nul + 1);
    if (type === 'blob') {
      writeVersionObject({
        rootDir: options.rootDir,
        projectName: options.projectName,
        type: 'blob',
        payload: payloadBytes,
      });
      continue;
    }
    const parsed = JSON.parse(payloadBytes.toString('utf8')) as unknown;
    writeVersionObject({
      rootDir: options.rootDir,
      projectName: options.projectName,
      type,
      payload: parsed as TreeObject,
    });
  }
}
