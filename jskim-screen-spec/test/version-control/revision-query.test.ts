import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  VersionControlError,
  commitVersion,
  getBrowserVersionRevisionDetail,
  getBrowserVersionStatus,
  initVersionRepository,
  listBrowserVersionFeatures,
  listBrowserVersionRevisions,
  persistVersionAuthorConfig,
  stageProject,
} from '../../src/version-control/index.js';

const temps: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-revq-'));
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
  options: {
    name?: string;
    items?: Record<string, Record<string, string>>;
    itemOrder?: string[];
  } = {},
): void {
  writeJson(path.join(root, 'src', project, 'pages', `${id}.spec.json`), {
    schemaVersion: '1.0',
    screen: { id, path: `/${id}` },
    states: [{ id: 'default', name: 'Default' }],
    interactions: [],
  });
  writeJson(path.join(root, 'spec', project, 'src', 'data', `${id}.json`), {
    schemaVersion: '1.2',
    screen: { id, name: options.name ?? id },
    itemOrder: options.itemOrder ?? Object.keys(options.items ?? {}),
    excludedItems: {},
    items: options.items ?? {},
  });
}

function writeFigmaReference(
  root: string,
  project: string,
  screenId: string,
): void {
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
    source: {
      type: 'figma',
      fileKey: 'SECRET_FILE_KEY',
      nodeId: '1:2',
      frameName: 'Frame A',
      importedAt: '2026-07-20T01:02:03.000Z',
      exportScale: 1,
    },
  });
}

function setupBase(): { rootDir: string; projectName: string } {
  const rootDir = tempRoot();
  const projectName = 'demo';
  writeScreen(rootDir, projectName, 'alpha', {
    items: {
      email: {
        name: 'メール',
        type: 'text',
        description: 'メールアドレス',
        note: '',
      },
    },
  });
  writeScreen(rootDir, projectName, 'beta');
  writeJson(path.join(rootDir, 'spec', projectName, 'src', 'features.json'), {
    schemaVersion: '1.0',
    features: [
      {
        featureId: 'inquiry',
        name: '問い合わせ',
        displayOrder: 1,
        screenIds: ['alpha'],
      },
      {
        featureId: 'other',
        name: 'その他',
        displayOrder: 2,
        screenIds: ['beta'],
      },
    ],
  });
  initVersionRepository({ rootDir, projectName });
  persistVersionAuthorConfig({
    rootDir,
    projectName,
    config: {
      schemaVersion: '1.0',
      user: { name: '山田 太郎', email: 'secret-author@example.com' },
    },
  });
  return { rootDir, projectName };
}

function commitAll(
  options: { rootDir: string; projectName: string },
  message: string,
): string {
  stageProject(options);
  const result = commitVersion({ ...options, message });
  return result.commitHash;
}

function assertNoSecrets(value: unknown): void {
  const text = JSON.stringify(value);
  expect(text).not.toContain('secret-author@example.com');
  expect(text).not.toContain('SECRET_FILE_KEY');
  expect(text).not.toMatch(/"nodeId"/);
  expect(text).not.toContain('fileKey');
  expect(text).not.toMatch(/[A-Za-z]:\\\\/);
}

