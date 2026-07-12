'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fsp = require('node:fs/promises');
const fse = require('fs-extra');
const {
  createTestWorkspace,
} = require('./helpers/create-test-workspace');
const { runCli } = require('./helpers/run-cli');
const {
  assertCompatibleOutputDirs,
  classifyOutputDirRelation,
} = require('../scripts/lib/assert-output-dirs-compatible');

describe('build --all', { timeout: 60000 }, () => {
  const workspaces = [];

  after(async () => {
    for (const ws of workspaces) {
      // eslint-disable-next-line no-await-in-loop
      await ws.cleanup();
    }
  });

  it('2つの project を定義順に成功する', async () => {
    const ws = await createMultiProjectWorkspace();
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.bin,
      cwd: ws.workspaceRoot,
      args: ['build', '--all'],
      timeoutMs: 30000,
    });
    const result = await cli.waitForExit();
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /project "alpha" のbuildを開始します/);
    assert.match(result.output, /project "beta" のbuildを開始します/);
    assert.ok(
      result.output.indexOf('project "alpha"') <
        result.output.indexOf('project "beta"')
    );
    assert.match(result.output, /2件中2件のprojectのbuildが完了しました/);
    assert.ok(
      await pathExists(path.join(ws.workspaceRoot, 'dist/alpha/index.html'))
    );
    assert.ok(
      await pathExists(path.join(ws.workspaceRoot, 'dist/beta/index.html'))
    );
  });

  it('resolve 失敗があっても他 project の build を続ける', async () => {
    const ws = await createMultiProjectWorkspace({
      badProject: true,
    });
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.bin,
      cwd: ws.workspaceRoot,
      args: ['build', '--all'],
      timeoutMs: 30000,
    });
    const result = await cli.waitForExit();
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /失敗: /);
    assert.match(result.output, /- bad \(resolve\)/);
    assert.match(result.output, /project "alpha" のbuildを開始します/);
    assert.ok(
      await pathExists(path.join(ws.workspaceRoot, 'dist/alpha/index.html'))
    );
  });

  it('build 失敗があっても次の project を続ける', async () => {
    const ws = await createMultiProjectWorkspace();
    workspaces.push(ws);
    // alpha のテンプレートを壊す
    await fsp.writeFile(
      path.join(ws.workspaceRoot, 'src/alpha/pages/index.njk'),
      '{% extends "missing.njk" %}\n',
      'utf8'
    );

    const cli = runCli({
      scriptPath: ws.scripts.bin,
      cwd: ws.workspaceRoot,
      args: ['build', '--all'],
      timeoutMs: 30000,
    });
    const result = await cli.waitForExit();
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /- alpha \(build\)/);
    assert.match(result.output, /project "beta" のbuildを開始します/);
    assert.ok(
      await pathExists(path.join(ws.workspaceRoot, 'dist/beta/index.html'))
    );
  });

  it('project 0件はエラー', async () => {
    const ws = await createTestWorkspace();
    workspaces.push(ws);
    await fsp.writeFile(
      path.join(ws.workspaceRoot, 'jskim.config.js'),
      'module.exports = { defaults: {}, projects: {} };\n',
      'utf8'
    );

    const cli = runCli({
      scriptPath: ws.scripts.bin,
      cwd: ws.workspaceRoot,
      args: ['build', '--all'],
    });
    const result = await cli.waitForExit();
    assert.equal(result.code, 1);
    assert.match(result.output, /設定にprojectがありません/);
  });

  it('名前が all の project は positional で1件 build する', async () => {
    const ws = await createTestWorkspace({
      configOverrides: {
        projects: {
          all: {
            sourceDir: 'src/sample',
            outputDir: 'dist/all',
          },
        },
      },
    });
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.bin,
      cwd: ws.workspaceRoot,
      args: ['build', 'all'],
      timeoutMs: 20000,
    });
    const result = await cli.waitForExit();
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /ビルドが完了しました/);
    assert.ok(
      await pathExists(path.join(ws.workspaceRoot, 'dist/all/index.html'))
    );
  });

  it('同じ outputDir は build 前に中断し、既存成果を壊さない', async () => {
    const ws = await createMultiProjectWorkspace({
      sameOutput: true,
    });
    workspaces.push(ws);

    const sharedDir = path.join(ws.workspaceRoot, 'dist/shared');
    const sentinel = path.join(sharedDir, 'SENTINEL.txt');
    await fse.outputFile(sentinel, 'KEEP_ME\n', 'utf8');
    const beforeMtime = (await fsp.stat(sentinel)).mtimeMs;

    const cli = runCli({
      scriptPath: ws.scripts.bin,
      cwd: ws.workspaceRoot,
      args: ['build', '--all'],
      timeoutMs: 20000,
    });
    const result = await cli.waitForExit();
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /outputDirが衝突/);
    assert.equal(result.output.includes('のbuildを開始します'), false);
    assert.equal(await pathExists(sentinel), true);
    assert.equal(await fsp.readFile(sentinel, 'utf8'), 'KEEP_ME\n');
    assert.equal((await fsp.stat(sentinel)).mtimeMs, beforeMtime);
    assert.equal(await pathExists(path.join(sharedDir, 'index.html')), false);
  });

  it('入れ子 outputDir は衝突、類似 prefix は許可', async () => {
    assert.equal(
      classifyOutputDirRelation(
        path.resolve('dist/site'),
        path.resolve('dist/site/admin')
      ),
      'nested'
    );
    assert.equal(
      classifyOutputDirRelation(
        path.resolve('dist/site'),
        path.resolve('dist/site-admin')
      ),
      null
    );

    assert.throws(
      () =>
        assertCompatibleOutputDirs([
          { name: 'a', outputDir: path.resolve('dist/site') },
          { name: 'b', outputDir: path.resolve('dist/site/admin') },
        ]),
      /入れ子/
    );

    assert.doesNotThrow(() =>
      assertCompatibleOutputDirs([
        { name: 'a', outputDir: path.resolve('dist/site') },
        { name: 'b', outputDir: path.resolve('dist/site-admin') },
      ])
    );
  });

  if (process.platform === 'win32') {
    it('Windows では case 違いの同一 path を衝突とみなす', () => {
      assert.equal(
        classifyOutputDirRelation(
          path.resolve('dist/Sample'),
          path.resolve('dist/sample')
        ),
        'same'
      );
    });
  }

  it('thin wrapper の build.js --all も同じ', async () => {
    const ws = await createMultiProjectWorkspace();
    workspaces.push(ws);

    const cli = runCli({
      scriptPath: ws.scripts.build,
      cwd: ws.workspaceRoot,
      args: ['--all'],
      timeoutMs: 30000,
    });
    const result = await cli.waitForExit();
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /2件中2件/);
  });
});

