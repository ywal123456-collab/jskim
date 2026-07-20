import { writeVersionObject } from './object-store.js';
import type { TreeObject } from './types.js';
import { normalizeTreeObject } from './validate-object.js';

function compareName(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * logical blob path → hash の flat map から tree を組み立て、object store へ保存する。
 */
export function persistTreeFromFlatBlobs(options: {
  rootDir: string;
  projectName: string;
  files: Map<string, string>;
}): string {
  type Node = {
    files: Map<string, string>;
    dirs: Map<string, Node>;
  };
  const root: Node = { files: new Map(), dirs: new Map() };
  for (const logical of [...options.files.keys()].sort(compareName)) {
    const hash = options.files.get(logical);
    if (!hash) continue;
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
    if (!leaf) continue;
    node.files.set(leaf, hash);
  }

  const visit = (node: Node): string => {
    const entries: TreeObject['entries'] = [];
    for (const name of [...node.files.keys()].sort(compareName)) {
      const hash = node.files.get(name);
      if (!hash) continue;
      entries.push({ name, objectType: 'blob', hash });
    }
    for (const name of [...node.dirs.keys()].sort(compareName)) {
      const child = node.dirs.get(name);
      if (!child) continue;
      entries.push({
        name,
        objectType: 'tree',
        hash: visit(child),
      });
    }
    entries.sort((a, b) => compareName(a.name, b.name));
    const tree = normalizeTreeObject({ formatVersion: '1.0', entries });
    return writeVersionObject({
      rootDir: options.rootDir,
      projectName: options.projectName,
      type: 'tree',
      payload: tree,
    }).hash;
  };

  return visit(root);
}