describe('revision-query domain', () => {
  it('未初期化は正常 status として返す', () => {
    const rootDir = tempRoot();
    const status = getBrowserVersionStatus({
      rootDir,
      projectName: 'missing',
    });
    expect(status).toEqual({
      initialized: false,
      capability: 'local-read-only',
    });
  });

  // 並列実行時の filesystem 競合で既定 5s を超えることがあるため、この複合 integration のみ明示する
  it(
    'project / screen / feature history と pagination / historyHead を扱う',
    () => {
    const ctx = setupBase();
    const c1 = commitAll(ctx, '初回登録');

    writeScreen(ctx.rootDir, ctx.projectName, 'alpha', {
      items: {
        email: {
          name: 'メール変更',
          type: 'text',
          description: '変更後',
          note: 'n',
        },
        phone: {
          name: '電話',
          type: 'text',
          description: '追加',
          note: '',
        },
      },
      itemOrder: ['email', 'phone'],
    });
    const c2 = commitAll(ctx, '画面説明を更新');

    writeJson(
      path.join(ctx.rootDir, 'spec', ctx.projectName, 'src', 'features.json'),
      {
        schemaVersion: '1.0',
        features: [
          {
            featureId: 'inquiry',
            name: '問い合わせ',
            displayOrder: 1,
            screenIds: [],
          },
          {
            featureId: 'other',
            name: 'その他',
            displayOrder: 2,
            screenIds: ['alpha', 'beta'],
          },
        ],
      },
    );
    const c3 = commitAll(ctx, '機能所属を移動');

    writeFigmaReference(ctx.rootDir, ctx.projectName, 'alpha');
    const c4 = commitAll(ctx, '参照画像を追加');

    const status = getBrowserVersionStatus(ctx);
    expect(status.initialized).toBe(true);
    if (status.initialized) {
      expect(status.head.commit).toBe(c4);
      expect(status.workingTree.clean).toBe(true);
    }

    const projectPage1 = listBrowserVersionRevisions({
      ...ctx,
      scope: 'project',
      limit: 2,
    });
    expect(projectPage1.historyHead).toBe(c4);
    expect(projectPage1.revisions).toHaveLength(2);
    expect(projectPage1.hasMore).toBe(true);
    expect(projectPage1.nextCursor).toBeTruthy();
    assertNoSecrets(projectPage1);
    expect(projectPage1.revisions[0]?.author.name).toBe('山田 太郎');

    const projectPage2 = listBrowserVersionRevisions({
      ...ctx,
      scope: 'project',
      limit: 2,
      cursor: projectPage1.nextCursor ?? undefined,
      historyHead: projectPage1.historyHead ?? undefined,
    });
    expect(projectPage2.revisions.length).toBeGreaterThanOrEqual(1);
    const allHashes = new Set([
      ...projectPage1.revisions.map((r) => r.hash),
      ...projectPage2.revisions.map((r) => r.hash),
    ]);
    expect(allHashes.has(c1)).toBe(true);
    expect(allHashes.has(c2)).toBe(true);

    expect(() =>
      listBrowserVersionRevisions({
        ...ctx,
        scope: 'project',
        cursor: projectPage1.nextCursor ?? undefined,
        historyHead: c1,
      }),
    ).toThrow(VersionControlError);

    const screenHist = listBrowserVersionRevisions({
      ...ctx,
      scope: 'screen',
      screenId: 'alpha',
      limit: 20,
    });
    expect(screenHist.revisions.some((r) => r.hash === c2)).toBe(true);
    expect(screenHist.revisions.some((r) => r.hash === c3)).toBe(true);
    expect(screenHist.revisions.some((r) => r.hash === c4)).toBe(true);

    const inquiryHist = listBrowserVersionRevisions({
      ...ctx,
      scope: 'feature',
      featureId: 'inquiry',
      limit: 20,
    });
    const otherHist = listBrowserVersionRevisions({
      ...ctx,
      scope: 'feature',
      featureId: 'other',
      limit: 20,
    });
    expect(inquiryHist.revisions.some((r) => r.hash === c3)).toBe(true);
    expect(otherHist.revisions.some((r) => r.hash === c3)).toBe(true);

    const detail = getBrowserVersionRevisionDetail({
      ...ctx,
      revision: c2,
    });
    expect(detail.author.name).toBe('山田 太郎');
    expect(detail.itemChanges.some((i) => i.itemId === 'phone' && i.kind === 'added')).toBe(
      true,
    );
    expect(
      detail.itemChanges.some(
        (i) =>
          i.itemId === 'email' &&
          i.kind === 'modified' &&
          i.changedFields?.includes('name'),
      ),
    ).toBe(true);
    assertNoSecrets(detail);

    const refDetail = getBrowserVersionRevisionDetail({
      ...ctx,
      revision: c4,
    });
    expect(refDetail.assetChanges.some((a) => a.assetType === 'reference')).toBe(
      true,
    );
    assertNoSecrets(refDetail);

    const features = listBrowserVersionFeatures(ctx);
    expect(features.features.some((f) => f.featureId === 'other')).toBe(true);
    assertNoSecrets(features);
  },
    10000,
  );

  it('過去にだけ存在する screen の履歴を取得できる', () => {
    const ctx = setupBase();
    writeScreen(ctx.rootDir, ctx.projectName, 'legacy');
    commitAll(ctx, 'legacy 追加');
    fs.rmSync(
      path.join(ctx.rootDir, 'spec', ctx.projectName, 'src', 'data', 'legacy.json'),
    );
    fs.rmSync(
      path.join(ctx.rootDir, 'src', ctx.projectName, 'pages', 'legacy.spec.json'),
    );
    commitAll(ctx, 'legacy 削除');

    const hist = listBrowserVersionRevisions({
      ...ctx,
      scope: 'screen',
      screenId: 'legacy',
      limit: 20,
    });
    expect(hist.revisions.length).toBeGreaterThanOrEqual(1);
  });
});
