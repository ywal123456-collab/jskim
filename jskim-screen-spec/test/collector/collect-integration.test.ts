import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { collectScreenSpecProject } from '../../src/collector/collect-screen-spec-project.js';
import { isSpecCollectError } from '../../src/collector/collector-errors.js';
import { loadScreenSpecProject } from '../../src/builder/load-screen-spec-project.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '../..');
const repoRoot = path.resolve(packageRoot, '..');
const fixtureRoot = path.join(
  packageRoot,
  'test/fixtures/collector-actions',
);

const { getFreePort } = require(
  path.join(repoRoot, 'scripts/lib/get-free-port.js'),
) as { getFreePort: () => Promise<number> };

const { createStaticServer } = require(
  path.join(repoRoot, 'scripts/lib/create-static-server.js'),
) as {
  createStaticServer: (opts: {
    rootDir: string;
    host: string;
    port: number;
    projectName?: string;
  }) => {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    url: string;
  };
};

type TempLayout = {
  rootDir: string;
  descriptionPath: string;
  snapshotsDir: string;
};

function createTempProjectLayout(options?: {
  badTarget?: boolean;
  /** false のとき Description JSON を置かない（IMPLEMENTATION_ONLY） */
  withDescription?: boolean;
}): TempLayout {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-collect-'));
  const pagesDir = path.join(rootDir, 'src/demo/pages');
  const dataDir = path.join(rootDir, 'spec/demo/src/data');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const source = JSON.parse(
    fs.readFileSync(path.join(fixtureRoot, 'source.spec.json'), 'utf8'),
  ) as {
    states: Array<{
      id: string;
      collect?: { actions?: Array<{ type: string; target?: string }> };
    }>;
  };

  if (options?.badTarget) {
    const help = source.states.find((s) => s.id === 'help-modal');
    if (help?.collect?.actions?.[0]) {
      help.collect.actions[0].target = 'missing-target';
    }
  }

  fs.writeFileSync(
    path.join(pagesDir, 'demo.spec.json'),
    `${JSON.stringify(source, null, 2)}\n`,
  );
  const descriptionPath = path.join(dataDir, 'collector-actions-demo.json');
  if (options?.withDescription !== false) {
    fs.copyFileSync(
      path.join(fixtureRoot, 'description.json'),
      descriptionPath,
    );
  }

  return {
    rootDir,
    descriptionPath,
    snapshotsDir: path.join(
      rootDir,
      'spec/demo/src/snapshots/collector-actions-demo',
    ),
  };
}

