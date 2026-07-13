'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const fse = require('fs-extra');
const {
  createTestWorkspace,
} = require('./helpers/create-test-workspace');
const { buildProject } = require('../scripts/lib/build-project');

describe('build outputDir override', () => {
  const workspaces = [];
  const temps = [];

  after(async () => {
    for (const ws of workspaces) {
      // eslint-disable-next-line no-await-in-loop
      await ws.cleanup();
    }
    for (const dir of temps) {
      // eslint-disable-next-line no-await-in-loop
      await fse.remove(dir).catch(() => {});
    }
  });

  it('outputDir 上書き時は temp に書き、workspace dist は触らない', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);

    const tempOut = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-output-override-')
    );
    temps.push(tempOut);

    const workspaceDist = path.join(ws.workspaceRoot, 'dist', 'sample');
    assert.equal(fs.existsSync(workspaceDist), false);

    const result = await buildProject('sample', {
      workspaceRoot: ws.workspaceRoot,
      outputDir: tempOut,
      preserveScreenSpecAttributes: true,
      log: false,
    });

    assert.equal(result.project.outputDir, path.resolve(tempOut));
    assert.ok(fs.existsSync(path.join(tempOut, 'index.html')));
    assert.equal(
      fs.existsSync(path.join(workspaceDist, 'index.html')),
      false,
      'config の dist/sample には書かない'
    );
  });
});
