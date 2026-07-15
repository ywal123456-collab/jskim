'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWatchRuntime } = require('../scripts/lib/create-watch-runtime');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest } = require('./helpers/http-request');

describe('Description edit API は spec dev 専用', () => {
  /** @type {Array<{ close: Function, cleanup: Function }>} */
  const sessions = [];

  after(async () => {
    for (const entry of sessions) {
      // eslint-disable-next-line no-await-in-loop
      await entry.close().catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await entry.cleanup().catch(() => {});
    }
  });

  async function createWorkspace() {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-edit-scope-')
    );
    const pagesDir = path.join(workspaceRoot, 'src', 'sample', 'pages');
    const layoutsDir = path.join(workspaceRoot, 'src', 'sample', 'layouts');
    const specDist = path.join(workspaceRoot, 'spec', 'sample', 'dist');
    await fsp.mkdir(pagesDir, { recursive: true });
    await fsp.mkdir(layoutsDir, { recursive: true });
    await fsp.mkdir(specDist, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, 'jskim.config.js'),
      `module.exports = {
  defaults: {
    files: [{ from: 'pages', to: '' }],
    templates: ['layouts'],
    build: { clean: true },
    watch: { debounce: 50 },
    serve: { host: '127.0.0.1', port: 34567 },
    dev: { liveReload: true },
  },
  projects: {
    sample: {
      sourceDir: 'src/sample',
      outputDir: 'dist/sample',
    },
  },
};
`,
      'utf8'
    );
    await fsp.writeFile(
      path.join(layoutsDir, 'base.njk'),
      '<!DOCTYPE html><html><body>{% block body %}{% endblock %}</body></html>\n',
      'utf8'
    );
    await fsp.writeFile(
      path.join(pagesDir, 'index.html.njk'),
      '{% extends "base.njk" %}{% block body %}APP_OK{% endblock %}\n',
      'utf8'
    );
    await fsp.writeFile(
      path.join(specDist, 'index.html'),
      '<!DOCTYPE html><html><body>SPEC</body></html>\n',
      'utf8'
    );
    return workspaceRoot;
  }

  it('通常の jskim dev では編集 API が無い', async () => {
    const workspaceRoot = await createWorkspace();
    const port = await getFreePort();
    const runtime = createWatchRuntime({
      mode: 'dev',
      workspaceRoot,
      projectName: 'sample',
      commandName: 'dev',
      usageLine: 'jskim dev',
      cliOverrides: { host: '127.0.0.1', port, open: false },
      openBrowserFn: () => ({ ok: true }),
      initialDevLog: false,
    });
    sessions.push({
      close: () => runtime.close(),
      cleanup: () => fsp.rm(workspaceRoot, { recursive: true, force: true }),
    });
    await runtime.start();

    const getRes = await httpRequest({
      port,
      path: '/_jskim/spec/descriptions/demo',
    });
    assert.notEqual(getRes.status, 200);

    const putRes = await httpRequest({
      port,
      method: 'PUT',
      path: '/_jskim/spec/descriptions/demo',
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
      },
      body: JSON.stringify({
        expectedRevision: 'sha256:x',
        document: {
          schemaVersion: '1.0',
          screen: { id: 'demo', name: 'x', description: '' },
          items: {},
        },
      }),
    });
    assert.notEqual(putRes.status, 200);

    const spec = await httpRequest({ port, path: '/spec/' });
    assert.equal(spec.status, 200);
    assert.doesNotMatch(spec.body.toString('utf8'), /__JSKIM_SPEC_EDIT__/);
  });
});