describe('collectScreenSpecProject integration', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) {
        await fn();
      }
    }
  });

  it('actions を実行して snapshot を書き込み、再収集で unchanged になる', async () => {
    const layout = createTempProjectLayout();
    const port = await getFreePort();
    const server = createStaticServer({
      rootDir: path.join(fixtureRoot, 'public'),
      host: '127.0.0.1',
      port,
      projectName: 'collector-fixture',
    });
    await server.start();
    cleanups.push(async () => {
      await server.stop();
      fs.rmSync(layout.rootDir, { recursive: true, force: true });
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    const first = await collectScreenSpecProject({
      rootDir: layout.rootDir,
      projectName: 'demo',
      baseUrl,
    });

    expect(first.screens).toBe(1);
    expect(first.states).toBe(4);
    expect(first.updated).toBe(4);
    expect(first.unchanged).toBe(0);
    expect(first.browserName).toBe('chromium');
    expect(first.browserVersion.length).toBeGreaterThan(0);
    expect(
      first.warnings.some((w) => w.includes('orphan-legacy-item')),
    ).toBe(true);

    const filled = fs.readFileSync(
      path.join(layout.snapshotsDir, 'filled.html'),
      'utf8',
    );
    expect(filled).toContain('value="山田太郎"');
    expect(filled).toContain('selected');
    expect(filled).toMatch(/value="corporation"[^>]*selected|selected[^>]*value="corporation"/);
    expect(filled).toContain('checked');

    const help = fs.readFileSync(
      path.join(layout.snapshotsDir, 'help-modal.html'),
      'utf8',
    );
    expect(help).toContain('is-open');

    const details = fs.readFileSync(
      path.join(layout.snapshotsDir, 'details-open.html'),
      'utf8',
    );
    expect(details).toMatch(/<details[^>]*\sopen/);

    const description = JSON.parse(
      fs.readFileSync(layout.descriptionPath, 'utf8'),
    ) as {
      items: Record<string, { description?: string; note?: string }>;
    };
    expect(description.items['page-title'].description).toBe(
      '画面タイトルです。',
    );
    expect(description.items['page-title'].note).toBe('保持される説明文');
    expect(description.items['orphan-legacy-item'].description).toContain(
      'orphan',
    );
    expect(description.items['open-help']).toBeTruthy();

    const second = await collectScreenSpecProject({
      rootDir: layout.rootDir,
      projectName: 'demo',
      baseUrl,
    });
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(4);
  }, 60000);

  it('不正 target ではエラーになり、既存 snapshot を壊さない', async () => {
    const layout = createTempProjectLayout({ badTarget: true });
    fs.mkdirSync(layout.snapshotsDir, { recursive: true });
    const preservedPath = path.join(layout.snapshotsDir, 'default.html');
    const preservedHtml = '<main data-jskim-spec-screen="collector-actions-demo">preserved</main>\n';
    fs.writeFileSync(preservedPath, preservedHtml);

    const port = await getFreePort();
    const server = createStaticServer({
      rootDir: path.join(fixtureRoot, 'public'),
      host: '127.0.0.1',
      port,
      projectName: 'collector-fixture',
    });
    await server.start();
    cleanups.push(async () => {
      await server.stop();
      fs.rmSync(layout.rootDir, { recursive: true, force: true });
    });

    try {
      await collectScreenSpecProject({
        rootDir: layout.rootDir,
        projectName: 'demo',
        baseUrl: `http://127.0.0.1:${port}`,
      });
      expect.unreachable('エラーになるはず');
    } catch (err) {
      expect(isSpecCollectError(err)).toBe(true);
      if (isSpecCollectError(err)) {
        expect(err.code).toBe('SPEC_COLLECT_ACTION_TARGET_NOT_FOUND');
        expect(err.message).toContain('missing-target');
      }
    }

    expect(fs.readFileSync(preservedPath, 'utf8')).toBe(preservedHtml);
    expect(fs.existsSync(path.join(layout.snapshotsDir, 'filled.html'))).toBe(
      false,
    );
  }, 60000);

  it('Description が無い画面は snapshot だけ更新し JSON を自動生成しない', async () => {
    const layout = createTempProjectLayout({ withDescription: false });
    const port = await getFreePort();
    const server = createStaticServer({
      rootDir: path.join(fixtureRoot, 'public'),
      host: '127.0.0.1',
      port,
      projectName: 'collector-fixture',
    });
    await server.start();
    cleanups.push(async () => {
      await server.stop();
      fs.rmSync(layout.rootDir, { recursive: true, force: true });
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    const first = await collectScreenSpecProject({
      rootDir: layout.rootDir,
      projectName: 'demo',
      baseUrl,
    });

    expect(first.screens).toBe(1);
    expect(first.states).toBe(4);
    expect(first.updated).toBe(4);
    expect(fs.existsSync(layout.descriptionPath)).toBe(false);
    expect(
      fs.existsSync(path.join(layout.snapshotsDir, 'default.html')),
    ).toBe(true);

    const loaded = loadScreenSpecProject({
      rootDir: layout.rootDir,
      projectName: 'demo',
    });
    expect(
      loaded.screens.find((s) => s.screenId === 'collector-actions-demo')
        ?.status,
    ).toBe('implementation-only');

    const second = await collectScreenSpecProject({
      rootDir: layout.rootDir,
      projectName: 'demo',
      baseUrl,
    });
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(4);
    expect(fs.existsSync(layout.descriptionPath)).toBe(false);
  }, 60000);

  it('LINKED Description を削除したあと collect しても再作成しない', async () => {
    const layout = createTempProjectLayout();
    const port = await getFreePort();
    const server = createStaticServer({
      rootDir: path.join(fixtureRoot, 'public'),
      host: '127.0.0.1',
      port,
      projectName: 'collector-fixture',
    });
    await server.start();
    cleanups.push(async () => {
      await server.stop();
      fs.rmSync(layout.rootDir, { recursive: true, force: true });
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await collectScreenSpecProject({
      rootDir: layout.rootDir,
      projectName: 'demo',
      baseUrl,
    });
    expect(fs.existsSync(layout.descriptionPath)).toBe(true);

    fs.unlinkSync(layout.descriptionPath);
    expect(fs.existsSync(layout.descriptionPath)).toBe(false);

    const afterDelete = await collectScreenSpecProject({
      rootDir: layout.rootDir,
      projectName: 'demo',
      baseUrl,
    });
    expect(afterDelete.screens).toBe(1);
    expect(fs.existsSync(layout.descriptionPath)).toBe(false);

    const loaded = loadScreenSpecProject({
      rootDir: layout.rootDir,
      projectName: 'demo',
    });
    expect(
      loaded.screens.find((s) => s.screenId === 'collector-actions-demo')
        ?.status,
    ).toBe('implementation-only');
  }, 60000);
});
