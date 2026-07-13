'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStaticServer } = require('../scripts/lib/create-static-server');
const { createSpecMount } = require('../scripts/lib/create-spec-mount');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest } = require('./helpers/http-request');

describe('createSpecMount', () => {
  /** @type {Array<{ stop: Function, cleanup: Function }>} */
  const servers = [];

  after(async () => {
    for (const entry of servers) {
      // eslint-disable-next-line no-await-in-loop
      await entry.stop().catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await entry.cleanup().catch(() => {});
    }
  });

  async function startFixtureServer() {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-spec-mount-')
    );
    const outputDir = path.join(workspaceRoot, 'dist', 'sample');
    const specDistDir = path.join(workspaceRoot, 'spec', 'sample', 'dist');

    await fsp.mkdir(path.join(outputDir, 'assets'), { recursive: true });
    await fsp.mkdir(path.join(specDistDir, 'assets'), { recursive: true });
    await fsp.mkdir(path.join(specDistDir, 'data'), { recursive: true });

    await fsp.writeFile(
      path.join(outputDir, 'index.html'),
      '<!DOCTYPE html><html><body>SAMPLE_OK</body></html>\n',
      'utf8'
    );
    await fsp.writeFile(
      path.join(specDistDir, 'index.html'),
      '<!DOCTYPE html><html><body>SPEC_INDEX_OK</body></html>\n',
      'utf8'
    );
    await fsp.writeFile(
      path.join(specDistDir, 'assets', 'app.js'),
      'window.__SPEC__=1;\n',
      'utf8'
    );
    await fsp.writeFile(
      path.join(specDistDir, 'data', 'manifest.json'),
      JSON.stringify({ projectName: 'sample', screens: [] }),
      'utf8'
    );

    const port = await getFreePort();
    const specMount = createSpecMount({
      workspaceRoot,
      projectName: 'sample',
      specDistDir,
    });
    const server = createStaticServer({
      rootDir: outputDir,
      host: '127.0.0.1',
      port,
      projectName: 'sample',
      handleInternalRequest: specMount.handleRequest,
    });
    await server.start();

    const entry = {
      port,
      stop: () => server.stop(),
      cleanup: () => fsp.rm(workspaceRoot, { recursive: true, force: true }),
    };
    servers.push(entry);
    return entry;
  }

  it('Phase 4A §14 の /spec/ 経路を正しく提供する', async () => {
    const { port } = await startFixtureServer();

    const root = await httpRequest({ port, path: '/' });
    assert.equal(root.status, 200);
    assert.match(root.body.toString('utf8'), /SAMPLE_OK/);

    const specRoot = await httpRequest({ port, path: '/spec/' });
    assert.equal(specRoot.status, 200);
    assert.match(specRoot.body.toString('utf8'), /SPEC_INDEX_OK/);

    const spa = await httpRequest({ port, path: '/spec/screens/crud-create' });
    assert.equal(spa.status, 200);
    assert.match(spa.body.toString('utf8'), /SPEC_INDEX_OK/);

    const manifest = await httpRequest({
      port,
      path: '/spec/data/manifest.json',
    });
    assert.equal(manifest.status, 200);
    assert.match(String(manifest.headers['content-type']), /application\/json/);
    assert.match(manifest.body.toString('utf8'), /"projectName":"sample"/);

    const asset = await httpRequest({ port, path: '/spec/assets/app.js' });
    assert.equal(asset.status, 200);
    assert.match(
      String(asset.headers['content-type']),
      /application\/javascript/
    );
    assert.match(asset.body.toString('utf8'), /__SPEC__/);

    const missingAsset = await httpRequest({
      port,
      path: '/spec/assets/missing.js',
    });
    assert.equal(missingAsset.status, 404);

    const missingData = await httpRequest({
      port,
      path: '/spec/data/missing.json',
    });
    assert.equal(missingData.status, 404);

    const notSpec = await httpRequest({ port, path: '/specification' });
    assert.equal(notSpec.status, 404);
    assert.equal(notSpec.body.toString('utf8').includes('SPEC_INDEX_OK'), false);

    // URL 正規化で / になり /spec 扱いしない
    const traversal = await httpRequest({ port, path: '/spec/../' });
    assert.equal(traversal.status, 200);
    assert.match(traversal.body.toString('utf8'), /SAMPLE_OK/);
    assert.equal(
      traversal.body.toString('utf8').includes('SPEC_INDEX_OK'),
      false
    );

    const redirect = await httpRequest({ port, path: '/spec' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.location, '/spec/');
  });
});
