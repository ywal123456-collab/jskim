'use strict';

/**
 * Phase 7B-3B-1: TEMP sample で Description を消したあと
 * collect しても JSON が再生成されないことを確認する。
 */

const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const fse = require('fs-extra');
const { pathToFileURL } = require('node:url');
const { REPO_ROOT } = require('./helpers/create-test-workspace');
const { loadConfig } = require('../scripts/lib/load-config');
const { resolveProject } = require('../scripts/lib/resolve-project');
const { runScreenSpecCollect } = require('../scripts/lib/run-screen-spec-collect');

const COMPANION_ENTRY = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js'
);

describe('IMPLEMENTATION_ONLY collect（Description 自動生成なし）', () => {
  /** @type {string[]} */
  const temps = [];
  /** @type {object|null} */
  let companion = null;

  before(async () => {
    companion = await import(pathToFileURL(COMPANION_ENTRY).href);
  });

  after(async () => {
    for (const dir of temps) {
      // eslint-disable-next-line no-await-in-loop
      await fse.remove(dir).catch(() => {});
    }
  });

  it(
    'TEMP sample: Description 削除後の collect は JSON を再作成せず実装のみを維持する',
    { timeout: 180000 },
    async () => {
      const workspaceRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'jskim-impl-only-collect-')
      );
      temps.push(workspaceRoot);

      await fse.copy(
        path.join(REPO_ROOT, 'jskim.config.js'),
        path.join(workspaceRoot, 'jskim.config.js')
      );
      await fse.copy(
        path.join(REPO_ROOT, 'src/sample'),
        path.join(workspaceRoot, 'src/sample')
      );
      await fse.copy(
        path.join(REPO_ROOT, 'spec/sample/src'),
        path.join(workspaceRoot, 'spec/sample/src')
      );

      const screenId = 'crud-create';
      const descPath = path.join(
        workspaceRoot,
        'spec',
        'sample',
        'src',
        'data',
        `${screenId}.json`
      );
      assert.equal(fs.existsSync(descPath), true);
      await fsp.unlink(descPath);
      assert.equal(fs.existsSync(descPath), false);

      const { config } = loadConfig(workspaceRoot);
      const project = resolveProject({
        config,
        workspaceRoot,
        projectName: 'sample',
        commandName: 'spec collect',
      });

      const collectResult = await runScreenSpecCollect({
        project,
        workspaceRoot,
        projectName: 'sample',
        collectScreenSpecProject: companion.collectScreenSpecProject,
        log: false,
      });
      assert.ok(collectResult.screens >= 1);
      assert.equal(fs.existsSync(descPath), false);

      const loaded = companion.loadScreenSpecProject({
        rootDir: workspaceRoot,
        projectName: 'sample',
      });
      const screen = loaded.screens.find((s) => s.screenId === screenId);
      assert.ok(screen);
      assert.equal(screen.status, 'implementation-only');
      assert.equal(screen.hasPreview, true);

      const again = await runScreenSpecCollect({
        project,
        workspaceRoot,
        projectName: 'sample',
        collectScreenSpecProject: companion.collectScreenSpecProject,
        log: false,
      });
      assert.ok(again.screens >= 1);
      assert.equal(fs.existsSync(descPath), false);
      assert.equal(
        companion
          .loadScreenSpecProject({
            rootDir: workspaceRoot,
            projectName: 'sample',
          })
          .screens.find((s) => s.screenId === screenId)?.status,
        'implementation-only'
      );

      const store = companion.createFileDescriptionStore({
        rootDir: workspaceRoot,
        projectName: 'sample',
        listScreenIds: () =>
          companion
            .loadScreenSpecProject({
              rootDir: workspaceRoot,
              projectName: 'sample',
            })
            .screens.map((s) => s.screenId),
      });
      const getState = store.read(screenId);
      assert.equal(getState.exists, false);
      assert.equal(getState.document.schemaVersion, '1.2');
      assert.ok(Object.keys(getState.document.items).length > 0);

      const nextDoc = structuredClone(getState.document);
      nextDoc.screen.name = '実装のみから復元';
      const put = store.write(screenId, nextDoc, getState.revision);
      assert.equal(put.written, true);
      assert.equal(fs.existsSync(descPath), true);
      assert.equal(
        companion
          .loadScreenSpecProject({
            rootDir: workspaceRoot,
            projectName: 'sample',
          })
          .screens.find((s) => s.screenId === screenId)?.status,
        'linked'
      );
    }
  );
});
