import fs from 'node:fs';
import path from 'node:path';
import { createVersionControlError } from './errors.js';
import { readVersionObject } from './object-store.js';
import { headPath, versionRepositoryPath } from './repository-paths.js';

export type VersionHead = {
  commit: string | null;
  tree: string | null;
  ref: string | null;
  unborn: boolean;
};

export function readVersionHead(options: { rootDir: string; projectName: string }): VersionHead {
  const repo = versionRepositoryPath(options.rootDir, options.projectName);
  if (!fs.existsSync(path.join(repo, 'format.json'))) {
    throw createVersionControlError('SPEC_VERSION_NOT_INITIALIZED', '版管理リポジトリが初期化されていません。');
  }
  let value: string;
  try { value = fs.readFileSync(headPath(repo), 'utf8').trim(); } catch {
    throw createVersionControlError('SPEC_VERSION_HEAD_CORRUPT', 'HEAD を読み取れませんでした。');
  }
  let ref: string | null = null;
  let commit = value;
  if (value.startsWith('ref: ')) {
    ref = value.slice(5);
    if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(ref) || ref.includes('..')) {
      throw createVersionControlError('SPEC_VERSION_REF_CORRUPT', 'HEAD の参照先が不正です。');
    }
    const refPath = path.resolve(repo, ref);
    if (!refPath.startsWith(`${path.resolve(repo)}${path.sep}`)) throw createVersionControlError('SPEC_VERSION_REF_CORRUPT', 'HEAD の参照先が不正です。');
    if (!fs.existsSync(refPath)) return { commit: null, tree: null, ref, unborn: true };
    commit = fs.readFileSync(refPath, 'utf8').trim();
  }
  if (!/^[a-f0-9]{64}$/.test(commit)) throw createVersionControlError('SPEC_VERSION_HEAD_CORRUPT', 'HEAD の commit hash が不正です。');
  const object = readVersionObject({ ...options, hash: commit, expectedType: 'commit' });
  let parsed: { tree?: unknown };
  try { parsed = JSON.parse(object.payload.toString('utf8')) as { tree?: unknown }; } catch {
    throw createVersionControlError('SPEC_VERSION_HEAD_CORRUPT', 'HEAD commit が不正です。');
  }
  if (typeof parsed.tree !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.tree)) throw createVersionControlError('SPEC_VERSION_HEAD_CORRUPT', 'HEAD tree が不正です。');
  return { commit, tree: parsed.tree, ref, unborn: false };
}
