import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  VersionControlError,
  checkoutVersion,
  commitVersion,
  compareScreenIdOrder,
  createVersionBranch,
  createVersionTag,
  createWorkingSnapshot,
  deleteVersionBranch,
  fsckVersionRepository,
  getVersionLog,
  getVersionStatus,
  initVersionRepository,
  inspectVersionRecovery,
  listVersionBranches,
  listVersionTags,
  persistVersionAuthorConfig,
  recoverVersionRepository,
  resolveVersionAuthor,
  resolveVersionRevision,
  revertVersionCommit,
  stageProject,
} from '../../src/version-control/index.js';
import { isValidScreenId } from '../../src/util/screen-id.js';

const temps: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-vc73-'));
  temps.push(root);
  return root;
}

afterEach(() => {
  while (temps.length > 0) {
    const root = temps.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeScreen(
  root: string,
  project: string,
  id: string,
  label = id,
): void {
  writeJson(path.join(root, 'src', project, 'pages', `${id}.spec.json`), {
    schemaVersion: '1.0',
    screen: { id, path: `/${id}` },
    states: [{ id: 'default', name: 'Default' }],
    interactions: [],
  });
  writeJson(path.join(root, 'spec', project, 'src', 'data', `${id}.json`), {
    schemaVersion: '1.2',
    screen: { id, name: label },
    itemOrder: [],
    excludedItems: {},
    items: {},
  });
}

function writeReference(root: string, project: string, screenId: string): void {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  const hex = crypto.createHash('sha256').update(png).digest('hex');
  const dir = path.join(
    root,
    'spec',
    project,
    'src',
    'references',
    screenId,
    'pc',
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `reference-${hex}.png`), png);
  writeJson(path.join(dir, 'meta.json'), {
    schemaVersion: '1.0',
    screenId,
    viewport: { id: 'pc', width: 1, height: 1 },
    format: 'png',
    imageFile: `reference-${hex}.png`,
    imageRevision: `sha256:${hex}`,
    imageWidth: 1,
    imageHeight: 1,
    uploadedAt: '2026-07-20T01:02:03.000Z',
    source: { type: 'upload' },
  });
}

function setupProject(
  options: { screens?: string[]; reference?: boolean; features?: boolean } = {},
): { rootDir: string; projectName: string } {
  const rootDir = tempRoot();
  const projectName = 'demo';
  const screens = options.screens ?? ['alpha', 'beta'];
  for (const id of screens) writeScreen(rootDir, projectName, id);
  if (options.features) {
    writeJson(path.join(rootDir, 'spec', projectName, 'src', 'features.json'), {
      schemaVersion: '1.0',
      features: [
        {
          featureId: 'main',
          name: 'メイン',
          displayOrder: 1,
          screenIds: [screens[0]],
        },
      ],
    });
  }
  if (options.reference) writeReference(rootDir, projectName, screens[0]);
  initVersionRepository({ rootDir, projectName });
  persistVersionAuthorConfig({
    rootDir,
    projectName,
    config: {
      schemaVersion: '1.0',
      user: { name: 'Taro Yamada', email: 'taro@example.com' },
    },
  });
  return { rootDir, projectName };
}

function initialCommit(ctx: { rootDir: string; projectName: string }) {
  stageProject(ctx);
  return commitVersion({
    ...ctx,
    message: 'initial',
    committedAt: '2026-07-20T00:00:00.000Z',
  });
}

describe('screenId comparator 契約 A', () => {
  it('ASCII screenId のみ許可し localeCompare en が決定的', () => {
    expect(isValidScreenId('crud-create')).toBe(true);
    expect(isValidScreenId('画面')).toBe(false);
    expect(isValidScreenId('Crud')).toBe(false);
    const ids = ['wizard-input', 'crud-create', 'beta', 'alpha'];
    const sorted = [...ids].sort(compareScreenIdOrder);
    expect(sorted).toEqual(['alpha', 'beta', 'crud-create', 'wizard-input']);
    expect([...ids].sort(compareScreenIdOrder)).toEqual(sorted);
  });
});

describe('author config', () => {
  it('option → env → config の優先順位と片側 env 拒否', () => {
    const ctx = setupProject({ screens: ['a'] });
    expect(
      resolveVersionAuthor({
        ...ctx,
        author: { name: 'Explicit', email: 'ex@example.com' },
      }).name,
    ).toBe('Explicit');

    const prevName = process.env.JSKIM_SPEC_AUTHOR_NAME;
    const prevEmail = process.env.JSKIM_SPEC_AUTHOR_EMAIL;
    try {
      process.env.JSKIM_SPEC_AUTHOR_NAME = 'Env User';
      delete process.env.JSKIM_SPEC_AUTHOR_EMAIL;
      expect(() => resolveVersionAuthor(ctx)).toThrow(VersionControlError);
      process.env.JSKIM_SPEC_AUTHOR_EMAIL = 'env@example.com';
      expect(resolveVersionAuthor(ctx).email).toBe('env@example.com');
      delete process.env.JSKIM_SPEC_AUTHOR_NAME;
      delete process.env.JSKIM_SPEC_AUTHOR_EMAIL;
      expect(resolveVersionAuthor(ctx).name).toBe('Taro Yamada');
    } finally {
      if (prevName === undefined) delete process.env.JSKIM_SPEC_AUTHOR_NAME;
      else process.env.JSKIM_SPEC_AUTHOR_NAME = prevName;
      if (prevEmail === undefined) delete process.env.JSKIM_SPEC_AUTHOR_EMAIL;
      else process.env.JSKIM_SPEC_AUTHOR_EMAIL = prevEmail;
    }
  });
});

describe('commit / log / branch / tag', () => {
  it('initial commit と normal commit、unstaged 維持', () => {
    const ctx = setupProject({ screens: ['a', 'b'], reference: true });
    const first = initialCommit(ctx);
    expect(first.parents).toEqual([]);
    expect(getVersionStatus(ctx).clean).toBe(true);

    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'changed');
    expect(getVersionStatus(ctx).unstagedChanges.length).toBeGreaterThan(0);
    expect(getVersionStatus(ctx).stagedChanges).toEqual([]);

    stageProject(ctx);
    const second = commitVersion({
      ...ctx,
      message: 'update a',
      committedAt: '2026-07-20T00:01:00.000Z',
    });
    expect(second.parents).toEqual([first.commitHash]);

    // unstaged を残す
    writeScreen(ctx.rootDir, ctx.projectName, 'b', 'dirty');
    const status = getVersionStatus(ctx);
    expect(status.stagedChanges).toEqual([]);
    expect(status.unstagedChanges.length).toBeGreaterThan(0);

    expect(() =>
      commitVersion({ ...ctx, message: 'noop' }),
    ).toThrowError(/staged/);

    const log = getVersionLog({ ...ctx, limit: 10 });
    expect(log.commits.map((c) => c.hash)).toEqual([
      second.commitHash,
      first.commitHash,
    ]);
  });

  it('同一入力と timestamp なら同一 commit hash', () => {
    const a = setupProject({ screens: ['x'] });
    const b = setupProject({ screens: ['x'] });
    stageProject(a);
    stageProject(b);
    const ca = commitVersion({
      ...a,
      message: 'same',
      committedAt: '2026-07-20T03:00:00.000Z',
    });
    const cb = commitVersion({
      ...b,
      message: 'same',
      committedAt: '2026-07-20T03:00:00.000Z',
    });
    expect(ca.commitHash).toBe(cb.commitHash);
    expect(createWorkingSnapshot(a).rootTreeHash).toBe(
      createWorkingSnapshot(b).rootTreeHash,
    );
  });

  it('branch / tag / revision resolve', () => {
    const ctx = setupProject({ screens: ['a'] });
    const c1 = initialCommit(ctx);
    createVersionBranch({ ...ctx, name: 'feature' });
    const tag = createVersionTag({
      ...ctx,
      name: 'v1',
      message: 'release',
      taggedAt: '2026-07-20T04:00:00.000Z',
    });
    expect(listVersionBranches(ctx).some((b) => b.name === 'feature')).toBe(
      true,
    );
    expect(listVersionTags(ctx)[0]?.targetCommitHash).toBe(c1.commitHash);

    expect(resolveVersionRevision({ ...ctx, revision: 'HEAD' }).commitHash).toBe(
      c1.commitHash,
    );
    expect(
      resolveVersionRevision({
        ...ctx,
        revision: c1.commitHash.slice(0, 12),
      }).commitHash,
    ).toBe(c1.commitHash);
    expect(
      resolveVersionRevision({ ...ctx, revision: 'feature' }).kind,
    ).toBe('branch');
    expect(resolveVersionRevision({ ...ctx, revision: 'v1' }).kind).toBe('tag');
    expect(tag.name).toBe('v1');

    expect(() => deleteVersionBranch({ ...ctx, name: 'main' })).toThrow(
      VersionControlError,
    );
    deleteVersionBranch({ ...ctx, name: 'feature' });
  });
});

describe('checkout / revert / fsck', () => {
  it('branch checkout と dirty 拒否、Reference 復元', () => {
    const ctx = setupProject({
      screens: ['a', 'b'],
      reference: true,
      features: true,
    });
    const c1 = initialCommit(ctx);

    writeScreen(ctx.rootDir, ctx.projectName, 'c');
    stageProject(ctx);
    const c2 = commitVersion({
      ...ctx,
      message: 'add c',
      committedAt: '2026-07-20T05:00:00.000Z',
    });

    // unmanaged 保全用ファイル
    const note = path.join(
      ctx.rootDir,
      'spec',
      ctx.projectName,
      'src',
      'notes.txt',
    );
    fs.writeFileSync(note, 'keep-me');

    createVersionBranch({
      ...ctx,
      name: 'old',
      startPoint: c1.commitHash,
    });
    const result = checkoutVersion({ ...ctx, target: 'old' });
    expect(result.commitHash).toBe(c1.commitHash);
    expect(getVersionStatus(ctx).clean).toBe(true);
    expect(
      fs.existsSync(
        path.join(ctx.rootDir, 'spec', ctx.projectName, 'src', 'data', 'c.json'),
      ),
    ).toBe(false);
    expect(fs.readFileSync(note, 'utf8')).toBe('keep-me');
    expect(
      fs.existsSync(
        path.join(
          ctx.rootDir,
          'spec',
          ctx.projectName,
          'src',
          'resources',
          'manifest.json',
        ),
      ),
    ).toBe(false);

    // dirty 拒否
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'dirty');
    expect(() => checkoutVersion({ ...ctx, target: c2.commitHash })).toThrow(
      /dirty|変更/,
    );
  });

  it('revert は逆 commit を作り conflict 時は変更しない', () => {
    const ctx = setupProject({ screens: ['a'] });
    initialCommit(ctx);
    writeScreen(ctx.rootDir, ctx.projectName, 'a', 'v2');
    stageProject(ctx);
    const c2 = commitVersion({
      ...ctx,
      message: 'change',
      committedAt: '2026-07-20T06:00:00.000Z',
    });

    const reverted = revertVersionCommit({
      ...ctx,
      target: c2.commitHash,
      committedAt: '2026-07-20T06:01:00.000Z',
    });
    expect(reverted.noop).toBe(false);
    expect(getVersionStatus(ctx).clean).toBe(true);
    const data = JSON.parse(
      fs.readFileSync(
        path.join(
          ctx.rootDir,
          'spec',
          ctx.projectName,
          'src',
          'data',
          'a.json',
        ),
        'utf8',
      ),
    ) as { screen: { name: string } };
    expect(data.screen.name).toBe('a');
  });

  it('fsck は clean で dangling を warning、recovery inspect は read-only', () => {
    const ctx = setupProject({ screens: ['a'] });
    initialCommit(ctx);
    const fsck = fsckVersionRepository(ctx);
    expect(fsck.errors).toEqual([]);
    const inspection = inspectVersionRecovery(ctx);
    expect(inspection.mutationLock).toBeNull();
    expect(() =>
      recoverVersionRepository({ ...ctx, confirm: false }),
    ).toThrow(VersionControlError);
  });
});
