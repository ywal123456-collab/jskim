'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseJskimArgv } = require('../scripts/lib/parse-cli-args');
const {
  runSpecVersionCommand,
} = require('../scripts/commands/spec-version-command');
const { REPO_ROOT } = require('./helpers/create-test-workspace');
const { runCli } = require('./helpers/run-cli');

const BIN = path.join(REPO_ROOT, 'bin', 'jskim.js');
const COMPANION_DIST = path.join(
  REPO_ROOT,
  'jskim-screen-spec',
  'dist',
  'index.js'
);

const temps = [];

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeScreen(root, project, id, label = id) {
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

function setupVersionWorkspace() {
  const root = tempDir('jskim-ver-cli-');
  writeJson(path.join(root, 'package.json'), {
    name: 'jskim-ver-cli-temp',
    private: true,
  });
  fs.writeFileSync(
    path.join(root, 'jskim.config.js'),
    [
      'module.exports = {',
      "  defaults: { files: [{ from: 'pages', to: '' }], templates: [], data: {} },",
      "  projects: { demo: { sourceDir: 'src/demo', outputDir: 'dist/demo' } },",
      '};',
      '',
    ].join('\n')
  );
  writeScreen(root, 'demo', 'alpha');
  writeScreen(root, 'demo', 'beta');
  return root;
}

async function runVersion(root, versionCommand, extra = {}) {
  const previous = process.exitCode;
  process.exitCode = 0;
  let stdout = '';
  let stderr = '';
  const originalLog = console.log;
  const originalErr = console.error;
  const originalWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args) => {
    stdout += `${args.join(' ')}\n`;
  };
  console.error = (...args) => {
    stderr += `${args.join(' ')}\n`;
  };
  process.stdout.write = (chunk, ...rest) => {
    stdout += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  };
  try {
    const result = await runSpecVersionCommand({
      workspaceRoot: root,
      modulePath: COMPANION_DIST,
      versionCommand,
      projectName: extra.projectName ?? 'demo',
      revision: extra.revision,
      versionOptions: extra.versionOptions || {},
    });
    return {
      ...result,
      stdout,
      stderr,
      exitCode: process.exitCode ?? 0,
    };
  } finally {
    console.log = originalLog;
    console.error = originalErr;
    process.stdout.write = originalWrite;
    process.exitCode = previous;
  }
}