/**
 * @param {{ badProject?: boolean, sameOutput?: boolean }} [options]
 */
async function createMultiProjectWorkspace(options = {}) {
  const ws = await createTestWorkspace();
  await fse.copy(
    path.join(ws.workspaceRoot, 'src/sample'),
    path.join(ws.workspaceRoot, 'src/alpha')
  );
  await fse.copy(
    path.join(ws.workspaceRoot, 'src/sample'),
    path.join(ws.workspaceRoot, 'src/beta')
  );

  const projects = {
    alpha: {
      sourceDir: 'src/alpha',
      outputDir: options.sameOutput ? 'dist/shared' : 'dist/alpha',
    },
    beta: {
      sourceDir: 'src/beta',
      outputDir: options.sameOutput ? 'dist/shared' : 'dist/beta',
    },
  };

  if (options.badProject) {
    projects.bad = {
      sourceDir: 'src/missing',
      outputDir: 'dist/bad',
    };
  }

  const body = `module.exports = {
  defaults: {
    render: [
      {
        from: 'pages',
        to: '',
        include: ['**/*.njk'],
        extension: '.html',
      },
    ],
    templates: ['layouts', 'components'],
    copy: [{ from: 'assets', to: 'assets' }],
    build: { clean: true },
    watch: { debounce: 80 },
    serve: { host: '127.0.0.1', port: 3000 },
    dev: { liveReload: true },
  },
  projects: ${JSON.stringify(projects, null, 2)},
};
`;
  await fsp.writeFile(
    path.join(ws.workspaceRoot, 'jskim.config.js'),
    body,
    'utf8'
  );
  return ws;
}

async function pathExists(abs) {
  try {
    await fsp.access(abs);
    return true;
  } catch {
    return false;
  }
}