describe('spec version CLI', () => {
  before(() => {
    if (!fs.existsSync(COMPANION_DIST)) {
      const result = spawnSync('npm', ['run', 'build'], {
        cwd: path.join(REPO_ROOT, 'jskim-screen-spec'),
        encoding: 'utf8',
        shell: true,
      });
      assert.equal(
        result.status,
        0,
        `companion build が必要です:\n${result.stdout}\n${result.stderr}`
      );
    }
  });

  after(() => {
    while (temps.length > 0) {
      const dir = temps.pop();
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('stub: status JSON envelope と絶対 path 非露出', async () => {
    const root = setupVersionWorkspace();
    await runVersion(root, 'init');
    await runVersion(root, 'config', {
      versionOptions: {
        name: 'Taro Yamada',
        email: 'taro@example.com',
      },
    });
    const status = await runVersion(root, 'status', {
      versionOptions: { json: true },
    });
    assert.equal(status.exitCode, 0);
    const parsed = JSON.parse(status.stdout.trim());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.command, 'status');
    assert.equal(parsed.project, 'demo');
    assert.equal(parsed.result.unborn, true);
    assert.equal(status.stdout.includes(root), false);
    assert.equal(status.stdout.includes('fileKey'), false);
  });

  it('TEMP lifecycle: init→commit→branch→checkout→tag→revert→fsck', async () => {
    const root = setupVersionWorkspace();

    let r = await runVersion(root, 'init');
    assert.equal(r.exitCode, 0, r.stderr);
    assert.match(r.stdout, /初期化しました/);

    r = await runVersion(root, 'status');
    assert.match(r.stdout, /unborn/);

    r = await runVersion(root, 'config', {
      versionOptions: {
        name: 'Taro Yamada',
        email: 'taro@example.com',
      },
    });
    assert.equal(r.exitCode, 0, r.stderr);

    r = await runVersion(root, 'add', {
      versionOptions: { all: true },
    });
    assert.equal(r.exitCode, 0, r.stderr);
    assert.match(r.stdout, /ステージしました/);

    r = await runVersion(root, 'commit', {
      versionOptions: { message: '初回登録' },
    });
    assert.equal(r.exitCode, 0, r.stderr);
    assert.match(r.stdout, /初回登録/);

    r = await runVersion(root, 'status', {
      versionOptions: { json: true },
    });
    const clean = JSON.parse(r.stdout.trim());
    assert.equal(clean.result.clean, true);

    writeScreen(root, 'demo', 'alpha', 'changed');
    r = await runVersion(root, 'status');
    assert.match(r.stdout, /未ステージ/);

    r = await runVersion(root, 'diff');
    assert.match(r.stdout, /screens\/alpha\/description\.json/);

    r = await runVersion(root, 'add', {
      versionOptions: { screen: 'alpha' },
    });
    assert.equal(r.exitCode, 0, r.stderr);

    r = await runVersion(root, 'diff', {
      versionOptions: { staged: true, json: true },
    });
    const stagedDiff = JSON.parse(r.stdout.trim());
    assert.equal(stagedDiff.result.scope, 'staged');
    assert.ok(stagedDiff.result.changes.length > 0);

    r = await runVersion(root, 'commit', {
      versionOptions: { message: 'update alpha' },
    });
    assert.equal(r.exitCode, 0, r.stderr);

    r = await runVersion(root, 'log', {
      versionOptions: { json: true, limit: '10' },
    });
    const log = JSON.parse(r.stdout.trim());
    assert.equal(log.ok, true);
    assert.ok(log.result.commits.length >= 2);
    assert.ok(log.result.commits[0].author.email);
    assert.equal(JSON.stringify(log).includes('fileKey'), false);

    r = await runVersion(root, 'branch', {
      versionOptions: { create: 'review' },
    });
    assert.equal(r.exitCode, 0, r.stderr);

    r = await runVersion(root, 'checkout', { revision: 'review' });
    assert.equal(r.exitCode, 0, r.stderr);
    assert.match(r.stdout, /ブランチ review/);

    r = await runVersion(root, 'tag', {
      versionOptions: {
        create: 'v1',
        message: 'release',
      },
    });
    assert.equal(r.exitCode, 0, r.stderr);
    assert.match(r.stdout, /タグ v1/);

    const fullLog = await runVersion(root, 'log', {
      versionOptions: { limit: '10', json: true },
    });
    const commits = JSON.parse(fullLog.stdout.trim()).result.commits;
    const older = commits[commits.length - 1].hash;

    r = await runVersion(root, 'checkout', { revision: older });
    assert.equal(r.exitCode, 0, r.stderr);
    assert.match(r.stdout, /detached HEAD/);

    r = await runVersion(root, 'checkout', { revision: 'main' });
    assert.equal(r.exitCode, 0, r.stderr);

    const tipLog = await runVersion(root, 'log', {
      versionOptions: { limit: '1', json: true },
    });
    const tip = JSON.parse(tipLog.stdout.trim()).result.commits[0].hash;
    r = await runVersion(root, 'revert', { revision: tip });
    assert.equal(r.exitCode, 0, `${r.stderr}\n${r.stdout}`);
    assert.match(r.stdout, /取り消しました|noop/);

    r = await runVersion(root, 'fsck', {
      versionOptions: { json: true },
    });
    const fsck = JSON.parse(r.stdout.trim());
    assert.equal(fsck.ok, true);
    assert.equal(fsck.result.errors.length, 0);

    // dirty checkout
    writeScreen(root, 'demo', 'beta', 'dirty');
    r = await runVersion(root, 'checkout', { revision: 'review' });
    assert.equal(r.exitCode, 3);
    assert.match(r.stderr, /status/);

    // nothing to commit
    r = await runVersion(root, 'commit', {
      versionOptions: { message: 'noop' },
    });
    assert.equal(r.exitCode, 3);

    // recover inspect
    r = await runVersion(root, 'recover', {
      versionOptions: { inspect: true, json: true },
    });
    assert.equal(r.exitCode, 0);
    const inspect = JSON.parse(r.stdout.trim());
    assert.equal(inspect.result.recoveryRequired, false);

    // confirm なしは usage
    assert.throws(() =>
      parseJskimArgv(['spec', 'version', 'recover', 'demo', '--operation-id', 'x'])
    );
  });

  it('companion 未インストール時は日本語エラー', async () => {
    const root = setupVersionWorkspace();
    const cli = runCli({
      scriptPath: BIN,
      cwd: root,
      args: ['spec', 'version', 'init', 'demo'],
      timeoutMs: 20000,
    });
    const result = await cli.waitForExit();
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /@ywal123456\/jskim-screen-spec/);
  });
});

describe('spec version packed lifecycle', { timeout: 300000 }, () => {
  const packTemps = [];

  after(() => {
    for (const dir of packTemps) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('tarball consumer で version CLI lifecycle が動く', () => {
    if (!fs.existsSync(COMPANION_DIST)) {
      const build = spawnSync('npm', ['run', 'build'], {
        cwd: path.join(REPO_ROOT, 'jskim-screen-spec'),
        encoding: 'utf8',
        shell: true,
      });
      assert.equal(build.status, 0, build.stderr);
    }

    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-ver-pack-'));
    packTemps.push(packDir);
    const consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-ver-cons-'));
    packTemps.push(consumer);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

    const companionPack = spawnSync(
      npm,
      ['pack', '--json', '--pack-destination', packDir],
      {
        cwd: path.join(REPO_ROOT, 'jskim-screen-spec'),
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 120000,
      }
    );
    assert.equal(companionPack.status, 0, companionPack.stderr);
    const companionMeta = JSON.parse(companionPack.stdout.trim());
    const companionInfo = Array.isArray(companionMeta)
      ? companionMeta[0]
      : companionMeta;

    const enginePack = spawnSync(
      npm,
      ['pack', '--json', '--pack-destination', packDir],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 120000,
      }
    );
    assert.equal(enginePack.status, 0, enginePack.stderr);
    const engineMeta = JSON.parse(enginePack.stdout.trim());
    const engineInfo = Array.isArray(engineMeta) ? engineMeta[0] : engineMeta;

    const companionTgz = path.join(packDir, companionInfo.filename);
    const engineTgz = path.join(packDir, engineInfo.filename);

    writeJson(path.join(consumer, 'package.json'), {
      name: 'jskim-ver-pack-consumer',
      private: true,
      devDependencies: {
        '@ywal123456/jskim': `file:${engineTgz.replace(/\\/g, '/')}`,
        '@ywal123456/jskim-screen-spec': `file:${companionTgz.replace(/\\/g, '/')}`,
      },
    });
    fs.writeFileSync(
      path.join(consumer, 'jskim.config.js'),
      [
        'module.exports = {',
        "  defaults: { files: [{ from: 'pages', to: '' }], templates: [], data: {} },",
        "  projects: { demo: { sourceDir: 'src/demo', outputDir: 'dist/demo' } },",
        '};',
        '',
      ].join('\n')
    );
    writeScreen(consumer, 'demo', 'alpha');

    const install = spawnSync(npm, ['install'], {
      cwd: consumer,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      timeout: 180000,
    });
    assert.equal(install.status, 0, install.stderr || install.stdout);

    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const run = (args) =>
      spawnSync(npx, ['jskim', ...args], {
        cwd: consumer,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 60000,
        env: { ...process.env, NODE_PATH: '' },
      });

    let out = run(['--help']);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /spec version/);

    out = run(['spec', 'version', '--help']);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /ローカル版管理/);

    out = run(['spec', 'version', 'init', 'demo']);
    assert.equal(out.status, 0, out.stderr);

    out = run([
      'spec',
      'version',
      'config',
      'demo',
      '--name',
      'TaroYamada',
      '--email',
      'taro@example.com',
    ]);
    assert.equal(out.status, 0, out.stderr || out.stdout);

    out = run(['spec', 'version', 'add', 'demo', '--all']);
    assert.equal(out.status, 0, out.stderr);

    out = run(['spec', 'version', 'commit', 'demo', '-m', '初回登録']);
    assert.equal(out.status, 0, out.stderr);

    out = run(['spec', 'version', 'status', 'demo', '--json']);
    assert.equal(out.status, 0, out.stderr);
    const status = JSON.parse(out.stdout.trim());
    assert.equal(status.ok, true);
    assert.equal(status.result.clean, true);
    assert.equal(out.stdout.includes(consumer), false);

    out = run(['spec', 'version', 'log', 'demo', '--json']);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(JSON.parse(out.stdout.trim()).ok, true);

    out = run(['spec', 'version', 'fsck', 'demo', '--json']);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(JSON.parse(out.stdout.trim()).result.errors.length, 0);

    // version repository cleanup（実 repo の sample を汚さない）
    const versionRepo = path.join(
      consumer,
      'spec',
      'demo',
      '.jskim',
      'version'
    );
    assert.ok(fs.existsSync(versionRepo));
    fs.rmSync(versionRepo, { recursive: true, force: true });
  });
});
